import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, UIManager, StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { usePathname } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { addTvKeyListener } from "@/src/utils/tvRemote";
import { usePlayerEnginePreference } from "@/src/playerEnginePreference";
import {
  alternateEngine,
  detectStreamKind,
  parsePipeHeaders,
  preferredEngine,
  type Engine,
} from "@/src/core/streamPolicy";
import {
  beginSession,
  isSessionCurrent,
  pauseSessionDecoders,
  registerSessionStop,
  setSessionPhase,
  type SessionFailReason,
  type SessionRole,
} from "@/src/core/playbackSession";
import {
  DECODER_RESUME_SETTLE_MS,
  isRapidDirectionalScan,
  routeAcceptsRapidScanKey,
} from "@/src/core/guideRegressionPolicy";

export type StreamStatus = "loading" | "playing" | "error";

const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES_PER_WINDOW = 6;
/** Fullscreen-only cooldown. Preview must never poison fullscreen. */
const CIRCUIT_COOLDOWN_MS = 30_000;
const FULLSCREEN_START_TIMEOUT_MS = 12_000;
const PREVIEW_START_TIMEOUT_MS = 8_000;

type FailureState = { failures: number[]; blockedUntil: number };
const failureStateByKey = new Map<string, FailureState>();
const MAX_FAILURE_KEYS = 64;

/** Reasons that are expected during zap/recover — do not open the circuit. */
const NON_CIRCUIT_REASONS = new Set<SessionFailReason>([
  "start-timeout",
  "engine-swap",
  "circuit-open",
  "user-stop",
  "superseded",
]);

function pruneFailureMap(now = Date.now()) {
  for (const [key, state] of failureStateByKey) {
    state.failures = state.failures.filter((ts) => now - ts <= FAILURE_WINDOW_MS);
    if (state.blockedUntil <= now && state.failures.length === 0) {
      failureStateByKey.delete(key);
    } else {
      failureStateByKey.set(key, state);
    }
  }
  while (failureStateByKey.size > MAX_FAILURE_KEYS) {
    const oldest = failureStateByKey.keys().next().value;
    if (!oldest) break;
    failureStateByKey.delete(oldest);
  }
}

/** Role-scoped so guide preview failures cannot black-hole fullscreen for the same URI. */
function failureKey(role: SessionRole, engine: Engine, uri: string): string {
  return `${role}:${engine}:${uri}`;
}

function getFailureState(role: SessionRole, engine: Engine, uri: string): FailureState {
  const key = failureKey(role, engine, uri);
  const now = Date.now();
  const existing = failureStateByKey.get(key);
  if (!existing) return { failures: [], blockedUntil: 0 };
  existing.failures = existing.failures.filter((ts) => now - ts <= FAILURE_WINDOW_MS);
  if (existing.blockedUntil <= now && existing.failures.length < MAX_FAILURES_PER_WINDOW) {
    existing.blockedUntil = 0;
  }
  return existing;
}

function circuitRemainingMs(role: SessionRole, engine: Engine, uri: string): number {
  return Math.max(0, getFailureState(role, engine, uri).blockedUntil - Date.now());
}

function isCircuitOpen(role: SessionRole, engine: Engine, uri: string): boolean {
  if (role === "preview") return false;
  return circuitRemainingMs(role, engine, uri) > 0;
}

function recordFailure(
  role: SessionRole,
  engine: Engine,
  uri: string,
  reason?: SessionFailReason | null,
): void {
  // Preview is best-effort — never open a circuit that blocks later fullscreen play.
  if (!uri || role === "preview") return;
  if (reason && NON_CIRCUIT_REASONS.has(reason)) return;
  const now = Date.now();
  const key = failureKey(role, engine, uri);
  const state = getFailureState(role, engine, uri);
  state.failures.push(now);
  if (state.failures.length >= MAX_FAILURES_PER_WINDOW) state.blockedUntil = now + CIRCUIT_COOLDOWN_MS;
  failureStateByKey.set(key, state);
  pruneFailureMap(now);
}

function recordStablePlayback(role: SessionRole, engine: Engine, uri: string): void {
  if (!uri || role === "preview") return;
  const key = failureKey(role, engine, uri);
  const state = getFailureState(role, engine, uri);
  state.failures = state.failures.slice(-2);
  state.blockedUntil = 0;
  failureStateByKey.set(key, state);
}

/** Explicit Retry / user recover — clear fullscreen circuit entries for this URI. */
export function clearFullscreenCircuit(uri?: string): void {
  if (!uri) {
    for (const key of Array.from(failureStateByKey.keys())) {
      if (key.startsWith("fullscreen:")) failureStateByKey.delete(key);
    }
    return;
  }
  // Circuit keys store the pipe-stripped URI; callers often pass the raw channel.url.
  const clean = parsePipeHeaders(uri).uri || uri;
  const needles = clean === uri ? [uri] : [uri, clean];
  for (const key of Array.from(failureStateByKey.keys())) {
    if (!key.startsWith("fullscreen:")) continue;
    if (needles.some((needle) => key.endsWith(`:${needle}`))) {
      failureStateByKey.delete(key);
    }
  }
}

function useStatusTracker(
  onStatus: (status: StreamStatus, reason?: SessionFailReason | null) => void,
  resetKey: string,
) {
  const lastRef = useRef<StreamStatus | null>(null);

  useEffect(() => {
    lastRef.current = null;
  }, [resetKey]);

  return useCallback((status: StreamStatus, reason?: SessionFailReason | null) => {
    if (lastRef.current === status && reason === undefined) return;
    lastRef.current = status;
    try {
      onStatus(status, reason);
    } catch (error) {
      console.warn("CharmIPTV stream status listener failed", error);
    }
  }, [onStatus]);
}

export const vlcAvailable = Platform.OS !== "web" && !!UIManager.getViewManagerConfig?.("RCTVLCPlayer");

const VLCPlayer: any = vlcAvailable
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must be lazy outside installed builds
  ? require("react-native-vlc-media-player").VLCPlayer
  : null;

type Props = {
  uri: string;
  onStatus: (s: StreamStatus, reason?: SessionFailReason | null) => void;
  style?: StyleProp<ViewStyle>;
  mode?: "preview" | "full";
  sessionRole?: SessionRole;
  audioTrack?: number;
  textTrack?: number;
  onTracksAvailable?: (tracks: {
    audio: { id: number; name: string }[];
    text: { id: number; name: string }[];
  }) => void;
};

type EngineProps = Props & {
  engine: Engine;
  sessionRole: SessionRole;
  sessionGeneration: number;
};

function useCircuitCooldown(
  role: SessionRole,
  engine: Engine,
  uri: string,
  setStatus: (s: StreamStatus, reason?: SessionFailReason | null) => void,
) {
  const [blocked, setBlocked] = useState(() => isCircuitOpen(role, engine, uri));

  useEffect(() => {
    setBlocked(isCircuitOpen(role, engine, uri));
  }, [engine, role, uri]);

  useEffect(() => {
    if (role === "preview") {
      setBlocked(false);
      return;
    }
    const remaining = circuitRemainingMs(role, engine, uri);
    if (!blocked) {
      if (remaining > 0) setBlocked(true);
      return;
    }

    if (remaining <= 0) {
      // Cooldown finished — remount cleanly as loading (do not emit error/circuit-open,
      // which stacked with auto-retry and left a false failed state).
      setBlocked(false);
      setStatus("loading");
      return;
    }

    setStatus("loading", "circuit-open");
    const timer = setTimeout(() => {
      setBlocked(false);
      setStatus("loading");
    }, remaining + 25);
    return () => clearTimeout(timer);
  }, [blocked, engine, role, setStatus, uri]);

  return { blocked, setBlocked };
}

function VlcStream({
  uri: rawUri,
  onStatus: setStatus,
  style,
  engine,
  mode = "full",
  sessionRole,
  sessionGeneration,
  audioTrack,
  textTrack,
  onTracksAvailable,
}: EngineProps) {
  const activeRef = useRef(true);
  const tearingDownRef = useRef(false);
  const playerRef = useRef<any>(null);
  const [paused, setPaused] = useState(false);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const { blocked, setBlocked } = useCircuitCooldown(sessionRole, engine, uri, setStatus);
  const referer = headers.Referer || headers.referer;
  const origin = headers.Origin || headers.origin;
  const userAgent = headers["User-Agent"] || headers["user-agent"] || "VLC/3.0.20 LibVLC/3.0.20";
  const initOptions = useMemo(() => {
    const networkCaching = mode === "preview" ? 600 : 1400;
    const liveCaching = mode === "preview" ? 600 : 1400;
    const fileCaching = mode === "preview" ? 500 : 900;
    const options = [
      `--network-caching=${networkCaching}`,
      `--live-caching=${liveCaching}`,
      `--file-caching=${fileCaching}`,
      "--clock-jitter=0",
      "--clock-synchro=0",
      "--http-reconnect",
      "--adaptive-logic=rate",
      `--http-user-agent=${userAgent}`,
    ];
    if (referer) options.push(`--http-referrer=${referer}`);
    if (origin) options.push(`--http-origin=${origin}`);
    return options;
  }, [mode, origin, referer, userAgent]);

  const emit = useCallback(
    (status: StreamStatus, reason?: SessionFailReason | null) => {
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      setStatus(status, reason);
    },
    [sessionGeneration, sessionRole, setStatus],
  );

  const hardStop = useCallback(() => {
    tearingDownRef.current = true;
    activeRef.current = false;
    setPaused(true);
    try {
      playerRef.current?.stopPlayer?.();
    } catch {
      /* native teardown best-effort */
    }
    try {
      playerRef.current?.setNativeProps?.({ paused: true });
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    tearingDownRef.current = false;
    setPaused(false);
    const unregister = registerSessionStop(sessionRole, sessionGeneration, hardStop);
    return () => {
      unregister();
      hardStop();
    };
  }, [hardStop, sessionGeneration, sessionRole, uri]);

  const fail = useCallback(() => {
    if (tearingDownRef.current || !activeRef.current) return;
    if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
    recordFailure(sessionRole, engine, uri, "stream-error");
    if (isCircuitOpen(sessionRole, engine, uri)) {
      setBlocked(true);
      emit("loading", "circuit-open");
    } else {
      emit("error", "stream-error");
    }
  }, [emit, engine, sessionGeneration, sessionRole, setBlocked, uri]);

  if (blocked || !VLCPlayer) return null;

  return (
    <VLCPlayer
      ref={playerRef}
      style={style}
      source={{ uri, initType: 2, initOptions }}
      paused={paused}
      autoplay={!paused}
      autoAspectRatio
      resizeMode="contain"
      acceptInvalidCertificates
      audioTrack={audioTrack}
      textTrack={textTrack}
      onLoad={(info: any) => {
        const audio = Array.isArray(info?.audioTracks)
          ? info.audioTracks.map((t: any) => ({ id: Number(t.id), name: String(t.name || t.language || `Audio ${t.id}`) }))
          : [];
        const text = Array.isArray(info?.textTracks)
          ? info.textTracks.map((t: any) => ({ id: Number(t.id), name: String(t.name || t.language || `CC ${t.id}`) }))
          : [];
        onTracksAvailable?.({ audio, text });
      }}
      onOpen={() => activeRef.current && !tearingDownRef.current && !paused && emit("loading")}
      onBuffering={() => activeRef.current && !tearingDownRef.current && !paused && emit("loading")}
      onPlaying={() => {
        if (!activeRef.current || tearingDownRef.current || paused) return;
        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
        recordStablePlayback(sessionRole, engine, uri);
        emit("playing");
      }}
      onError={fail}
    />
  );
}

function ExpoStream({
  uri: rawUri,
  onStatus: setStatus,
  style,
  engine,
  mode = "full",
  sessionRole,
  sessionGeneration,
}: EngineProps) {
  const mountedRef = useRef(true);
  const tearingDownRef = useRef(false);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const kind = useMemo(() => detectStreamKind(uri), [uri]);
  const { blocked, setBlocked } = useCircuitCooldown(sessionRole, engine, uri, setStatus);
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  const emit = useCallback(
    (status: StreamStatus, reason?: SessionFailReason | null) => {
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      setStatus(status, reason);
    },
    [sessionGeneration, sessionRole, setStatus],
  );

  useEffect(() => {
    try {
      player.bufferOptions =
        mode === "preview"
          ? { preferredForwardBufferDuration: 0.6, maxBufferBytes: 6 * 1024 * 1024 }
          : { preferredForwardBufferDuration: 2, maxBufferBytes: 32 * 1024 * 1024 };
    } catch {
      /* older native builds may ignore bufferOptions */
    }
  }, [mode, player]);

  const hardStop = useCallback(() => {
    tearingDownRef.current = true;
    mountedRef.current = false;
    try {
      player.pause();
    } catch {}
    try {
      (player as any).muted = true;
    } catch {}
    try {
      void player.replaceAsync(null as any);
    } catch {}
  }, [player]);

  useEffect(() => {
    mountedRef.current = true;
    tearingDownRef.current = false;
    const unregister = registerSessionStop(sessionRole, sessionGeneration, hardStop);
    return () => {
      unregister();
      hardStop();
    };
  }, [hardStop, sessionGeneration, sessionRole]);

  useEffect(() => {
    if (!uri || blocked) return;
    if (!isSessionCurrent(sessionRole, sessionGeneration)) return;

    let cancelled = false;
    mountedRef.current = true;
    tearingDownRef.current = false;
    emit("loading");
    (async () => {
      try {
        const contentType = kind === "hls" ? "hls" : kind === "dash" ? "dash" : "progressive";
        await player.replaceAsync({ uri, headers, contentType });
        if (
          !cancelled &&
          mountedRef.current &&
          !tearingDownRef.current &&
          isSessionCurrent(sessionRole, sessionGeneration)
        ) {
          player.play();
        }
      } catch {
        if (
          !cancelled &&
          mountedRef.current &&
          !tearingDownRef.current &&
          isSessionCurrent(sessionRole, sessionGeneration)
        ) {
          recordFailure(sessionRole, engine, uri, "stream-error");
          if (isCircuitOpen(sessionRole, engine, uri)) {
            setBlocked(true);
            emit("loading", "circuit-open");
          } else {
            emit("error", "stream-error");
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      tearingDownRef.current = true;
      try {
        player.pause();
      } catch {}
      try {
        void player.replaceAsync(null as any);
      } catch {}
    };
  }, [blocked, emit, engine, headers, kind, player, sessionGeneration, sessionRole, setBlocked, uri]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (!mountedRef.current || tearingDownRef.current || blocked) return;
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      if (status === "readyToPlay") {
        recordStablePlayback(sessionRole, engine, uri);
        emit("playing");
      } else if (status === "loading") {
        emit("loading");
      } else if (error || status === "error") {
        recordFailure(sessionRole, engine, uri, "stream-error");
        if (isCircuitOpen(sessionRole, engine, uri)) {
          setBlocked(true);
          emit("loading", "circuit-open");
        } else {
          emit("error", "stream-error");
        }
      }
    });
    return () => sub.remove();
  }, [blocked, emit, engine, player, sessionGeneration, sessionRole, setBlocked, uri]);

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

export function StreamPlayer({
  uri,
  onStatus,
  style,
  mode,
  sessionRole,
  audioTrack,
  textTrack,
  onTracksAvailable,
}: Props) {
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const isGuidePreview = pathname === "/guide";
  const playbackMode = mode ?? (isGuidePreview ? "preview" : "full");
  const role: SessionRole = sessionRole ?? (playbackMode === "preview" ? "preview" : "fullscreen");
  // Player route owns zap/strip pause itself — avoid dual rapid-scan controllers.
  const pauseOnRapidScan = role === "preview";
  const [playerEnginePreference] = usePlayerEnginePreference();
  const forceVlc = playerEnginePreference === "vlc" && vlcAvailable && role !== "preview";
  const [guideScanSettled, setGuideScanSettled] = useState(true);
  const lastDirectionalAt = useRef(0);
  const rapidBurstRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(0);

  const setStatus = useStatusTracker(onStatus, `${role}:${uri}`);
  const cleanUri = useMemo(() => parsePipeHeaders(uri).uri, [uri]);
  const kind = useMemo(() => detectStreamKind(cleanUri), [cleanUri]);
  const initialEngine = useMemo(() => {
    if (forceVlc) return "vlc" as Engine;
    const preferred = preferredEngine(kind);
    return preferred === "vlc" && !vlcAvailable ? "media3" : preferred;
  }, [forceVlc, kind]);
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const stableRef = useRef(false);
  const startTimeoutMs = role === "preview" ? PREVIEW_START_TIMEOUT_MS : FULLSCREEN_START_TIMEOUT_MS;

  useEffect(() => {
    if (!isFocused || !pauseOnRapidScan || Platform.OS === "web") {
      setGuideScanSettled(true);
      rapidBurstRef.current = 0;
      return;
    }

    return addTvKeyListener((key) => {
      if (!routeAcceptsRapidScanKey(pathname, key)) return;
      const now = Date.now();
      const rapid = isRapidDirectionalScan(lastDirectionalAt.current, now);
      lastDirectionalAt.current = now;

      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (rapid) {
        rapidBurstRef.current += 1;
        // Require a sustained burst before tearing down the decoder — a single
        // quick key pair was thrashing preview/fullscreen and poisoning play.
        if (rapidBurstRef.current >= 2) {
          pauseSessionDecoders(role);
          setGuideScanSettled(false);
        }
      } else {
        rapidBurstRef.current = 0;
      }
      settleTimer.current = setTimeout(() => {
        rapidBurstRef.current = 0;
        setGuideScanSettled(true);
      }, DECODER_RESUME_SETTLE_MS);
    });
  }, [isFocused, pathname, pauseOnRapidScan, role]);

  useEffect(() => {
    if (!isFocused && settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }, [isFocused]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  useEffect(() => {
    const generation = beginSession(role);
    setSessionGeneration(generation);
    setSessionPhase(role, generation, "preparing");
    stableRef.current = false;
    setFallbackUsed(false);
    setEngine(initialEngine);
    setStatus("loading");
  }, [initialEngine, role, setStatus, uri]);

  useEffect(() => {
    if (stableRef.current || !isFocused || !guideScanSettled || !sessionGeneration) return;
    // Preview: one engine only — no swap thrash while surfing the guide.
    if (role === "preview") {
      const timer = setTimeout(() => {
        if (stableRef.current || !isSessionCurrent(role, sessionGeneration)) return;
        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");
        setStatus("error", "start-timeout");
      }, startTimeoutMs);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      if (stableRef.current || fallbackUsed) return;
      if (!isSessionCurrent(role, sessionGeneration)) return;
      const alternate = alternateEngine(engine, vlcAvailable);
      if (!alternate) {
        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");
        setStatus("error", "start-timeout");
        return;
      }
      setFallbackUsed(true);
      setEngine(alternate);
      setSessionPhase(role, sessionGeneration, "recovering", "start-timeout");
      setStatus("loading", "start-timeout");
    }, startTimeoutMs);
    return () => clearTimeout(timer);
  }, [engine, fallbackUsed, guideScanSettled, isFocused, role, sessionGeneration, setStatus, startTimeoutMs, uri]);

  const handleStatus = useCallback(
    (status: StreamStatus, reason?: SessionFailReason | null) => {
      if (!isSessionCurrent(role, sessionGeneration)) return;

      if (status === "playing") {
        stableRef.current = true;
        setSessionPhase(role, sessionGeneration, "playing");
        setStatus("playing");
        return;
      }
      // Preview stays on the first engine — logo fallback is better than swap flicker.
      if (status === "error" && role === "fullscreen" && !forceVlc && !fallbackUsed) {
        const alternate = alternateEngine(engine, vlcAvailable);
        if (alternate) {
          setFallbackUsed(true);
          setEngine(alternate);
          setSessionPhase(role, sessionGeneration, "recovering", "engine-swap");
          setStatus("loading", "engine-swap");
          return;
        }
      }
      if (status === "error") {
        setSessionPhase(role, sessionGeneration, "failed", reason ?? "stream-error");
      } else if (status === "loading" && reason) {
        setSessionPhase(role, sessionGeneration, "recovering", reason);
      } else if (status === "loading") {
        setSessionPhase(role, sessionGeneration, "preparing");
      }
      setStatus(status, reason);
    },
    [engine, fallbackUsed, forceVlc, role, sessionGeneration, setStatus],
  );

  if (!isFocused || !uri || (pauseOnRapidScan && !guideScanSettled) || !sessionGeneration) return null;

  if (engine === "vlc") {
    return (
      <VlcStream
        key={`vlc:${uri}:${sessionGeneration}`}
        uri={uri}
        onStatus={handleStatus}
        style={style}
        engine="vlc"
        mode={playbackMode}
        sessionRole={role}
        sessionGeneration={sessionGeneration}
        audioTrack={audioTrack}
        textTrack={textTrack}
        onTracksAvailable={onTracksAvailable}
      />
    );
  }
  return (
    <ExpoStream
      key={`media3:${uri}:${sessionGeneration}`}
      uri={uri}
      onStatus={handleStatus}
      style={style}
      engine="media3"
      mode={playbackMode}
      sessionRole={role}
      sessionGeneration={sessionGeneration}
    />
  );
}
