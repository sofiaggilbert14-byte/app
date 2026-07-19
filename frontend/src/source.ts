import dayjs from "dayjs";
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import type { Channel, Program, GuideResponse, SourceStatus } from "@/src/api";

// Hardcoded developer source (fetched & parsed on-device — no backend needed).
export const SOURCE_M3U = "https://m3u4u.com/m3u/jwmzn1grpmu99585n721";
export const SOURCE_EPG = "https://m3u4u.com/xml/jwmzn1grpmu99585n721";

const CACHE_KEY = "gs_source_cache_v2";
const TTL_MS = 24 * 60 * 60 * 1000; // refresh at most once a day
const EXTINF_ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;

type Parsed = {
  ts: number;
  channels: Channel[];
  programs: Record<string, Program[]>;
};

let MEM: Parsed | null = null;

function streamType(url: string): string {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".m3u8")) return "hls";
  if (u.endsWith(".ts")) return "ts";
  return "unknown";
}

function https(url: string): string {
  return url && url.startsWith("http://") ? "https://" + url.slice(7) : url;
}

// On the web preview, direct fetches to m3u4u.com are blocked by CORS. Route
// web-only requests through the dev backend proxy (this environment only). The
// shipped native app (APK / Expo Go) fetches directly with no proxy/backend.
const WEB_PROXY = `${process.env.EXPO_PUBLIC_BACKEND_URL || ""}/api/proxy?url=`;

function resolveUrl(url: string): string {
  const secure = https(url);
  if (Platform.OS === "web") {
    return `${WEB_PROXY}${encodeURIComponent(secure)}`;
  }
  return secure;
}

async function fetchText(url: string, timeoutMs = 30000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resolveUrl(url), {
      signal: controller.signal,
      headers: { "User-Agent": "GridStream/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseM3U(text: string): Channel[] {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  const used = new Set<string>();
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF")) continue;
    const attrs: Record<string, string> = {};
    let m: RegExpExecArray | null;
    EXTINF_ATTR.lastIndex = 0;
    while ((m = EXTINF_ATTR.exec(line))) attrs[m[1]] = m[2];
    const name = line.includes(",") ? line.slice(line.lastIndexOf(",") + 1).trim() : attrs["tvg-name"] || "Channel";
    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      const nxt = lines[j].trim();
      if (nxt && !nxt.startsWith("#")) {
        url = nxt;
        break;
      }
    }
    const tvgId = (attrs["tvg-id"] || "").trim();
    const base = tvgId || name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    let id = base;
    if (used.has(id)) id = `${base}#${idx}`;
    used.add(id);
    channels.push({
      id,
      tvg_id: tvgId,
      name,
      logo: https((attrs["tvg-logo"] || "").trim()),
      group: (attrs["group-title"] || "").trim(),
      url,
      stream_type: streamType(url),
    });
    idx++;
  }
  return channels;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isNaN(code) ? _m : String.fromCodePoint(code);
    }
    return ENTITIES[e] ?? _m;
  });
}
function xmlAttr(head: string, name: string): string {
  const m = head.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : "";
}
function xmlFirstTag(body: string, name: string): string {
  const m = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1].trim()) : "";
}
function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function parseXmltvTime(s: string): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, off] = m;
  let iso = `${y}-${mo}-${d}T${h}:${mi}:${se}`;
  if (off) iso += `${off.slice(0, 3)}:${off.slice(3)}`;
  else iso += "Z";
  const dt = dayjs(iso);
  return dt.isValid() ? dt.toISOString() : null;
}

// Chunked, regex-based XMLTV parser. Avoids building a full XML DOM (the old
// fast-xml-parser DOM build blocked the JS thread for seconds on 600+ channel
// guides) and yields to the event loop every batch so the UI never freezes.
async function parseXMLTV(
  xml: string,
): Promise<{ icons: Record<string, string>; programs: Record<string, Program[]> }> {
  const icons: Record<string, string> = {};
  const programs: Record<string, Program[]> = {};

  // Channel icons (small list) — quick synchronous pass.
  const chanRe = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
  let cm: RegExpExecArray | null;
  while ((cm = chanRe.exec(xml))) {
    const id = xmlAttr(cm[1], "id");
    if (!id) continue;
    const src = cm[2].match(/<icon\b[^>]*\bsrc="([^"]*)"/);
    if (src) icons[id] = https(src[1]);
  }

  // Keep only a useful window (past 6h → next 2 days) so low-power TV boxes
  // don't build/hold tens of thousands of program objects.
  const minStop = Date.now() - 6 * 3600 * 1000;
  const maxStart = Date.now() + 2 * 24 * 3600 * 1000;
  const progRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let pm: RegExpExecArray | null;
  let seen = 0;
  while ((pm = progRe.exec(xml))) {
    const head = pm[1];
    const cid = xmlAttr(head, "channel");
    const start = parseXmltvTime(xmlAttr(head, "start"));
    if (cid && start && Date.parse(start) <= maxStart) {
      const stop = parseXmltvTime(xmlAttr(head, "stop"));
      if (!(stop && Date.parse(stop) < minStop)) {
        const body = pm[2];
        (programs[cid] = programs[cid] || []).push({
          title: xmlFirstTag(body, "title") || "No Title",
          desc: xmlFirstTag(body, "desc"),
          category: xmlFirstTag(body, "category"),
          start,
          stop,
        });
      }
    }
    // Yield to the UI thread periodically so parsing never freezes the app.
    if (++seen % 1000 === 0) await nextTick();
  }
  for (const cid in programs) programs[cid].sort((a, b) => a.start.localeCompare(b.start));
  return { icons, programs };
}

// UI subscribers (the store) get notified when channels first appear and again
// when the background EPG parse finishes.
let listeners: Array<() => void> = [];
export function subscribeSource(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {}
  });
}

async function persist() {
  if (Platform.OS === "web" || !MEM) return;
  try {
    await storage.setItem(CACHE_KEY, MEM);
  } catch {}
}

let epgLoading = false;
async function loadEpg(channels: Channel[]) {
  if (epgLoading) return;
  epgLoading = true;
  try {
    const epgText = await fetchText(SOURCE_EPG, 45000);
    const { icons, programs } = await parseXMLTV(epgText);
    for (const c of channels) {
      if (!c.logo && c.tvg_id && icons[c.tvg_id]) c.logo = icons[c.tvg_id];
    }
    MEM = { ts: Date.now(), channels, programs };
    await persist();
    emit();
  } catch {
    // EPG optional — channels remain usable without it
  } finally {
    epgLoading = false;
  }
}

function maybeLoadEpg() {
  if (MEM && MEM.channels.length && Object.keys(MEM.programs).length === 0) {
    loadEpg(MEM.channels);
  }
}

async function doFetchParse(): Promise<Parsed> {
  // Stage 1 (fast): parse the small M3U so the guide paints immediately, even
  // on low-power Android TV / Firestick boxes.
  const m3uText = await fetchText(SOURCE_M3U);
  const channels = parseM3U(m3uText);
  channels.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  MEM = { ts: Date.now(), channels, programs: MEM?.programs || {} };
  await persist();
  emit();
  // Stage 2 (slower): parse the large EPG in the background, then notify.
  loadEpg(channels);
  return MEM;
}

async function ensureParsed(force: boolean): Promise<Parsed> {
  if (!force && MEM && Date.now() - MEM.ts < TTL_MS) {
    maybeLoadEpg();
    return MEM;
  }
  if (!force && !MEM) {
    const cached = await storage.getItem<Parsed>(CACHE_KEY, null as any);
    if (cached && cached.channels?.length) {
      MEM = cached;
      maybeLoadEpg();
      if (Date.now() - cached.ts < TTL_MS) return cached;
    }
  }
  try {
    return await doFetchParse();
  } catch (e) {
    if (MEM) return MEM; // fall back to whatever we have
    throw e;
  }
}

function windowPrograms(list: Program[] | undefined, startMs: number, endMs: number): Program[] {
  if (!list) return [];
  const out: Program[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const ps = Date.parse(p.start);
    const pe = p.stop ? Date.parse(p.stop) : ps + 30 * 60 * 1000;
    if (pe > startMs && ps < endMs) out.push(p);
  }
  return out;
}

export async function loadGuide(startISO?: string, hours = 12, force = false): Promise<GuideResponse> {
  const parsed = await ensureParsed(force);
  const now = dayjs();
  const winStart = startISO ? dayjs(startISO) : now.subtract(1, "hour");
  const winEnd = winStart.add(hours, "hour");
  const winStartMs = winStart.valueOf();
  const winEndMs = winEnd.valueOf();
  const channels = parsed.channels.map((c) => ({
    ...c,
    programs: windowPrograms(parsed.programs[c.tvg_id], winStartMs, winEndMs),
  }));
  return {
    start: winStart.toISOString(),
    end: winEnd.toISOString(),
    now: now.toISOString(),
    channels,
  };
}

export async function refreshSource(): Promise<SourceStatus> {
  await doFetchParse();
  return sourceStatus();
}

export function sourceStatus(): SourceStatus {
  const channels = MEM?.channels || [];
  const withEpg = channels.filter((c) => c.tvg_id && MEM?.programs[c.tvg_id]?.length).length;
  return {
    m3u_url: SOURCE_M3U,
    epg_url: SOURCE_EPG,
    channel_count: channels.length,
    channels_with_epg: withEpg,
    last_refresh: MEM ? new Date(MEM.ts).toISOString() : null,
    refreshing: false,
    error: null,
  };
}
