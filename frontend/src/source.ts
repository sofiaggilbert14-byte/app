import dayjs from "dayjs";
import { Platform } from "react-native";
import { XMLParser } from "fast-xml-parser";
import { storage } from "@/src/utils/storage";
import type { Channel, Program, GuideResponse, SourceStatus } from "@/src/api";

// Hardcoded developer source (fetched & parsed on-device — no backend needed).
export const SOURCE_M3U = "https://m3u4u.com/m3u/jwmzn1grpmu99585n721";
export const SOURCE_EPG = "https://m3u4u.com/xml/jwmzn1grpmu99585n721";

const CACHE_KEY = "gs_source_cache_v1";
const TTL_MS = 30 * 60 * 1000;
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

function nodeText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return nodeText(v[0]);
  if (typeof v === "object") return v["#text"] != null ? String(v["#text"]) : "";
  return String(v);
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

function parseXMLTV(xml: string): { icons: Record<string, string>; programs: Record<string, Program[]> } {
  const icons: Record<string, string> = {};
  const programs: Record<string, Program[]> = {};
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return { icons, programs };
  }
  const tv = doc?.tv || {};
  let chans = tv.channel || [];
  if (!Array.isArray(chans)) chans = [chans];
  for (const ch of chans) {
    const id = ch?.["@_id"];
    if (!id) continue;
    let icon = ch.icon;
    if (Array.isArray(icon)) icon = icon[0];
    const src = icon?.["@_src"];
    if (src) icons[id] = https(src);
  }
  let progs = tv.programme || [];
  if (!Array.isArray(progs)) progs = [progs];
  for (const p of progs) {
    const cid = p?.["@_channel"];
    const start = parseXmltvTime(p?.["@_start"]);
    if (!cid || !start) continue;
    const stop = parseXmltvTime(p?.["@_stop"]);
    (programs[cid] = programs[cid] || []).push({
      title: nodeText(p.title) || "No Title",
      desc: nodeText(p.desc),
      category: nodeText(p.category),
      start,
      stop,
    });
  }
  for (const cid in programs) programs[cid].sort((a, b) => a.start.localeCompare(b.start));
  return { icons, programs };
}

async function doFetchParse(): Promise<Parsed> {
  const m3uText = await fetchText(SOURCE_M3U);
  const channels = parseM3U(m3uText);
  let icons: Record<string, string> = {};
  let programs: Record<string, Program[]> = {};
  try {
    const epgText = await fetchText(SOURCE_EPG, 45000);
    const parsed = parseXMLTV(epgText);
    icons = parsed.icons;
    programs = parsed.programs;
  } catch {
    // EPG optional — channels still work without it
  }
  for (const c of channels) {
    if (!c.logo && c.tvg_id && icons[c.tvg_id]) c.logo = icons[c.tvg_id];
  }
  const parsed: Parsed = { ts: Date.now(), channels, programs };
  MEM = parsed;
  if (Platform.OS !== "web") {
    try {
      await storage.setItem(CACHE_KEY, parsed);
    } catch {
      // cache is best-effort
    }
  }
  return parsed;
}

async function ensureParsed(force: boolean): Promise<Parsed> {
  if (!force && MEM && Date.now() - MEM.ts < TTL_MS) return MEM;
  if (!force && !MEM) {
    const cached = await storage.getItem<Parsed>(CACHE_KEY, null as any);
    if (cached && cached.channels?.length) {
      MEM = cached;
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

function windowPrograms(list: Program[] | undefined, start: dayjs.Dayjs, end: dayjs.Dayjs): Program[] {
  if (!list) return [];
  return list.filter((p) => {
    const ps = dayjs(p.start);
    const pe = p.stop ? dayjs(p.stop) : ps.add(30, "minute");
    return pe.isAfter(start) && ps.isBefore(end);
  });
}

export async function loadGuide(startISO?: string, hours = 12, force = false): Promise<GuideResponse> {
  const parsed = await ensureParsed(force);
  const now = dayjs();
  const winStart = startISO ? dayjs(startISO) : now.subtract(1, "hour");
  const winEnd = winStart.add(hours, "hour");
  const channels = parsed.channels.map((c) => ({
    ...c,
    programs: windowPrograms(parsed.programs[c.tvg_id], winStart, winEnd),
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
