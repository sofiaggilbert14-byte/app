export type Engine = "vlc" | "media3";
export type StreamKind = "hls" | "dash" | "progressive" | "rtsp" | "rtmp" | "transport" | "unknown";

export const DEFAULT_STREAM_USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";

export function detectStreamKind(uri: string): StreamKind {
  const lower = uri.toLowerCase();
  const protocol = lower.split(":", 1)[0];
  if (protocol === "rtsp") return "rtsp";
  if (protocol === "rtmp" || protocol === "rtmps") return "rtmp";
  if (/\.m3u8(?:$|[?#])/.test(lower) || lower.includes("format=m3u8") || lower.includes("type=hls")) return "hls";
  if (/\.mpd(?:$|[?#])/.test(lower) || lower.includes("format=mpd") || lower.includes("type=dash")) return "dash";
  if (/\.(?:ts|m2ts)(?:$|[?#])/.test(lower) || lower.includes("mpegts")) return "transport";
  if (/\.(?:mp4|m4v|mov|webm|mkv|avi)(?:$|[?#])/.test(lower)) return "progressive";
  return "unknown";
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parsePipeHeaders(rawUri: string): { uri: string; headers: Record<string, string> } {
  const pipeIndex = rawUri.indexOf("|");
  if (pipeIndex < 0) return { uri: rawUri, headers: { "User-Agent": DEFAULT_STREAM_USER_AGENT } };

  const uri = rawUri.slice(0, pipeIndex);
  const headers: Record<string, string> = { "User-Agent": DEFAULT_STREAM_USER_AGENT };
  for (const pair of rawUri.slice(pipeIndex + 1).split("&")) {
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    const key = safeDecode(pair.slice(0, equals)).trim();
    const value = safeDecode(pair.slice(equals + 1)).trim();
    if (key && value) headers[key] = value;
  }
  return { uri, headers };
}

export function preferredEngine(kind: StreamKind): Engine {
  if (kind === "hls" || kind === "dash" || kind === "progressive") return "media3";
  return "vlc";
}

export function alternateEngine(engine: Engine, vlcAvailable: boolean): Engine | null {
  if (engine === "vlc") return "media3";
  return vlcAvailable ? "vlc" : null;
}
