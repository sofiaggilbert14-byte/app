import dayjs from "dayjs";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { DecodeUTF8, Gunzip } from "fflate";
import type { Channel, Program, GuideResponse, SourceStatus } from "@/src/api";
import {
  clearIndexedEpg,
  getIndexedEpgStats,
  getIndexedEpgStorageBytes,
  loadIndexedPrograms,
  replaceIndexedPrograms,
} from "@/src/epgDb";

// Developer source — fetched & parsed on-device (no backend needed).
// Experimental is deliberately device-local: never select the Cloudflare JSON path.
export const API_BASE = "";
export const SOURCE_M3U =
  process.env.EXPO_PUBLIC_M3U_URL || "http://m3u4u.com/m3u/jwmzn1grpmu99585n721";
export const SOURCE_EPG =
  process.env.EXPO_PUBLIC_EPG_URL || "http://m3u4u.com/epg/jwmzn1grpmu99585n721";

const TTL_MS = 24 * 60 * 60 * 1000; // refresh at most once a day
const EXTINF_ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;
// Channel metadata stays in one tiny atomic file. Programme rows live in the
// indexed SQLite database so startup and guide-window reads never parse a
// multi-megabyte JSON cache.
const CACHE_ROOT = FileSystem.documentDirectory || "";
const CACHE_FILE = CACHE_ROOT ? CACHE_ROOT + "guide_cache_v6_meta.json" : "";
const CACHE_TMP_FILE = CACHE_FILE ? `${CACHE_FILE}.tmp` : "";
const CACHE_CHUNK_PREFIX = "guide_cache_v5_programs_";
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

type Parsed = {
  ts: number;
  epgAttemptTs?: number;
  epgError?: string;
  epgProgramCount?: number;
  epgChannelCount?: number;
  channels: Channel[];
  programs: Record<string, Program[]>;
};

function sortChannelsAlphabetically(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

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

async function fetchTextMaybeGzip(
  url: string,
  onDownload?: (ratio: number | null) => void,
): Promise<string> {
  // Handles both plain and GZIP-compressed sources (m3u4u serves some feeds
  // gzipped). Downloads the bytes reliably, then inflates only if gzip-magic.
  const bytes = await fetchBytes(url, onDownload);
  return inflateIfGzip(bytes);
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < B64_CHARS.length; i++) t[B64_CHARS.charCodeAt(i)] = i;
  return t;
})();

async function base64ToBytes(b64: string): Promise<Uint8Array> {
  const len = b64.length;
  let pad = 0;
  if (len && b64[len - 1] === "=") pad++;
  if (len > 1 && b64[len - 2] === "=") pad++;
  const outLen = ((len * 3) >> 2) - pad;
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[b64.charCodeAt(i)];
    const b = B64_LOOKUP[b64.charCodeAt(i + 1)];
    const c = B64_LOOKUP[b64.charCodeAt(i + 2)];
    const d = B64_LOOKUP[b64.charCodeAt(i + 3)];
    if (p < outLen) out[p++] = (a << 2) | (b >> 4);
    if (p < outLen) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < outLen) out[p++] = ((c & 3) << 6) | d;
    if (i > 0 && i % (64 * 1024) === 0) await nextTick();
  }
  return out;
}

// Reliable binary fetch used for BOTH the M3U and EPG. On native, RN's
// fetch().arrayBuffer() is unreliable for binary, so we download to disk (with
// progress) and read back as base64. On web we fetch via the dev proxy.
async function fetchBytes(
  url: string,
  onDownload?: (ratio: number | null) => void,
): Promise<Uint8Array> {
  if (Platform.OS === "web") {
    const res = await fetch(resolveUrl(url), { headers: { "User-Agent": "GridStream/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const tmp = (FileSystem.cacheDirectory || FileSystem.documentDirectory || "") + "source_download.bin";
  try {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
  } catch {}
  const dl = FileSystem.createDownloadResumable(
    resolveUrl(url),
    tmp,
    { headers: { "User-Agent": "GridStream/1.0" } },
    (p) => {
      const total = p.totalBytesExpectedToWrite;
      onDownload?.(total > 0 ? p.totalBytesWritten / total : null);
    },
  );
  const res = await dl.downloadAsync();
  if (!res) throw new Error("Source download failed");
  let b64 = await FileSystem.readAsStringAsync(res.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  try {
    await FileSystem.deleteAsync(res.uri, { idempotent: true });
  } catch {}
  const bytes = await base64ToBytes(b64);
  b64 = "";
  return bytes;
}

async function inflateToTextChunks(
  bytes: Uint8Array,
  onProgress?: (ratio: number) => void,
): Promise<string[]> {
  // fflate's asynchronous helper creates a Web Worker, which Hermes does not
  // provide. Feed the streaming inflater small chunks and yield between them so
  // remote focus/navigation stays responsive during decompression.
  if (bytes.length <= 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    const textChunks: string[] = [];
    const decoder = new DecodeUTF8((text) => textChunks.push(text));
    const decodeChunkBytes = 64 * 1024;
    for (let offset = 0; offset < bytes.length; offset += decodeChunkBytes) {
      const end = Math.min(bytes.length, offset + decodeChunkBytes);
      decoder.push(bytes.subarray(offset, end), end === bytes.length);
      onProgress?.(end / Math.max(1, bytes.length));
      if (end < bytes.length) await nextTick();
    }
    return textChunks;
  }

  const textChunks: string[] = [];
  const decoder = new DecodeUTF8((text) => textChunks.push(text));
  const inflater = new Gunzip((chunk, final) => {
    decoder.push(chunk, final);
  });
  const inputChunkBytes = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += inputChunkBytes) {
    const end = Math.min(bytes.length, offset + inputChunkBytes);
    inflater.push(bytes.subarray(offset, end), end === bytes.length);
    onProgress?.(end / bytes.length);
    if (end < bytes.length) await nextTick();
  }

  return textChunks;
}

async function inflateIfGzip(
  bytes: Uint8Array,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const chunks = await inflateToTextChunks(bytes, onProgress);
  return chunks.join("");
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
  for (const quote of ['"', "'"]) {
    const needle = name + "=" + quote;
    let i = head.indexOf(needle);
    while (i > 0 && isWordChar(head[i - 1])) {
      i = head.indexOf(needle, i + needle.length);
    }
    if (i === -1) continue;
    const s = i + needle.length;
    const e = head.indexOf(quote, s);
    if (e !== -1) return decodeEntities(head.slice(s, e));
  }
  return "";
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

function normalizeGuideKey(value: string | undefined): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
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
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) {
    return null;
  }
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
  channelNames?: Record<string, string>;
  programs?: Record<string, Program[]>;
  onProgress?: (ratio: number) => void;
};

// Streaming XMLTV parser using plain indexOf scanning (no `new RegExp`, no XML
// DOM). Yields to the UI thread every batch and reports progress without
// rebuilding every guide row during parsing.
async function parseXMLTV(
  xml: string,
  sink: Sink = {},
): Promise<{
  icons: Record<string, string>;
  channelNames: Record<string, string>;
  programs: Record<string, Program[]>;
}> {
  const icons = sink.icons ?? {};
  const channelNames = sink.channelNames ?? {};
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
      const displayName = xmlFirstTag(body, "display-name");
      if (displayName) channelNames[id] = displayName;
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
      const parsedStop = parseXmltvTime(xmlAttr(head, "stop"));
      if (!(parsedStop && Date.parse(parsedStop) < minStop)) {
        const body = xml.slice(gt + 1, e);
        const startMs = Date.parse(start);
        const parsedStopMs = parsedStop ? Date.parse(parsedStop) : NaN;
        const stop = Number.isFinite(parsedStopMs) && parsedStopMs > startMs && parsedStopMs - startMs <= 24 * 3600 * 1000
          ? parsedStop
          : new Date(startMs + 30 * 60000).toISOString();
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
    if (++seen % 120 === 0) {
      onProgress?.(pos / xml.length);
      await nextTick();
    }
  }
  for (const cid in programs) programs[cid].sort((a, b) => a.start.localeCompare(b.start));
  return { icons, channelNames, programs };
}
