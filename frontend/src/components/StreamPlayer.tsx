import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, UIManager, StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { usePathname } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { addTvKeyListener } from "@/src/utils/tvRemote";
import { forceStopAllStreams, registerStreamStop } from "@/src/utils/streamLifecycle";
import { usePlayerEnginePreference } from "@/src/playerEnginePreference";
import {
  detectStreamKind,
  parsePipeHeaders,
  preferredEngine,
  type Engine,
} from "@/src/core/streamPolicy";
import {
  DECODER_RESUME_SETTLE_MS,
  isRapidDirectionalScan,
  routeAcceptsRapidScanKey,
} from "@/src/core/guideRegressionPolicy";

export type StreamStatus = "loading" | "playing" | "error";

const USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";
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

function useStatusTracker(onStatus: (status: StreamStatus) => void, resetKey: string) {
  const lastRef = useRef<StreamStatus | null>(null);

  useEffect(() => {
    lastRef.current = null;
  }, [resetKey]);

  return useCallback((status: StreamStatus) => {
    if (lastRef.current === status) return;
    lastRef.current = status;
    try {
      onStatus(status);
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
  onStatus: (s: StreamStatus) => void;
  style?: StyleProp<ViewStyle>;
  /** Guide live preview uses lighter VLC buffers than fullscreen playback. */
  mode?: "preview" | "full";
};

type EngineProps = Props & { engine: Engine };

function useCircuitCooldown(engine: Engine, uri: string, setStatus: (s: StreamStatus) => void) {
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
      setStatus("error");
      return;
    }

    setStatus("loading");
    const timer = setTimeout(() => {
      setBlocked(false);
      setStatus("error");
    }, remaining + 25);
    return () => clearTimeout(timer);
  }, [blocked, engine, setStatus, uri]);

  return { blocked, setBlocked };
}

function VlcStream({ uri: rawUri, onStatus: setStatus, style, engine, mode = "full" }: EngineProps) {
  const activeRef = useRef(true);
  const playerRef = useRef<any>(null);
  const [paused, setPaused] = useState(false);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const { blocked, setBlocked } = useCircuitCooldown(engine, uri, setStatus);
  const referer = headers.Referer || headers.referer;
  const origin = headers.Origin || headers.origin;
  const userAgent = headers["User-Agent"] || headers["user-agent"] || USER_AGENT;
  const initOptions = useMemo(() => {
    // Preview surfing on weak TVs: smaller buffers = faster teardown / less RAM.
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
    const unregister = registerStreamStop(hardStop);
    return () => {
      unregister();
      hardStop();
    };
  }, [hardStop, uri]);

  const fail = useCallback(() => {
    if (!activeRef.current) return;
    recordFailure(engine, uri);
    if (isCircuitOpen(engine, uri)) {
      setBlocked(true);
      setStatus("loading");
    } else {
      setStatus("error");
    }
  }, [engine, setBlocked, setStatus, uri]);

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
      onOpen={() => activeRef.current && !paused && setStatus("loading")}
      onBuffering={() => activeRef.current && !paused && setStatus("loading")}
      onPlaying={() => {
        if (!activeRef.current || paused) return;
        recordStablePlayback(engine, uri);
        setStatus("playing");
      }}
      onError={fail}
      // Do not treat intentional stop/teardown (channel zap, unmount) as a stream failure.
      // Counting onStopped here poisoned the circuit breaker on healthy channels.
    />
  );
}

function ExpoStream({ uri: rawUri, onStatus: setStatus, style, engine }: EngineProps) {
  const mountedRef = useRef(true);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const kind = useMemo(() => detectStreamKind(uri), [uri]);
  const { blocked, setBlocked } = useCircuitCooldown(engine, uri, setStatus);
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

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
    const unregister = registerStreamStop(hardStop);
    return () => {
      unregister();
      hardStop();
    };
  }, [hardStop]);

  useEffect(() => {
    if (!uri || blocked) return;

    let cancelled = false;
    mountedRef.current = true;
    setStatus("loading");
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
            setStatus("loading");
          } else {
            setStatus("error");
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
  }, [blocked, engine, headers, kind, player, setBlocked, setStatus, uri]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (!mountedRef.current || blocked) return;
      if (status === "readyToPlay") {
        recordStablePlayback(engine, uri);
        setStatus("playing");
      } else if (status === "loading") {
        setStatus("loading");
      } else if (error || status === "error") {
        recordFailure(engine, uri);
        if (isCircuitOpen(engine, uri)) {
          setBlocked(true);
          setStatus("loading");
        } else {
          setStatus("error");
        }
      }
    });
    return () => sub.remove();
  }, [blocked, engine, player, setBlocked, setStatus, uri]);

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

export function StreamPlayer({ uri, onStatus, style, mode }: Props) {
  const isFocused = useIsFocused();
  const pathname = usePathname();
  // Purple TV keeps the live preview on its dedicated /guide route rather
  // than the root dashboard used by perf/opt-fix.
  const isGuidePreview = pathname === "/guide";
  const playbackMode = mode ?? (isGuidePreview ? "preview" : "full");
  // Player strip surfing also benefits from pausing decoder work while holding D-pad.
  const pauseOnRapidScan = isGuidePreview || pathname === "/player";
  const [playerEnginePreference] = usePlayerEnginePreference();
  const forceVlc = playerEnginePreference === "vlc" && vlcAvailable && !isGuidePreview;
  const [guideScanSettled, setGuideScanSettled] = useState(true);
  const lastDirectionalAt = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatus = useStatusTracker(onStatus, uri);
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
      // Guide: all directions compete with list recycling. Player: only strip L/R zaps.
      if (!routeAcceptsRapidScanKey(pathname, key)) return;
      const now = Date.now();
      const rapid = isRapidDirectionalScan(lastDirectionalAt.current, now);
      lastDirectionalAt.current = now;

      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (rapid) {
        // Tear down decoder immediately — unmount alone can leave VLC audio alive on Fire TV.
        forceStopAllStreams();
        setGuideScanSettled(false);
      }
      settleTimer.current = setTimeout(() => {
        setGuideScanSettled(true);
      }, DECODER_RESUME_SETTLE_MS);
    });
  }, [isFocused, isGuidePreview, pathname, pauseOnRapidScan]);

  useEffect(() => {
    // Blur unmounts the engine child (see render gate below); that child's cleanup
    // hardStops itself. Do not forceStopAllStreams here — it can kill a newly
    // mounted fullscreen player while the guide preview is blurring away.
    if (!isFocused && settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }, [isFocused]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      // Child VlcStream/ExpoStream unregister + hardStop on their own unmount.
      // Global forceStop is reserved for explicit zap / play() teardown.
    },
    [],
  );

  useEffect(() => {
    stableRef.current = false;
    setFallbackUsed(false);
    setEngine(initialEngine);
    setStatus("loading");
  }, [initialEngine, setStatus, uri]);

  useEffect(() => {
    if (stableRef.current || !isFocused || !guideScanSettled) return;
    const timer = setTimeout(() => {
      if (stableRef.current || fallbackUsed) return;
      const alternate: Engine = engine === "vlc" ? "media3" : "vlc";
      if (alternate === "vlc" && !vlcAvailable) {
        setStatus("error");
        return;
      }
      // Forced VLC still gets one Media3 escape hatch after start timeout.
      setFallbackUsed(true);
      setEngine(alternate);
      setStatus("loading");
    }, ENGINE_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [engine, fallbackUsed, guideScanSettled, isFocused, setStatus, uri]);

  const handleStatus = useCallback((status: StreamStatus) => {
    if (status === "playing") {
      stableRef.current = true;
      setStatus("playing");
      return;
    }
    if (status === "error" && !forceVlc && !fallbackUsed) {
      const alternate: Engine = engine === "vlc" ? "media3" : "vlc";
      if (alternate !== "vlc" || vlcAvailable) {
        setFallbackUsed(true);
        setEngine(alternate);
        setStatus("loading");
        return;
      }
    }
    setStatus(status);
  }, [engine, fallbackUsed, forceVlc, setStatus]);

  // During a held D-pad scan (guide preview or player strip) the decoder is
  // temporarily unmounted. It comes back after the final key settles so
  // decoder/GPU work doesn't compete with focus recycling. Hidden routes stop too.
  if (!isFocused || !uri || (pauseOnRapidScan && !guideScanSettled)) return null;

  if (engine === "vlc") {
    return <VlcStream key={`vlc:${uri}`} uri={uri} onStatus={handleStatus} style={style} engine="vlc" mode={playbackMode} />;
  }
  return <ExpoStream key={`media3:${uri}`} uri={uri} onStatus={handleStatus} style={style} engine="media3" mode={playbackMode} />;
}
