import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, UIManager, StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";

export type StreamStatus = "loading" | "playing" | "error";

type Engine = "vlc" | "media3";
type StreamKind = "hls" | "dash" | "progressive" | "rtsp" | "rtmp" | "transport" | "unknown";

const USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";
const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES_PER_WINDOW = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;
const ENGINE_START_TIMEOUT_MS = 12_000;

type FailureState = { failures: number[]; blockedUntil: number };
const failureStateByKey = new Map<string, FailureState>();

function failureKey(engine: Engine, uri: string): string {
  return `${engine}:${uri}`;
}

function getFailureState(engine: Engine, uri: string): FailureState {
  const key = failureKey(engine, uri);
  const now = Date.now();
  const state = failureStateByKey.get(key) || { failures: [], blockedUntil: 0 };
  state.failures = state.failures.filter((ts) => now - ts <= FAILURE_WINDOW_MS);
  if (state.blockedUntil <= now && state.failures.length < MAX_FAILURES_PER_WINDOW) state.blockedUntil = 0;
  failureStateByKey.set(key, state);
  return state;
}

function circuitRemainingMs(engine: Engine, uri: string): number {
  return Math.max(0, getFailureState(engine, uri).blockedUntil - Date.now());
}

function isCircuitOpen(engine: Engine, uri: string): boolean {
  return circuitRemainingMs(engine, uri) > 0;
}

function recordFailure(engine: Engine, uri: string): void {
  if (!uri) return;
  const now = Date.now();
  const key = failureKey(engine, uri);
  const state = getFailureState(engine, uri);
  state.failures.push(now);
  if (state.failures.length >= MAX_FAILURES_PER_WINDOW) state.blockedUntil = now + CIRCUIT_COOLDOWN_MS;
  failureStateByKey.set(key, state);
}

function recordStablePlayback(engine: Engine, uri: string): void {
  if (!uri) return;
  const key = failureKey(engine, uri);
  const state = getFailureState(engine, uri);
  state.failures = state.failures.slice(-2);
  state.blockedUntil = 0;
  failureStateByKey.set(key, state);
}

function detectStreamKind(uri: string): StreamKind {
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

function parsePipeHeaders(rawUri: string): { uri: string; headers: Record<string, string> } {
  const pipeIndex = rawUri.indexOf("|");
  if (pipeIndex < 0) return { uri: rawUri, headers: { "User-Agent": USER_AGENT } };

  const uri = rawUri.slice(0, pipeIndex);
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  const pairs = rawUri.slice(pipeIndex + 1).split("&");
  for (const pair of pairs) {
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    const key = decodeURIComponent(pair.slice(0, equals)).trim();
    const value = decodeURIComponent(pair.slice(equals + 1)).trim();
    if (key && value) headers[key] = value;
  }
  return { uri, headers };
}

function preferredEngine(kind: StreamKind): Engine {
  // Media3 is highly efficient for standard adaptive/progressive HTTP playback.
  // VLC remains first choice for transport streams and non-HTTP protocols.
  if (kind === "hls" || kind === "dash" || kind === "progressive") return "media3";
  return "vlc";
}

export const vlcAvailable = Platform.OS !== "web" && !!UIManager.getViewManagerConfig?.("RCTVLCPlayer");

const VLCPlayer: any = vlcAvailable
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must be lazy outside installed builds
  ? require("react-native-vlc-media-player").VLCPlayer
  : null;

type Props = {
  uri: string;
  onStatus: (s: StreamStatus) => void;
  style?: StyleProp<ViewStyle>;
};

type EngineProps = Props & { engine: Engine };

function useCircuitCooldown(engine: Engine, uri: string, onStatus: (s: StreamStatus) => void) {
  const [blocked, setBlocked] = useState(() => isCircuitOpen(engine, uri));

  useEffect(() => {
    setBlocked(isCircuitOpen(engine, uri));
  }, [engine, uri]);

  useEffect(() => {
    const remaining = circuitRemainingMs(engine, uri);
    if (!blocked) {
      if (remaining > 0) setBlocked(true);
      return;
    }

    if (remaining <= 0) {
      setBlocked(false);
      onStatus("error");
      return;
    }

    onStatus("loading");
    const timer = setTimeout(() => {
      setBlocked(false);
      onStatus("error");
    }, remaining + 25);
    return () => clearTimeout(timer);
  }, [blocked, engine, onStatus, uri]);

  return { blocked, setBlocked };
}

function VlcStream({ uri: rawUri, onStatus, style, engine }: EngineProps) {
  const activeRef = useRef(true);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const { blocked, setBlocked } = useCircuitCooldown(engine, uri, onStatus);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  if (blocked || !VLCPlayer) return null;

  const fail = () => {
    if (!activeRef.current) return;
    recordFailure(engine, uri);
    if (isCircuitOpen(engine, uri)) {
      setBlocked(true);
      onStatus("loading");
    } else {
      onStatus("error");
    }
  };

  const referer = headers.Referer || headers.referer;
  const origin = headers.Origin || headers.origin;
  const userAgent = headers["User-Agent"] || headers["user-agent"] || USER_AGENT;
  const initOptions = [
    "--network-caching=1400",
    "--live-caching=1400",
    "--file-caching=900",
    "--clock-jitter=0",
    "--clock-synchro=0",
    "--http-reconnect",
    "--adaptive-logic=rate",
    `--http-user-agent=${userAgent}`,
  ];
  if (referer) initOptions.push(`--http-referrer=${referer}`);
  if (origin) initOptions.push(`--http-origin=${origin}`);

  return (
    <VLCPlayer
      style={style}
      source={{ uri, initType: 2, initOptions }}
      autoplay
      autoAspectRatio
      resizeMode="contain"
      acceptInvalidCertificates
      onOpen={() => activeRef.current && onStatus("loading")}
      onBuffering={() => activeRef.current && onStatus("loading")}
      onPlaying={() => {
        if (!activeRef.current) return;
        recordStablePlayback(engine, uri);
        onStatus("playing");
      }}
      onError={fail}
      onStopped={fail}
    />
  );
}

function ExpoStream({ uri: rawUri, onStatus, style, engine }: EngineProps) {
  const mountedRef = useRef(true);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const kind = useMemo(() => detectStreamKind(uri), [uri]);
  const { blocked, setBlocked } = useCircuitCooldown(engine, uri, onStatus);
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        player.pause();
      } catch {}
    };
  }, [player]);

  useEffect(() => {
    if (!uri || blocked) return;

    let cancelled = false;
    onStatus("loading");
    (async () => {
      try {
        const contentType = kind === "hls" ? "hls" : kind === "dash" ? "dash" : "progressive";
        await player.replaceAsync({ uri, headers, contentType });
        if (!cancelled && mountedRef.current) player.play();
      } catch {
        if (!cancelled && mountedRef.current) {
          recordFailure(engine, uri);
          if (isCircuitOpen(engine, uri)) {
            setBlocked(true);
            onStatus("loading");
          } else {
            onStatus("error");
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        player.pause();
      } catch {}
    };
  }, [blocked, engine, headers, kind, onStatus, player, setBlocked, uri]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (!mountedRef.current || blocked) return;
      if (status === "readyToPlay") {
        recordStablePlayback(engine, uri);
        onStatus("playing");
      } else if (status === "loading") {
        onStatus("loading");
      } else if (error || status === "error") {
        recordFailure(engine, uri);
        if (isCircuitOpen(engine, uri)) {
          setBlocked(true);
          onStatus("loading");
        } else {
          onStatus("error");
        }
      }
    });
    return () => sub.remove();
  }, [blocked, engine, onStatus, player, setBlocked, uri]);

  if (blocked) return null;

  return (
    <VideoView
      style={style}
      player={player}
      contentFit="contain"
      nativeControls={false}
      allowsFullscreen
    />
  );
}

export function StreamPlayer({ uri, onStatus, style }: Props) {
  const cleanUri = useMemo(() => parsePipeHeaders(uri).uri, [uri]);
  const kind = useMemo(() => detectStreamKind(cleanUri), [cleanUri]);
  const initialEngine = useMemo(() => {
    const preferred = preferredEngine(kind);
    return preferred === "vlc" && !vlcAvailable ? "media3" : preferred;
  }, [kind]);
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const stableRef = useRef(false);

  useEffect(() => {
    stableRef.current = false;
    setFallbackUsed(false);
    setEngine(initialEngine);
    onStatus("loading");
  }, [initialEngine, onStatus, uri]);

  useEffect(() => {
    if (stableRef.current) return;
    const timer = setTimeout(() => {
      if (stableRef.current || fallbackUsed) return;
      const alternate: Engine = engine === "vlc" ? "media3" : "vlc";
      if (alternate === "vlc" && !vlcAvailable) {
        onStatus("error");
        return;
      }
      setFallbackUsed(true);
      setEngine(alternate);
      onStatus("loading");
    }, ENGINE_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [engine, fallbackUsed, onStatus, uri]);

  const handleStatus = (status: StreamStatus) => {
    if (status === "playing") {
      stableRef.current = true;
      onStatus("playing");
      return;
    }
    if (status === "error" && !fallbackUsed) {
      const alternate: Engine = engine === "vlc" ? "media3" : "vlc";
      if (alternate !== "vlc" || vlcAvailable) {
        setFallbackUsed(true);
        setEngine(alternate);
        onStatus("loading");
        return;
      }
    }
    onStatus(status);
  };

  if (engine === "vlc") {
    return <VlcStream key={`vlc:${uri}`} uri={uri} onStatus={handleStatus} style={style} engine="vlc" />;
  }
  return <ExpoStream key={`media3:${uri}`} uri={uri} onStatus={handleStatus} style={style} engine="media3" />;
}
