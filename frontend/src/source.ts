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

// When EXPO_PUBLIC_CHARM_API_URL is set, fetch Cloudflare Worker JSON
// (/channels.json, /guide.json). Otherwise use direct M3U/EPG URLs.
export const API_BASE = (process.env.EXPO_PUBLIC_CHARM_API_URL || "").replace(/\/$/, "");
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

// Rolling XMLTV parser for large native EPG files. It accepts decoder chunks,
// discards each consumed XML block immediately, and yields frequently so held
// remote input and playback stay responsive throughout an update.
async function parseXMLTVChunks(
  chunks: string[],
  sink: Sink = {},
): Promise<{
  icons: Record<string, string>;
  channelNames: Record<string, string>;
  programs: Record<string, Program[]>;
}> {
  const icons = sink.icons ?? {};
  const channelNames = sink.channelNames ?? {};
  const programs = sink.programs ?? {};
  const totalChars = Math.max(1, chunks.reduce((total, chunk) => total + chunk.length, 0));
  const minStop = Date.now() - 6 * 3600 * 1000;
  const maxStart = Date.now() + 2 * 24 * 3600 * 1000;
  let buffer = "";
  let consumedChars = 0;
  let seen = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    buffer += chunks[chunkIndex];
    chunks[chunkIndex] = "";
    if (chunkIndex === 0 && buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);

    while (buffer.length) {
      const channelStart = buffer.indexOf("<channel");
      const programmeStart = buffer.indexOf("<programme");
      const starts = [channelStart, programmeStart].filter((value) => value >= 0);
      if (!starts.length) {
        if (buffer.length > 32) {
          consumedChars += buffer.length - 32;
          buffer = buffer.slice(-32);
        }
        break;
      }

      const start = Math.min(...starts);
      if (start > 0) {
        consumedChars += start;
        buffer = buffer.slice(start);
      }
      const isProgramme = buffer.startsWith("<programme");
      const openLength = isProgramme ? 10 : 8;
      const closeTag = isProgramme ? "</programme>" : "</channel>";
      const gt = buffer.indexOf(">");
      if (gt === -1) break;
      const end = buffer.indexOf(closeTag, gt + 1);
      if (end === -1) break;

      const head = buffer.slice(openLength, gt);
      const body = buffer.slice(gt + 1, end);
      const blockLength = end + closeTag.length;
      if (isProgramme) {
        const channelId = xmlAttr(head, "channel");
        const startIso = parseXmltvTime(xmlAttr(head, "start"));
        if (channelId && startIso && Date.parse(startIso) <= maxStart) {
          const parsedStop = parseXmltvTime(xmlAttr(head, "stop"));
          if (!(parsedStop && Date.parse(parsedStop) < minStop)) {
            const startMs = Date.parse(startIso);
            const parsedStopMs = parsedStop ? Date.parse(parsedStop) : NaN;
            const stop = Number.isFinite(parsedStopMs) && parsedStopMs > startMs && parsedStopMs - startMs <= 24 * 3600 * 1000
              ? parsedStop
              : new Date(startMs + 30 * 60000).toISOString();
            (programs[channelId] ||= []).push({
              title: xmlFirstTag(body, "title") || "No Title",
              desc: xmlFirstTag(body, "desc"),
              category: xmlFirstTag(body, "category"),
              start: startIso,
              stop,
            });
          }
        }
        seen++;
      } else {
        const channelId = xmlAttr(head, "id");
        if (channelId) {
          const displayName = xmlFirstTag(body, "display-name");
          if (displayName) channelNames[channelId] = displayName;
          const iconStart = body.indexOf("<icon");
          if (iconStart !== -1) {
            const iconEnd = body.indexOf(">", iconStart);
            if (iconEnd !== -1) {
              const src = xmlAttr(body.slice(iconStart + 5, iconEnd), "src");
              if (src) icons[channelId] = https(src);
            }
          }
        }
      }

      consumedChars += blockLength;
      buffer = buffer.slice(blockLength);
      if (seen > 0 && seen % 80 === 0) {
        sink.onProgress?.(Math.min(0.995, consumedChars / totalChars));
        await nextTick();
      }
    }
    sink.onProgress?.(Math.min(0.995, consumedChars / totalChars));
    await nextTick();
  }

  const channelIds = Object.keys(programs);
  for (let index = 0; index < channelIds.length; index++) {
    programs[channelIds[index]].sort((a, b) => a.start.localeCompare(b.start));
    if (index > 0 && index % 32 === 0) await nextTick();
  }
  sink.onProgress?.(1);
  return { icons, channelNames, programs };
}

// UI subscribers (the store) get notified when channels first appear and again
// when the background EPG parse finishes.
let listeners: (() => void)[] = [];
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

// ---- EPG load progress (for the on-screen status bar + ETA) ----------------
export type LoadPhase = "idle" | "channels" | "downloading" | "decompressing" | "parsing" | "indexing" | "caching" | "ready" | "error";
export type EpgProgress = {
  phase: LoadPhase;
  ratio: number; // 0..1 across the whole EPG step (download + parse)
  etaSeconds: number | null;
};
let progress: EpgProgress = { phase: "idle", ratio: 0, etaSeconds: null };
let progressListeners: ((p: EpgProgress) => void)[] = [];
export function subscribeProgress(fn: (p: EpgProgress) => void): () => void {
  progressListeners.push(fn);
  fn(progress);
  return () => {
    progressListeners = progressListeners.filter((l) => l !== fn);
  };
}
let lastProgressEmit = 0;
function setProgress(p: Partial<EpgProgress>, force = false) {
  progress = { ...progress, ...p };
  const now = Date.now();
  if (!force && now - lastProgressEmit < 150) return;
  lastProgressEmit = now;
  const snap = progress;
  progressListeners.forEach((l) => {
    try {
      l(snap);
    } catch {}
  });
}

type CacheMeta = Omit<Parsed, "programs"> & { indexed: true };

let persistQueue: Promise<{ programCount: number; channelCount: number }> = Promise.resolve({
  programCount: 0,
  channelCount: 0,
});

async function persistSnapshot(snapshot: Parsed, onProgress?: (ratio: number) => void) {
  const incomingCount = Object.values(snapshot.programs).reduce((total, list) => total + list.length, 0);
  const stats = incomingCount > 0
    ? await replaceIndexedPrograms(snapshot.programs, onProgress)
    : await getIndexedEpgStats();

  const { programs: _programs, ...rest } = snapshot;
  const meta: CacheMeta = {
    ...rest,
    epgProgramCount: stats.programCount,
    epgChannelCount: stats.channelCount,
    indexed: true,
  };
  const metaPayload = JSON.stringify(meta);
  if (metaPayload.length > MAX_CACHE_BYTES) throw new Error("Guide metadata cache is too large");
  await FileSystem.writeAsStringAsync(CACHE_TMP_FILE, metaPayload);
  await FileSystem.deleteAsync(CACHE_FILE, { idempotent: true });
  await FileSystem.moveAsync({ from: CACHE_TMP_FILE, to: CACHE_FILE });

  // Remove the superseded v5 JSON chunks after the SQLite commit succeeds.
  try {
    const files = await FileSystem.readDirectoryAsync(CACHE_ROOT);
    await Promise.all(
      files
        .filter((name) => name === "guide_cache_v5_meta.json" || name.startsWith(CACHE_CHUNK_PREFIX))
        .map((name) => FileSystem.deleteAsync(CACHE_ROOT + name, { idempotent: true })),
    );
  } catch {}
  onProgress?.(1);
  return stats;
}

async function persist(onProgress?: (ratio: number) => void) {
  if (Platform.OS === "web" || !MEM || !CACHE_FILE) {
    return {
      programCount: Object.values(MEM?.programs || {}).reduce((total, list) => total + list.length, 0),
      channelCount: Object.values(MEM?.programs || {}).filter((list) => list.length > 0).length,
    };
  }
  const snapshot = MEM;
  persistQueue = persistQueue
    .catch(() => ({ programCount: snapshot.epgProgramCount || 0, channelCount: snapshot.epgChannelCount || 0 }))
    .then(() => persistSnapshot(snapshot, onProgress));
  return persistQueue;
}

async function readCache(): Promise<Parsed | null> {
  if (Platform.OS === "web" || !CACHE_FILE) return null;
  try {
    const info = await FileSystem.getInfoAsync(CACHE_FILE);
    if (!info.exists) return null;
    const txt = await FileSystem.readAsStringAsync(CACHE_FILE);
    const meta = JSON.parse(txt) as CacheMeta;
    if (
      !meta ||
      meta.indexed !== true ||
      !Number.isFinite(meta.ts) ||
      !Array.isArray(meta.channels) ||
      !meta.channels.length
    ) {
      await FileSystem.deleteAsync(CACHE_FILE, { idempotent: true });
      return null;
    }
    const stats = await getIndexedEpgStats();
    return {
      ...meta,
      epgProgramCount: stats.programCount,
      epgChannelCount: stats.channelCount,
      programs: {},
    };
  } catch {
    await clearCacheFiles();
    return null;
  }
}

type RemoteChannel = {
  id: string;
  tvgId?: string;
  name: string;
  logo?: string;
  category?: string;
  url: string;
};
type RemoteProgram = { t: string; s: number; e: number; d?: string; c?: string };
type RemoteGuide = { updatedAt?: number; channels: { id: string; p?: RemoteProgram[] }[] };

async function fetchRemoteText(path: string): Promise<string> {
  const url = `${API_BASE}${path}`;
  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
  };

  if (Platform.OS !== "web") {
    const tmp = (FileSystem.cacheDirectory || FileSystem.documentDirectory || "") + `remote_${path.replace(/[^a-z0-9]+/gi, "_")}.json`;
    const dl = FileSystem.createDownloadResumable(url, tmp, { headers });
    const res = await dl.downloadAsync();
    if (!res) throw new Error(`${path} download failed`);
    const text = await FileSystem.readAsStringAsync(res.uri);
    try {
      await FileSystem.deleteAsync(res.uri, { idempotent: true });
    } catch {}
    if (!text.trim()) {
      throw new Error(`${path} returned empty data`);
    }
    if (text.charCodeAt(0) === 0x1f || text.charCodeAt(1) === 0x8b) {
      throw new Error(`${path} returned compressed data the app could not decode`);
    }
    return text;
  }

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
    },
  });
  if (!res.ok) {
    throw new Error(`${path} unavailable (${res.status})`);
  }
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`${path} returned empty data`);
  }
  if (text.charCodeAt(0) === 0x1f || text.charCodeAt(1) === 0x8b) {
    throw new Error(`${path} returned compressed data the app could not decode`);
  }
  return text;
}

function parseRemoteJson<T>(label: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const sample = text.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`${label} returned invalid JSON: ${sample}`);
  }
}

async function fetchRemoteTextWithBinaryFallback(plainPath: string, gzipPath: string): Promise<string> {
  try {
    return await fetchRemoteText(plainPath);
  } catch (firstError) {
    try {
      return await inflateIfGzip(await fetchBytes(`${API_BASE}${gzipPath}`));
    } catch {
      throw firstError;
    }
  }
}

async function fetchRemoteJson(): Promise<Parsed> {
  if (!API_BASE) throw new Error("Cloudflare API URL is not configured");
  setProgress({ phase: "downloading", ratio: 0.1, etaSeconds: null }, true);
  const channelsText = await fetchRemoteTextWithBinaryFallback("/channels.json", "/channels");
  const rawChannels = parseRemoteJson<RemoteChannel[]>("/channels.json", channelsText);
  if (!Array.isArray(rawChannels)) {
    throw new Error("Guide service returned invalid channel data");
  }

  const channels: Channel[] = rawChannels
    .filter((c) => c?.id && c?.name && c?.url)
    .map((c) => ({
      id: c.id,
      tvg_id: c.id,
      name: c.name,
      logo: c.logo || "",
      group: c.category || "Uncategorized",
      url: c.url,
      stream_type: streamType(c.url),
    }));
  if (!channels.length) throw new Error("Guide service returned no channels");

  const previous = MEM;
  MEM = {
    ts: Date.now(),
    channels: sortChannelsAlphabetically(channels),
    programs: previous?.programs || {},
    epgProgramCount: previous?.epgProgramCount,
    epgChannelCount: previous?.epgChannelCount,
  };
  await persist();
  emit();
  setProgress({ phase: "channels", ratio: 0.25, etaSeconds: null }, true);

  let guideText = "";
  try {
    guideText = await fetchRemoteTextWithBinaryFallback("/guide.json", "/guide");
  } catch (e) {
    setProgress({ phase: "error", ratio: 0, etaSeconds: null }, true);
    throw e;
  }
  const rawGuide = parseRemoteJson<RemoteGuide>("/guide.json", guideText);
  if (!Array.isArray(rawGuide?.channels)) {
    throw new Error("Guide service returned invalid EPG data");
  }

  const programs: Record<string, Program[]> = {};
  for (const entry of rawGuide.channels) {
    if (!entry?.id || !Array.isArray(entry.p)) continue;
    programs[entry.id] = entry.p
      .filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e) && p.e > p.s)
      .map((p) => ({
        title: p.t || "No Title",
        desc: p.d || "",
        category: p.c || "",
        start: new Date(p.s).toISOString(),
        stop: new Date(p.e).toISOString(),
      }));
  }

  const channelsWithPrograms = channels.filter((c) => programs[c.id]?.length).length;
  if (!channelsWithPrograms) {
    throw new Error("Guide service returned no matched EPG programs");
  }
  setProgress({ phase: "ready", ratio: 1, etaSeconds: 0 }, true);
  return { ts: rawGuide.updatedAt || Date.now(), channels: sortChannelsAlphabetically(channels), programs };
}

let epgLoading = false;
let epgPromise: Promise<void> | null = null;
let lastSourceError: string | null = null;

function loadEpg(channels: Channel[], force = false): Promise<void> {
  if (!SOURCE_EPG) return Promise.resolve();
  if (epgPromise) return epgPromise;

  const lastAttempt = MEM?.epgAttemptTs || 0;
  const hasPrograms = !!MEM && (
    Object.keys(MEM.programs).length > 0 ||
    (MEM.epgProgramCount || 0) > 0
  );
  if (!force && !hasPrograms && lastAttempt > 0 && Date.now() - lastAttempt < TTL_MS) {
    if (MEM?.epgError) setProgress({ phase: "error", ratio: 0, etaSeconds: null }, true);
    return Promise.resolve();
  }

  epgPromise = (async () => {
    epgLoading = true;
    const attemptTs = Date.now();
    const dlStart = attemptTs;
    lastSourceError = null;
    if (MEM) {
      // Keep the last good guide instantly available while the replacement is
      // downloading and parsing. Cache work happens after usable data is ready.
      MEM = { ...MEM, epgAttemptTs: attemptTs, epgError: undefined };
    }
    try {
      setProgress({ phase: "downloading", ratio: 0, etaSeconds: null }, true);
      let bytes = await fetchBytes(SOURCE_EPG, (ratio) => {
        if (ratio == null) {
          setProgress({ phase: "downloading", ratio: 0, etaSeconds: null });
          return;
        }
        const elapsed = (Date.now() - dlStart) / 1000;
        const eta = ratio > 0.02 && elapsed > 0.5 ? (elapsed / ratio) * (1 - ratio) : null;
        setProgress({ phase: "downloading", ratio: ratio * 0.2, etaSeconds: eta });
      });
      if (bytes.length < 16) throw new Error("EPG download returned no usable data");
      setProgress({ phase: "decompressing", ratio: 0.2, etaSeconds: null }, true);
      const epgChunks = await inflateToTextChunks(bytes, (ratio) => {
        setProgress({ phase: "decompressing", ratio: 0.2 + ratio * 0.1, etaSeconds: null });
      });
      bytes = new Uint8Array(0);
      setProgress({ phase: "parsing", ratio: 0.3, etaSeconds: null }, true);
      let header = "";
      let tagTail = "";
      let hasProgramme = false;
      for (const chunk of epgChunks) {
        if (header.length < 8192) header += chunk;
        const scan = tagTail + chunk;
        if (scan.includes("<programme")) hasProgramme = true;
        tagTail = scan.slice(-16);
      }
      header = header.slice(0, 8192).toLowerCase();
      if (!header.includes("<tv") || !hasProgramme) {
        throw new Error("EPG URL did not return XMLTV data");
      }

      const icons: Record<string, string> = {};
      const channelNames: Record<string, string> = {};
      const programs: Record<string, Program[]> = {};
      const parseStart = Date.now();
      const epgSink: Sink = {
        icons,
        channelNames,
        programs,
        onProgress: (ratio) => {
          const elapsed = (Date.now() - parseStart) / 1000;
          const eta = ratio > 0.02 && elapsed > 0.3 ? (elapsed / ratio) * (1 - ratio) : null;
          setProgress({ phase: "parsing", ratio: 0.3 + ratio * 0.6, etaSeconds: eta });
        },
      };
      if (Platform.OS === "web") {
        await parseXMLTV(epgChunks.join(""), epgSink);
      } else {
        await parseXMLTVChunks(epgChunks, epgSink);
      }

      setProgress({ phase: "indexing", ratio: 0.9, etaSeconds: null }, true);
      await nextTick();
      const programIdByKey = new Map<string, string>();
      for (const id of Object.keys(programs)) {
        const key = normalizeGuideKey(id);
        if (key && !programIdByKey.has(key)) programIdByKey.set(key, id);
      }
      const programIdByName = new Map<string, string>();
      for (const [id, name] of Object.entries(channelNames)) {
        const key = normalizeGuideKey(name);
        if (key && programs[id]?.length && !programIdByName.has(key)) programIdByName.set(key, id);
      }

      let matchedChannels = 0;
      for (const channel of channels) {
        const sourceId =
          (channel.tvg_id && programs[channel.tvg_id]?.length ? channel.tvg_id : "") ||
          programIdByKey.get(normalizeGuideKey(channel.tvg_id)) ||
          programIdByName.get(normalizeGuideKey(channel.name)) ||
          "";
        if (!sourceId || !programs[sourceId]?.length) continue;
        channel.tvg_id = sourceId;
        matchedChannels++;
        if (!channel.logo && icons[sourceId]) channel.logo = icons[sourceId];
      }
      if (!matchedChannels) throw new Error("EPG loaded, but its channel IDs did not match the playlist");

      epgChunks.length = 0;
      MEM = {
        ts: attemptTs,
        epgAttemptTs: attemptTs,
        channels: sortChannelsAlphabetically(channels),
        programs,
        epgProgramCount: Object.values(programs).reduce((total, list) => total + list.length, 0),
        epgChannelCount: matchedChannels,
      };
      lastSourceError = null;
      setProgress({ phase: "caching", ratio: 0.92, etaSeconds: null }, true);
      const indexed = await persist((ratio) => {
        setProgress({ phase: "caching", ratio: 0.92 + ratio * 0.08, etaSeconds: null });
      });
      // SQLite is now the source of truth. Drop the full in-memory programme
      // map and repaint from the indexed visible-window query.
      MEM = {
        ...MEM,
        programs: {},
        epgProgramCount: indexed.programCount,
        epgChannelCount: indexed.channelCount,
      };
      emit();
      setProgress({ phase: "ready", ratio: 1, etaSeconds: 0 }, true);
    } catch (error) {
      lastSourceError = error instanceof Error ? error.message : "EPG refresh failed";
      if (MEM) {
        MEM = { ...MEM, epgAttemptTs: attemptTs, epgError: lastSourceError };
        await persist().catch(() => undefined);
      }
      setProgress({ phase: "error", ratio: 0, etaSeconds: null }, true);
      emit();
    } finally {
      epgLoading = false;
      epgPromise = null;
    }
  })();
  return epgPromise;
}

function maybeLoadEpg() {
  if (MEM && MEM.channels.length && Object.keys(MEM.programs).length === 0 && !(MEM.epgProgramCount || 0)) {
    loadEpg(MEM.channels);
  } else if (MEM && (Object.keys(MEM.programs).length > 0 || (MEM.epgProgramCount || 0) > 0)) {
    setProgress({ phase: "ready", ratio: 1, etaSeconds: 0 }, true);
  }
}

async function doFetchParse(): Promise<Parsed> {
  if (API_BASE) {
    const remote = await fetchRemoteJson();
    MEM = remote;
    await persist();
    emit();
    return remote;
  }
  if (!SOURCE_M3U) {
    throw new Error("Local M3U URL is not configured");
  }
  // Stage 1 (fast): parse the small M3U so the guide paints immediately, even
  // on low-power Android TV / Firestick boxes.
  const m3uText = await fetchTextMaybeGzip(SOURCE_M3U);
  const channels = parseM3U(m3uText);
  const previous = MEM;
  MEM = {
    ts: Date.now(),
    channels: sortChannelsAlphabetically(channels),
    programs: previous?.programs || {},
    epgProgramCount: previous?.epgProgramCount,
    epgChannelCount: previous?.epgChannelCount,
  };
  // Do not rewrite a large existing EPG before starting a refresh.
  if (Object.keys(MEM.programs).length === 0 && !(MEM.epgProgramCount || 0)) await persist();
  emit();
  setProgress({ phase: "channels", ratio: 0, etaSeconds: null }, true);
  // Stage 2 (slower): parse the large EPG in the background, then notify.
  loadEpg(channels);
  return MEM;
}

let fetchPromise: Promise<Parsed> | null = null;
async function fetchParseOnce(): Promise<Parsed> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = doFetchParse();
  try {
    return await fetchPromise;
  } finally {
    fetchPromise = null;
  }
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
    return await fetchParseOnce();
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
  const indexedPrograms = (parsed.epgProgramCount || 0) > 0
    ? await loadIndexedPrograms(
        parsed.channels.map((channel) => channel.tvg_id).filter(Boolean),
        winStartMs,
        winEndMs,
      )
    : null;
  const channels = parsed.channels.map((c) => ({
    ...c,
    programs: indexedPrograms
      ? indexedPrograms[c.tvg_id] || []
      : windowPrograms(parsed.programs[c.tvg_id], winStartMs, winEndMs),
  }));
  return {
    start: winStart.toISOString(),
    end: winEnd.toISOString(),
    now: now.toISOString(),
    channels,
  };
}

export async function refreshSource(force = false): Promise<SourceStatus> {
  const parsed = await ensureParsed(force);
  if (force && !API_BASE && SOURCE_EPG) await loadEpg(parsed.channels, true);
  return sourceStatus();
}

export function sourceStatus(): SourceStatus {
  const channels = MEM?.channels || [];
  const withEpg = MEM?.epgChannelCount ||
    channels.filter((c) => c.tvg_id && MEM?.programs[c.tvg_id]?.length).length;
  return {
    m3u_url: API_BASE ? `${API_BASE}/channels.json` : SOURCE_M3U ? "configured" : "not configured",
    epg_url: API_BASE ? `${API_BASE}/guide.json` : SOURCE_EPG ? "configured" : "not configured",
    channel_count: channels.length,
    channels_with_epg: withEpg,
    last_refresh: MEM ? new Date(MEM.ts).toISOString() : null,
    refreshing: false,
    error: MEM?.epgError || lastSourceError,
  };
}

export type SourceDiagnostics = {
  mode: "cloudflare" | "direct" | "unconfigured";
  cacheBytes: number;
  cacheAgeMinutes: number | null;
  channels: number;
  programs: number;
  refreshInFlight: boolean;
  epgError: string | null;
  nextAutoRefresh: string | null;
};

export async function sourceDiagnostics(): Promise<SourceDiagnostics> {
  let cacheBytes = 0;
  if (Platform.OS !== "web" && CACHE_FILE) {
    try {
      const files = await FileSystem.readDirectoryAsync(CACHE_ROOT);
      for (const name of files) {
        if (name === "guide_cache_v6_meta.json" || name === "guide_cache_v5_meta.json" || name.startsWith(CACHE_CHUNK_PREFIX)) {
          const info = await FileSystem.getInfoAsync(CACHE_ROOT + name);
          if (info.exists && typeof info.size === "number") cacheBytes += info.size;
        }
      }
    } catch {}
  }
  cacheBytes += await getIndexedEpgStorageBytes().catch(() => 0);
  const indexedStats = await getIndexedEpgStats();
  const programCount = MEM?.epgProgramCount ||
    indexedStats.programCount ||
    (MEM ? Object.values(MEM.programs).reduce((total, list) => total + list.length, 0) : 0);
  return {
    mode: API_BASE ? "cloudflare" : SOURCE_M3U ? "direct" : "unconfigured",
    cacheBytes,
    cacheAgeMinutes: MEM ? Math.max(0, Math.round((Date.now() - MEM.ts) / 60000)) : null,
    channels: MEM?.channels.length || 0,
    programs: programCount,
    refreshInFlight: !!fetchPromise || epgLoading,
    epgError: MEM?.epgError || lastSourceError,
    nextAutoRefresh: MEM ? new Date(MEM.ts + TTL_MS).toISOString() : null,
  };
}

async function clearCacheFiles(): Promise<void> {
  if (Platform.OS === "web" || !CACHE_ROOT) return;
  try {
    const files = await FileSystem.readDirectoryAsync(CACHE_ROOT);
    await Promise.all(
      files
        .filter((name) =>
          name === "guide_cache_v6_meta.json" ||
          name === "guide_cache_v5_meta.json" ||
          name.startsWith(CACHE_CHUNK_PREFIX)
        )
        .map((name) => FileSystem.deleteAsync(CACHE_ROOT + name, { idempotent: true })),
    );
  } catch {}
  await FileSystem.deleteAsync(CACHE_TMP_FILE, { idempotent: true });
}

export async function clearGuideCache(): Promise<void> {
  MEM = null;
  lastSourceError = null;
  await clearIndexedEpg();
  await clearCacheFiles();
  setProgress({ phase: "idle", ratio: 0, etaSeconds: null }, true);
  emit();
}
