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
const MAX_FAILURES_PER_WINDOW = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;
const ENGINE_START_TIMEOUT_MS = 12_000;

type FailureState = { failures: number[]; blockedUntil: number };
const failureStateByKey = new Map<string, FailureState>();
const MAX_FAILURE_KEYS = 64;

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
  pruneFailureMap(now);
}

function recordStablePlayback(engine: Engine, uri: string): void {
  if (!uri) return;
  const key = failureKey(engine, uri);
  const state = getFailureState(engine, uri);
  state.failures = state.failures.slice(-2);
  state.blockedUntil = 0;
  failureStateByKey.set(key, state);
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
  /** Guide live preview uses lighter VLC buffers than fullscreen playback. */
  mode?: "preview" | "full";
  /** Explicit session owner. Defaults from mode. */
  sessionRole?: SessionRole;
};

type EngineProps = Props & {
  engine: Engine;
  sessionRole: SessionRole;
  sessionGeneration: number;
};

function useCircuitCooldown(engine: Engine, uri: string, setStatus: (s: StreamStatus, reason?: SessionFailReason | null) => void) {
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
      setStatus("error", "circuit-open");
      return;
    }

    setStatus("loading", "circuit-open");
    const timer = setTimeout(() => {
      setBlocked(false);
      setStatus("error", "circuit-open");
    }, remaining + 25);
    return () => clearTimeout(timer);
  }, [blocked, engine, setStatus, uri]);

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
}: EngineProps) {
  const activeRef = useRef(true);
  const playerRef = useRef<any>(null);
  const [paused, setPaused] = useState(false);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const { blocked, setBlocked } = useCircuitCooldown(engine, uri, setStatus);
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
    setPaused(false);
    const unregister = registerSessionStop(sessionRole, sessionGeneration, hardStop);
    return () => {
      unregister();
      hardStop();
    };
  }, [hardStop, sessionGeneration, sessionRole, uri]);

  const fail = useCallback(() => {
    if (!activeRef.current) return;
    if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
    recordFailure(engine, uri);
    if (isCircuitOpen(engine, uri)) {
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
      onOpen={() => activeRef.current && !paused && emit("loading")}
      onBuffering={() => activeRef.current && !paused && emit("loading")}
      onPlaying={() => {
        if (!activeRef.current || paused) return;
        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
        recordStablePlayback(engine, uri);
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
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const kind = useMemo(() => detectStreamKind(uri), [uri]);
  const { blocked, setBlocked } = useCircuitCooldown(engine, uri, setStatus);
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
          : { preferredForwardBufferDuration: 2, maxBufferBytes: 48 * 1024 * 1024 };
    } catch {
      /* older native builds may ignore bufferOptions */
    }
  }, [mode, player]);

  const hardStop = useCallback(() => {
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
    emit("loading");
    (async () => {
      try {
        const contentType = kind === "hls" ? "hls" : kind === "dash" ? "dash" : "progressive";
        await player.replaceAsync({ uri, headers, contentType });
        if (!cancelled && mountedRef.current && isSessionCurrent(sessionRole, sessionGeneration)) {
          player.play();
        }
      } catch {
        if (!cancelled && mountedRef.current && isSessionCurrent(sessionRole, sessionGeneration)) {
          recordFailure(engine, uri);
          if (isCircuitOpen(engine, uri)) {
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
      if (!mountedRef.current || blocked) return;
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      if (status === "readyToPlay") {
        recordStablePlayback(engine, uri);
        emit("playing");
      } else if (status === "loading") {
        emit("loading");
      } else if (error || status === "error") {
        recordFailure(engine, uri);
        if (isCircuitOpen(engine, uri)) {
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

export function StreamPlayer({ uri, onStatus, style, mode, sessionRole }: Props) {
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const isGuidePreview = pathname === "/guide";
  const playbackMode = mode ?? (isGuidePreview ? "preview" : "full");
  const role: SessionRole = sessionRole ?? (playbackMode === "preview" ? "preview" : "fullscreen");
  const pauseOnRapidScan = role === "preview" || pathname === "/player";
  const [playerEnginePreference] = usePlayerEnginePreference();
  const forceVlc = playerEnginePreference === "vlc" && vlcAvailable && role !== "preview";
  const [guideScanSettled, setGuideScanSettled] = useState(true);
  const lastDirectionalAt = useRef(0);
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

  useEffect(() => {
    if (!isFocused || !pauseOnRapidScan || Platform.OS === "web") {
      setGuideScanSettled(true);
      return;
    }

    return addTvKeyListener((key) => {
      if (!routeAcceptsRapidScanKey(pathname, key)) return;
      const now = Date.now();
      const rapid = isRapidDirectionalScan(lastDirectionalAt.current, now);
      lastDirectionalAt.current = now;

      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (rapid) {
        // Pause only this role — never tear down the sibling session.
        pauseSessionDecoders(role);
        setGuideScanSettled(false);
      }
      settleTimer.current = setTimeout(() => {
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
    // New URI / engine preference → new generation for this role only.
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
    }, ENGINE_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [engine, fallbackUsed, guideScanSettled, isFocused, role, sessionGeneration, setStatus, uri]);

  const handleStatus = useCallback(
    (status: StreamStatus, reason?: SessionFailReason | null) => {
      if (!isSessionCurrent(role, sessionGeneration)) return;

      if (status === "playing") {
        stableRef.current = true;
        setSessionPhase(role, sessionGeneration, "playing");
        setStatus("playing");
        return;
      }
      if (status === "error" && !forceVlc && !fallbackUsed) {
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
