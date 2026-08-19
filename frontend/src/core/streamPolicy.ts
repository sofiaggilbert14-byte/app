export type Engine = "vlc" | "media3";
/** CMAF is packaging (fMP4) carried inside HLS or DASH — not a separate engine path. */
export type StreamKind =
  | "hls"
  | "dash"
  | "progressive"
  | "rtsp"
  | "rtmp"
  | "transport"
  | "srt"
  | "webrtc"
  | "unknown";

export const DEFAULT_STREAM_USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";

export function detectStreamKind(uri: string): StreamKind {
  const lower = uri.toLowerCase();
  const protocol = lower.split(":", 1)[0];
  if (protocol === "rtsp") return "rtsp";
  if (protocol === "rtmp" || protocol === "rtmps") return "rtmp";
  if (protocol === "srt" || protocol === "rist") return "srt";
  if (protocol === "webrtc" || (protocol === "http" && lower.includes("webrtc"))) return "webrtc";
  // HLS — Apple HLS / CMAF-in-HLS (.m3u8 → .ts or fMP4 segments).
  if (
    /\.m3u8(?:$|[?#])/.test(lower) ||
    lower.includes("format=m3u8") ||
    lower.includes("type=hls") ||
    lower.includes("/hls/") ||
    lower.includes("playlist.m3u8")
  ) {
    return "hls";
  }
  // MPEG-DASH / CMAF-in-DASH (.mpd → fMP4).
  if (
    /\.mpd(?:$|[?#])/.test(lower) ||
    lower.includes("format=mpd") ||
    lower.includes("type=dash") ||
    lower.includes("/dash/") ||
    lower.includes("manifest.mpd")
  ) {
    return "dash";
  }
  if (/\.(?:ts|m2ts)(?:$|[?#])/.test(lower) || lower.includes("mpegts")) return "transport";
  if (/\.(?:mp4|m4v|m4s|mov|webm|mkv|avi|cmfv|cmfa)(?:$|[?#])/.test(lower)) return "progressive";
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

/**
 * Media3/ExoPlayer is the primary playback engine for every stream type. This
 * mirrors the native-TV architecture used by mature IPTV players: keep one
 * preferred engine for predictable startup/track handling, then fail over to
 * VLC when Media3 cannot open or decode a particular feed.
 *
 * Some contribution protocols (RTMP/SRT/WebRTC) are not guaranteed to be
 * supported by the installed Media3 stack. We still try Media3 first so the
 * app has one deterministic default; StreamPlayer will immediately fall back
 * to VLC on a real load/codec failure when VLC is installed.
 */
export function preferredEngine(_kind: StreamKind): Engine {
  return "media3";
}

export function alternateEngine(engine: Engine, vlcAvailable: boolean): Engine | null {
  if (engine === "vlc") return "media3";
  return vlcAvailable ? "vlc" : null;
}

/** Media3 contentType hint for expo-video / ExoPlayer replaceAsync. */
export function media3ContentType(kind: StreamKind): "hls" | "dash" | "progressive" {
  if (kind === "dash") return "dash";
  if (kind === "hls") return "hls";
  return "progressive";
}
