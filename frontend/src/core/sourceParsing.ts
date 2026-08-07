import type { Channel } from "@/src/api";

const EXTINF_ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;

export function streamType(url: string): string {
  const clean = url.toLowerCase().split("?")[0];
  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".ts")) return "ts";
  return "unknown";
}

export function parseM3U(text: string, normalizeLogo: (url: string) => string = (url) => url): Channel[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const channels: Channel[] = [];
  const used = new Set<string>();
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF")) continue;

    const attrs: Record<string, string> = {};
    EXTINF_ATTR.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EXTINF_ATTR.exec(line))) attrs[match[1]] = match[2];

    const name = line.includes(",")
      ? line.slice(line.lastIndexOf(",") + 1).trim()
      : attrs["tvg-name"] || "Channel";

    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next.startsWith("#EXTINF")) break;
      if (next && !next.startsWith("#")) {
        url = next;
        break;
      }
    }
    if (!url) continue;

    const tvgId = (attrs["tvg-id"] || "").trim();
    const base = tvgId || name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    let id = base || `channel-${index}`;
    if (used.has(id)) id = `${id}#${index}`;
    used.add(id);

    channels.push({
      id,
      tvg_id: tvgId,
      name,
      logo: normalizeLogo((attrs["tvg-logo"] || "").trim()),
      group: (attrs["group-title"] || "").trim(),
      url,
      stream_type: streamType(url),
    });
    index++;
  }

  return channels;
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
