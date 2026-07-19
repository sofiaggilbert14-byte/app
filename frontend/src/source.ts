import dayjs from "dayjs";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { gunzip, strFromU8 } from "fflate";
import type { Channel, Program, GuideResponse, SourceStatus } from "@/src/api";

// Developer source — fetched & parsed on-device (no backend needed).
export const SOURCE_M3U = "http://m3u4u.com/m3u/jwmzn1grpmu99585n721";
export const SOURCE_EPG = "http://m3u4u.com/epg/jwmzn1grpmu99585n721";

const TTL_MS = 24 * 60 * 60 * 1000; // refresh at most once a day
const EXTINF_ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;
// Persist the parsed guide to a file. AsyncStorage's ~2 MB per-value limit
// silently drops a 600+ channel guide, which forced a slow full re-parse on
// every launch — the file cache makes relaunches instant.
const CACHE_FILE = FileSystem.documentDirectory
  ? FileSystem.documentDirectory + "guide_cache_v3.json"
  : "";

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

function gunzipAsync(data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    gunzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

// The /epg/ endpoint serves the XMLTV GZIP-compressed (~2.5 MB vs ~16 MB
// uncompressed) — a big download win on slow TV-box networks. Fetch the raw
// bytes and inflate on-device; if the source is already plain XML, use it as-is.
async function fetchEpgText(url: string, timeoutMs = 45000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resolveUrl(url), {
      signal: controller.signal,
      headers: { "User-Agent": "GridStream/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // gzip magic bytes 0x1f 0x8b
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const out = await gunzipAsync(bytes);
      return strFromU8(out);
    }
    return strFromU8(bytes);
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
function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 48 && c <= 57) ||
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c === 45 ||
    c === 95
  );
}
// Fast, allocation-light attribute read — NO `new RegExp` (compiling a regex
// per programme was the main reason parsing took minutes on weak TV boxes).
function xmlAttr(head: string, name: string): string {
  const needle = name + '="';
  let i = head.indexOf(needle);
  while (i > 0 && isWordChar(head[i - 1])) {
    i = head.indexOf(needle, i + needle.length);
  }
  if (i === -1) return "";
  const s = i + needle.length;
  const e = head.indexOf('"', s);
  return e === -1 ? "" : head.slice(s, e);
}
function xmlFirstTag(body: string, name: string): string {
  const open = "<" + name;
  let i = body.indexOf(open);
  while (i !== -1) {
    const c = body[i + open.length];
    if (c === ">" || c === " " || c === "\t" || c === "\n" || c === "\r" || c === "/") break;
    i = body.indexOf(open, i + open.length);
  }
  if (i === -1) return "";
  const gt = body.indexOf(">", i);
  if (gt === -1 || body[gt - 1] === "/") return "";
  const close = "</" + name + ">";
  const j = body.indexOf(close, gt + 1);
  if (j === -1) return "";
  return decodeEntities(body.slice(gt + 1, j).trim());
}
function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function parseXmltvTime(s: string): string | null {
  if (!s) return null;
  // Format: YYYYMMDDHHMMSS ±HHMM (offset optional). Read positionally — no
  // regex, no dayjs — so it stays cheap across hundreds of thousands of calls.
  const t = s.trim();
  if (t.length < 14) return null;
  const y = +t.slice(0, 4);
  const mo = +t.slice(4, 6);
  const d = +t.slice(6, 8);
  const h = +t.slice(8, 10);
  const mi = +t.slice(10, 12);
  const se = +t.slice(12, 14);
  if (isNaN(y) || isNaN(mo) || isNaN(d) || isNaN(h) || isNaN(mi) || isNaN(se)) return null;
  let ms = Date.UTC(y, mo - 1, d, h, mi, se);
  const rest = t.slice(14).trim();
  if (rest.length >= 5 && (rest[0] === "+" || rest[0] === "-")) {
    const sign = rest[0] === "-" ? -1 : 1;
    const oh = +rest.slice(1, 3);
    const om = +rest.slice(3, 5);
    if (!isNaN(oh) && !isNaN(om)) ms -= sign * (oh * 60 + om) * 60000;
  }
  if (isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

type Sink = {
  icons?: Record<string, string>;
  programs?: Record<string, Program[]>;
  onProgress?: () => void;
};

// Streaming XMLTV parser using plain indexOf scanning (no `new RegExp`, no XML
// DOM). Yields to the UI thread every batch and calls onProgress so the guide
// fills in live while parsing — the app stays fully navigable throughout.
async function parseXMLTV(
  xml: string,
  sink: Sink = {},
): Promise<{ icons: Record<string, string>; programs: Record<string, Program[]> }> {
  const icons = sink.icons ?? {};
  const programs = sink.programs ?? {};
  const onProgress = sink.onProgress;

  // Channel icons — scan <channel ...>…</channel> blocks.
  let cpos = 0;
  while (true) {
    const s = xml.indexOf("<channel", cpos);
    if (s === -1) break;
    const gt = xml.indexOf(">", s);
    if (gt === -1) break;
    const e = xml.indexOf("</channel>", gt);
    if (e === -1) break;
    const head = xml.slice(s + 8, gt);
    const body = xml.slice(gt + 1, e);
    cpos = e + 10;
    const id = xmlAttr(head, "id");
    if (id) {
      const ii = body.indexOf("<icon");
      if (ii !== -1) {
        const ie = body.indexOf(">", ii);
        if (ie !== -1) {
          const src = xmlAttr(body.slice(ii + 5, ie), "src");
          if (src) icons[id] = https(src);
        }
      }
    }
  }

  // Programmes — keep only a useful window (past 6h → next 2 days) so low-power
  // TV boxes don't build/hold tens of thousands of program objects.
  const minStop = Date.now() - 6 * 3600 * 1000;
  const maxStart = Date.now() + 2 * 24 * 3600 * 1000;
  let pos = 0;
  let seen = 0;
  while (true) {
    const s = xml.indexOf("<programme", pos);
    if (s === -1) break;
    const gt = xml.indexOf(">", s);
    if (gt === -1) break;
    const e = xml.indexOf("</programme>", gt);
    if (e === -1) break;
    const head = xml.slice(s + 10, gt);
    pos = e + 12;
    const cid = xmlAttr(head, "channel");
    const start = parseXmltvTime(xmlAttr(head, "start"));
    if (cid && start && Date.parse(start) <= maxStart) {
      const stop = parseXmltvTime(xmlAttr(head, "stop"));
      if (!(stop && Date.parse(stop) < minStop)) {
        const body = xml.slice(gt + 1, e);
        (programs[cid] = programs[cid] || []).push({
          title: xmlFirstTag(body, "title") || "No Title",
          desc: xmlFirstTag(body, "desc"),
          category: xmlFirstTag(body, "category"),
          start,
          stop,
        });
      }
    }
    // Yield to the UI thread + push a progressive update so it never freezes.
    if (++seen % 500 === 0) {
      onProgress?.();
      await nextTick();
    }
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
  if (Platform.OS === "web" || !MEM || !CACHE_FILE) return;
  try {
    await FileSystem.writeAsStringAsync(CACHE_FILE, JSON.stringify(MEM));
  } catch {}
}

async function readCache(): Promise<Parsed | null> {
  if (Platform.OS === "web" || !CACHE_FILE) return null;
  try {
    const info = await FileSystem.getInfoAsync(CACHE_FILE);
    if (!info.exists) return null;
    const txt = await FileSystem.readAsStringAsync(CACHE_FILE);
    const data = JSON.parse(txt) as Parsed;
    return data && data.channels?.length ? data : null;
  } catch {
    return null;
  }
}

let epgLoading = false;
async function loadEpg(channels: Channel[]) {
  if (epgLoading) return;
  epgLoading = true;
  try {
    const epgText = await fetchEpgText(SOURCE_EPG, 45000);
    const icons: Record<string, string> = {};
    const programs: Record<string, Program[]> = {};
    // Point MEM at the live `programs` object so the guide fills in as we parse.
    MEM = { ts: Date.now(), channels, programs };
    let lastEmit = 0;
    await parseXMLTV(epgText, {
      icons,
      programs,
      onProgress: () => {
        const t = Date.now();
        if (t - lastEmit > 900) {
          lastEmit = t;
          emit();
        }
      },
    });
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
    const cached = await readCache();
    if (cached) {
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
