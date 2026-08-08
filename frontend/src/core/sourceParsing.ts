import type { Channel } from "@/src/api";

const EXTINF_ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;

/** Soft cap for downloaded/parsed playlist text (M3U is typically ASCII). */
export const MAX_PLAYLIST_BYTES = 32 * 1024 * 1024;
/** Hard cap on accepted channel records after filtering. */
export const MAX_PLAYLIST_CHANNELS = 25_000;
/** Keep channel ids within favorite-id hygiene limits. */
export const MAX_CHANNEL_ID_LEN = 160;

const ALLOWED_PLAYLIST_SCHEMES = new Set([
  "http:",
  "https:",
  "rtsp:",
  "rtsps:",
  "rtmp:",
  "rtmps:",
]);

export type ParseM3UStats = {
  channels: Channel[];
  rejected: number;
  truncated: boolean;
};

export function streamType(url: string): string {
  const clean = url.toLowerCase().split("?")[0].split("|")[0];
  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".ts")) return "ts";
  return "unknown";
}

/** Identity URL without VLC-style pipe headers. */
export function streamIdentityUrl(url: string): string {
  return url.split("|")[0].trim().toLowerCase();
}

/** Stable short fingerprint for URL-based channel identity (djb2). */
export function fingerprintKey(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function isAllowedPlaylistUrl(url: string): boolean {
  const raw = streamIdentityUrl(url);
  if (!raw) return false;
  const match = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match) return false;
  return ALLOWED_PLAYLIST_SCHEMES.has(`${match[1].toLowerCase()}:`);
}

export function enforcePlaylistTextLimit(text: string): void {
  if (text.length > MAX_PLAYLIST_BYTES) {
    throw new Error(`Playlist exceeds size limit (${MAX_PLAYLIST_BYTES} bytes)`);
  }
}

export function enforcePlaylistByteLimit(byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength < 0) return;
  if (byteLength > MAX_PLAYLIST_BYTES) {
    throw new Error(`Playlist exceeds size limit (${MAX_PLAYLIST_BYTES} bytes)`);
  }
}

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function clipId(id: string): string {
  if (id.length <= MAX_CHANNEL_ID_LEN) return id;
  return id.slice(0, MAX_CHANNEL_ID_LEN);
}

/**
 * Prefer unique tvg-id; on collision or missing id, append a URL fingerprint
 * so reordering the playlist does not reshuffle favorites / recent keys.
 */
export function allocateChannelId(input: {
  tvgId: string;
  name: string;
  group: string;
  url: string;
  used: Set<string>;
}): string {
  const { tvgId, name, group, url, used } = input;
  const fp = fingerprintKey(streamIdentityUrl(url));
  const slug = slugify(`${name} ${group}`.trim()) || slugify(name) || `ch-${fp}`;
  const preferred = clipId((tvgId || slug || `ch-${fp}`).trim() || `ch-${fp}`);

  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }

  const withFp = clipId(`${preferred}~${fp}`);
  if (!used.has(withFp)) {
    used.add(withFp);
    return withFp;
  }

  let n = 2;
  let candidate = clipId(`${withFp}~${n}`);
  while (used.has(candidate)) {
    n += 1;
    candidate = clipId(`${withFp}~${n}`);
  }
  used.add(candidate);
  return candidate;
}

export function parseM3UWithStats(
  text: string,
  normalizeLogo: (url: string) => string = (url) => url,
  onProgress?: (ratio: number) => void,
): ParseM3UStats {
  enforcePlaylistTextLimit(text);
  type RawEntry = {
    tvgId: string;
    name: string;
    group: string;
    logo: string;
    url: string;
  };
  const entries: RawEntry[] = [];
  let rejected = 0;

  // Walk lines without allocating a full string[] (large playlists on Fire TV).
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const total = Math.max(1, source.length);
  let offset = 0;
  let pending: { line: string; attrs: Record<string, string>; name: string } | null = null;
  let scanned = 0;

  const flushProgress = () => {
    if (!onProgress) return;
    scanned += 1;
    if (scanned % 400 === 0) onProgress(Math.min(0.95, offset / total));
  };

  while (offset <= source.length) {
    const nextBreak = source.indexOf("\n", offset);
    const end = nextBreak < 0 ? source.length : nextBreak;
    let line = source.slice(offset, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    line = line.trim();
    offset = nextBreak < 0 ? source.length + 1 : nextBreak + 1;
    flushProgress();

    if (line.startsWith("#EXTINF")) {
      if (pending) rejected += 1;
      const attrs: Record<string, string> = {};
      EXTINF_ATTR.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = EXTINF_ATTR.exec(line))) attrs[match[1]] = match[2];
      const name = line.includes(",")
        ? line.slice(line.lastIndexOf(",") + 1).trim()
        : attrs["tvg-name"] || "Channel";
      pending = { line, attrs, name };
      continue;
    }

    if (!pending) continue;
    if (!line || line.startsWith("#")) continue;

    const url = line;
    const attrs = pending.attrs;
    const name = pending.name;
    pending = null;
    if (!isAllowedPlaylistUrl(url)) {
      rejected += 1;
      continue;
    }
    entries.push({
      tvgId: (attrs["tvg-id"] || "").trim(),
      name,
      group: (attrs["group-title"] || "").trim(),
      logo: normalizeLogo((attrs["tvg-logo"] || "").trim()),
      url,
    });
  }
  if (pending) rejected += 1;
  onProgress?.(1);

  const tvgCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.tvgId) continue;
    tvgCounts.set(entry.tvgId, (tvgCounts.get(entry.tvgId) || 0) + 1);
  }

  const channels: Channel[] = [];
  const used = new Set<string>();
  let truncated = false;

  for (const entry of entries) {
    if (channels.length >= MAX_PLAYLIST_CHANNELS) {
      truncated = true;
      break;
    }
    const uniqueTvg = !!entry.tvgId && (tvgCounts.get(entry.tvgId) || 0) === 1;
    const fp = fingerprintKey(streamIdentityUrl(entry.url));
    const slug = slugify(`${entry.name} ${entry.group}`.trim()) || slugify(entry.name) || `ch-${fp}`;
    let preferred = uniqueTvg
      ? entry.tvgId
      : entry.tvgId
        ? `${entry.tvgId}~${fp}`
        : slug;
    preferred = clipId(preferred.trim() || `ch-${fp}`);

    let id = preferred;
    if (used.has(id)) {
      id = allocateChannelId({
        tvgId: "",
        name: entry.name,
        group: entry.group,
        url: entry.url,
        used,
      });
    } else {
      used.add(id);
    }

    channels.push({
      id,
      tvg_id: entry.tvgId,
      name: entry.name,
      logo: entry.logo,
      group: entry.group,
      url: entry.url,
      stream_type: streamType(entry.url),
    });
  }

  return { channels, rejected, truncated };
}

export function parseM3U(text: string, normalizeLogo: (url: string) => string = (url) => url): Channel[] {
  return parseM3UWithStats(text, normalizeLogo).channels;
}

export function parseXmltvTime(raw: string): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length < 14) return null;
  const year = +value.slice(0, 4);
  const month = +value.slice(4, 6);
  const day = +value.slice(6, 8);
  const hour = +value.slice(8, 10);
  const minute = +value.slice(10, 12);
  const second = +value.slice(12, 14);
  if ([year, month, day, hour, minute, second].some(Number.isNaN)) return null;
  if (
    year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59
  ) return null;

  let millis = Date.UTC(year, month - 1, day, hour, minute, second);
  const rest = value.slice(14).trim();
  if (rest.length >= 5 && (rest[0] === "+" || rest[0] === "-")) {
    const sign = rest[0] === "-" ? -1 : 1;
    const offsetHours = +rest.slice(1, 3);
    const offsetMinutes = +rest.slice(3, 5);
    if (!Number.isNaN(offsetHours) && !Number.isNaN(offsetMinutes)) {
      millis -= sign * (offsetHours * 60 + offsetMinutes) * 60_000;
    }
  }
  if (Number.isNaN(millis)) return null;
  return new Date(millis).toISOString();
}

export function resolveXmltvStop(startIso: string, rawStop: string, fallbackMinutes = 30): string {
  const startMs = Date.parse(startIso);
  const parsedStop = parseXmltvTime(rawStop);
  const stopMs = parsedStop ? Date.parse(parsedStop) : Number.NaN;
  if (Number.isFinite(stopMs) && stopMs > startMs && stopMs - startMs <= 24 * 60 * 60 * 1000) {
    return parsedStop!;
  }
  return new Date(startMs + fallbackMinutes * 60_000).toISOString();
}
