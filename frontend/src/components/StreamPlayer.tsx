import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, UIManager, StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { usePathname } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { usePlayerEnginePreference } from "@/src/playerEnginePreference";
import {
  alternateEngine,
  detectStreamKind,
  media3ContentType,
  parsePipeHeaders,
  preferredEngine,
  type Engine,
} from "@/src/core/streamPolicy";
import {
  beginSession,
  isSessionCurrent,
  registerSessionStop,
  setSessionPhase,
  type SessionFailReason,
  type SessionRole,
} from "@/src/core/playbackSession";
import {
  fingerprintStreamUri,
  recordAudioDiagnostics,
} from "@/src/core/audioDiagnostics";
import {
  getRememberedStreamEngine,
  rememberSuccessfulStreamEngine,
} from "@/src/core/streamEngineMemory";
import {
  usePlaybackBufferProfile,
  type PlaybackBufferProfile,
} from "@/src/core/playbackBufferProfile";
import { usePlayerCompatibilityPreferences } from "@/src/core/playerCompatibilityPreferences";
import { shouldUseLowRamTuning, useDeviceMemoryProfile } from "@/src/core/deviceMemoryProfile";
import {
  getPreferredAudioLanguage,
  getRememberedChannelAudioTrack,
  pickPreferredAudioTrack,
} from "@/src/core/audioTrackPreferences";
import { setNativePlaybackStarting } from "@/src/utils/tvRemote";

export type StreamStatus = "loading" | "playing" | "error";
export type PlayerScaleMode = "fit" | "zoom" | "stretch";

export type StreamTrack = {
  id: string | number;
  name: string;
  mimeType?: string | null;
  isSupported?: boolean;
};

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
  "silent-audio",
  "user-stop",
  "superseded",
]);
/** After Media3 reports playing, wait this long for audio tracks before VLC swap. */
const SILENT_AUDIO_GRACE_MS = 2200;
const STALL_RECOVERY_NUDGE_MS = 7000;
const FROZEN_VIDEO_WATCHDOG_MS = 18000;

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

/** True while any fullscreen engine circuit is cooling down for this URI. */
export function isFullscreenCircuitOpen(uri?: string): boolean {
  if (!uri) return false;
  const clean = parsePipeHeaders(uri).uri || uri;
  return (
    isCircuitOpen("fullscreen", "media3", uri) ||
    isCircuitOpen("fullscreen", "vlc", uri) ||
    (clean !== uri &&
      (isCircuitOpen("fullscreen", "media3", clean) || isCircuitOpen("fullscreen", "vlc", clean)))
  );
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
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    lastRef.current = null;
  }, [resetKey]);

  return useCallback((status: StreamStatus, reason?: SessionFailReason | null) => {
    if (lastRef.current === status && reason === undefined) return;
    lastRef.current = status;
    try {
      onStatusRef.current(status, reason);
    } catch (error) {
      console.warn("CharmIPTV stream status listener failed", error);
    }
  }, []);
}

export const vlcAvailable = Platform.OS !== "web" && !!UIManager.getViewManagerConfig?.("RCTVLCPlayer");

const VLCPlayer: any = vlcAvailable
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must be lazy outside installed builds
  ? require("react-native-vlc-media-player").VLCPlayer
  : null;

type Props = {
  uri: string;
  /** Stable channel id for bounded successful-engine memory (URI tokens rotate). */
  channelKey?: string;
  onStatus: (s: StreamStatus, reason?: SessionFailReason | null) => void;
  style?: StyleProp<ViewStyle>;
  mode?: "preview" | "full";
  sessionRole?: SessionRole;
  /** When true, Media3/VLC start muted (guide preview default). */
  muted?: boolean;
  audioTrack?: string | number;
  textTrack?: string | number | null;
  onTracksAvailable?: (tracks: {
    audio: StreamTrack[];
    text: StreamTrack[];
  }) => void;
  bufferProfile?: PlaybackBufferProfile;
  paused?: boolean;
  scaleMode?: PlayerScaleMode;
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

    // Surface the cooldown as an error overlay instead of a silent black player.
    setStatus("error", "circuit-open");
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
  muted = false,
  audioTrack,
  textTrack,
  onTracksAvailable,
  bufferProfile = "balanced",
  paused = false,
  scaleMode = "fit",
}: EngineProps) {
  const activeRef = useRef(true);
  const tearingDownRef = useRef(false);
  const playerRef = useRef<any>(null);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const { blocked, setBlocked } = useCircuitCooldown(sessionRole, engine, uri, setStatus);
  const referer = headers.Referer || headers.referer;
  const origin = headers.Origin || headers.origin;
  const userAgent = headers["User-Agent"] || headers["user-agent"] || "VLC/3.0.20 LibVLC/3.0.20";
  const playerCompat = usePlayerCompatibilityPreferences();
  const deviceMemory = useDeviceMemoryProfile();
  const lowRam = shouldUseLowRamTuning(deviceMemory);
  const initOptions = useMemo(() => {
    const requestedMs = bufferProfile === "low_latency" ? 1200 : bufferProfile === "stable" ? 5200 : 3000;
    const fullMs = lowRam ? Math.min(requestedMs, 3000) : requestedMs;
    const networkCaching = mode === "preview" ? 1000 : fullMs;
    const liveCaching = mode === "preview" ? 1000 : fullMs;
    const fileCaching = mode === "preview" ? 700 : Math.round(fullMs * 0.62);
    const audioOutput = playerCompat.vlcAudioOutput;
    const hardwareDecode = playerCompat.vlcHardwareDecode;
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
    if (!hardwareDecode) options.push("--avcodec-hw=none");
    // stereo-mode=1 forces a 2-channel mix/downmix (not stereo_widen).
    if (audioOutput === "stereo") options.push("--stereo-mode=1");
    if (audioOutput === "passthrough") {
      options.push("--aout=android_audiotrack");
      options.push("--audio-digital-hdmi-passthrough");
    }
    if (referer) options.push(`--http-referrer=${referer}`);
    if (origin) options.push(`--http-origin=${origin}`);
    return options;
  }, [
    bufferProfile,
    lowRam,
    mode,
    origin,
    playerCompat.vlcAudioOutput,
    playerCompat.vlcHardwareDecode,
    referer,
    userAgent,
  ]);
  const mediaOptions = useMemo(
    () =>
      Object.entries(headers)
        .filter(([key]) => !/^(?:user-agent|referer|origin)$/i.test(key))
        .map(([key, value]) => `:http-header=${key}: ${value}`),
    [headers],
  );

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
    // Soft-stop while mounted. A destructive `clear` releases LibVLC but leaves
    // the same React native view/source in place, producing a permanent black
    // surface until a remount.
    try {
      playerRef.current?.stopPlayer?.();
    } catch {
      /* native teardown best-effort */
    }
    try {
      playerRef.current?.setNativeProps?.({ paused: true });
    } catch {
      /* native teardown best-effort */
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    tearingDownRef.current = false;
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
      // Stop LibVLC before unmounting the native view — otherwise blocked→null
      // leaks a running decoder until a later remount.
      hardStop();
      setBlocked(true);
      emit("loading", "circuit-open");
    } else {
      emit("error", "stream-error");
    }
  }, [emit, engine, hardStop, sessionGeneration, sessionRole, setBlocked, uri]);

  useEffect(() => {
    if (!blocked) return;
    hardStop();
  }, [blocked, hardStop]);

  if (blocked || !VLCPlayer) return null;

  return (
    <VLCPlayer
      ref={playerRef}
      style={style}
      source={{ uri, initType: 2, initOptions, mediaOptions }}
      paused={paused}
      autoplay={!paused}
      autoAspectRatio={scaleMode !== "stretch"}
      resizeMode={scaleMode === "zoom" ? "cover" : scaleMode === "stretch" ? "stretch" : "contain"}
      acceptInvalidCertificates
      muted={muted}
      volume={muted ? 0 : 100}
      audioTrack={typeof audioTrack === "number" ? audioTrack : undefined}
      textTrack={typeof textTrack === "number" ? textTrack : undefined}
      onLoad={(info: any) => {
        const audio = Array.isArray(info?.audioTracks)
          ? info.audioTracks.map((t: any) => ({ id: Number(t.id), name: String(t.name || t.language || `Audio ${t.id}`) }))
          : [];
        const text = Array.isArray(info?.textTracks)
          ? info.textTracks.map((t: any) => ({ id: Number(t.id), name: String(t.name || t.language || `CC ${t.id}`) }))
          : [];
        onTracksAvailable?.({ audio, text });
      }}
      onOpen={() => activeRef.current && !tearingDownRef.current && emit("loading")}
      onBuffering={() => activeRef.current && !tearingDownRef.current && emit("loading")}
      onPlaying={() => {
        if (!activeRef.current || tearingDownRef.current) return;
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
  channelKey,
  onStatus: setStatus,
  style,
  engine,
  mode = "full",
  sessionRole,
  sessionGeneration,
  muted = false,
  audioTrack,
  textTrack,
  onTracksAvailable,
  bufferProfile = "balanced",
  paused = false,
  scaleMode = "fit",
}: EngineProps) {
  const mountedRef = useRef(true);
  const tearingDownRef = useRef(false);
  const loadIdRef = useRef(0);
  const replaceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const tracksCallbackRef = useRef(onTracksAvailable);
  const lastPlaybackTimeRef = useRef(-1);
  const lastPlaybackAdvanceAtRef = useRef(Date.now());
  const lastStallNudgeAtRef = useRef(0);
  tracksCallbackRef.current = onTracksAvailable;
  const [mediaReady, setMediaReady] = useState(false);
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const kind = useMemo(() => detectStreamKind(uri), [uri]);
  const { blocked, setBlocked } = useCircuitCooldown(sessionRole, engine, uri, setStatus);
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
  });

  const emit = useCallback(
    (status: StreamStatus, reason?: SessionFailReason | null) => {
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      setStatus(status, reason);
    },
    [sessionGeneration, sessionRole, setStatus],
  );

  const playerCompat = usePlayerCompatibilityPreferences();
  const deviceMemory = useDeviceMemoryProfile();
  const lowRam = shouldUseLowRamTuning(deviceMemory);
  useEffect(() => {
    try {
      const tunneling = playerCompat.media3Tunneling;
      const media3Audio = playerCompat.media3AudioMode;
      // Tunneling prefers shorter forward buffers; ffmpeg mode keeps a slightly
      // larger decode cushion because the extension path is heavier on weak SoCs.
      const profile = tunneling && bufferProfile !== "stable" ? "low_latency" : bufferProfile;
      const full = profile === "low_latency"
        ? {
            preferredForwardBufferDuration: lowRam ? 1.8 : (media3Audio === "ffmpeg" ? 2.8 : 2.2),
            maxBufferBytes: (lowRam ? 20 : (media3Audio === "ffmpeg" ? 40 : 32)) * 1024 * 1024,
          }
        : profile === "stable"
          ? { preferredForwardBufferDuration: lowRam ? 5 : 10, maxBufferBytes: (lowRam ? 32 : 64) * 1024 * 1024 }
          : {
              preferredForwardBufferDuration: lowRam ? 3.5 : (media3Audio === "ffmpeg" ? 6 : 5),
              maxBufferBytes: (lowRam ? 28 : (media3Audio === "ffmpeg" ? 60 : 52)) * 1024 * 1024,
            };
      const coordinatedCacheBudget = Math.max(
        8 * 1024 * 1024,
        Math.min(
          deviceMemory?.playerCacheBytes || Number.MAX_SAFE_INTEGER,
          deviceMemory?.vodCacheBytes || Number.MAX_SAFE_INTEGER,
        ),
      );
      player.bufferOptions = mode === "preview"
        ? {
            preferredForwardBufferDuration: 1.2,
            maxBufferBytes: Math.min(12 * 1024 * 1024, coordinatedCacheBudget),
          }
        : { ...full, maxBufferBytes: Math.min(full.maxBufferBytes, coordinatedCacheBudget) };
    } catch {
      /* older native builds may ignore bufferOptions */
    }
    try {
      // Fullscreen TV playback must own AUDIOFOCUS_GAIN. Expo's default "auto"
      // usually does this too; doNotMix makes it deterministic after preview /
      // decoder handoff and avoids a silent focused player losing focus to a
      // stale background audio session.
      player.audioMixingMode = mode === "preview" ? "mixWithOthers" : "doNotMix";
    } catch {
      /* older native builds may not expose audio mixing mode */
    }
  }, [
    bufferProfile,
    deviceMemory?.playerCacheBytes,
    deviceMemory?.vodCacheBytes,
    lowRam,
    mode,
    player,
    playerCompat.media3AudioMode,
    playerCompat.media3Tunneling,
  ]);

  const reportAndSelectMedia3Tracks = useCallback(() => {
    try {
      const audioTracks = Array.isArray(player.availableAudioTracks) ? player.availableAudioTracks : [];
      const supportedTracks = audioTracks.filter((track: any) => track.isSupported !== false);
      const media3Audio = playerCompat.media3AudioMode;
      const mappedTracks = audioTracks.map((track: any) => ({
        id: track.id,
        name: [track.label || track.language || `Audio ${track.id}`, track.mimeType].filter(Boolean).join(" · "),
        mimeType: track.mimeType,
        isSupported: track.isSupported !== false,
        language: track.language,
        raw: track,
      }));
      const preferred = audioTrack == null
        ? pickPreferredAudioTrack(
            mappedTracks,
            getRememberedChannelAudioTrack(channelKey),
            getPreferredAudioLanguage(),
          )
        : undefined;
      const preferredRaw = preferred
        ? audioTracks.find((track: any) => String(track.id) === String(preferred.id)) || null
        : null;
      // device mode prefers isSupported tracks; ffmpeg mode will still try unsupported
      // tracks before falling back because the FFmpeg extension may decode them.
      const candidatePool = media3Audio === "device"
        ? supportedTracks
        : media3Audio === "ffmpeg"
          ? audioTracks
          : supportedTracks.length
            ? supportedTracks
            : audioTracks;
      const requestedAudio = audioTrack == null
        ? preferredRaw
        : audioTracks.find((track) => String(track.id) === String(audioTrack)) || null;
      const currentAudio = player.audioTrack as any;
      const automaticSupported = candidatePool[0] || supportedTracks[0] || null;

      let selectedAudio: any = null;
      let selectedBy: "user" | "current" | "auto-supported" | "auto-first" | "none" = "none";
      // isSupported is supplied by the checked-in expo-video native patch but
      // is not part of Expo's upstream AudioTrack TypeScript declaration.
      if (requestedAudio && (media3Audio === "ffmpeg" || (requestedAudio as any).isSupported !== false)) {
        selectedAudio = requestedAudio;
        selectedBy = audioTrack == null ? "auto-supported" : "user";
      } else if (currentAudio && (media3Audio === "ffmpeg" || currentAudio.isSupported !== false)) {
        selectedAudio = currentAudio;
        selectedBy = "current";
      } else if (automaticSupported) {
        selectedAudio = automaticSupported;
        selectedBy = "auto-supported";
      } else if (requestedAudio) {
        selectedAudio = requestedAudio;
        selectedBy = audioTrack == null ? "auto-first" : "user";
      } else if (currentAudio) {
        selectedAudio = currentAudio;
        selectedBy = "current";
      } else if (audioTracks[0]) {
        selectedAudio = audioTracks[0];
        selectedBy = "auto-first";
      }

      // Displace an unsupported selection when a supported track exists.
      if (selectedAudio && selectedAudio.isSupported === false && automaticSupported) {
        selectedAudio = automaticSupported;
        selectedBy = "auto-supported";
      }

      if (selectedAudio && player.audioTrack?.id !== selectedAudio.id) {
        player.audioTrack = selectedAudio;
      }

      const subtitleTracks = Array.isArray(player.availableSubtitleTracks) ? player.availableSubtitleTracks : [];
      if (textTrack == null) {
        // Explicit Off — clear any engine-selected subtitle so CC does not stick.
        if (player.subtitleTrack != null) {
          try {
            player.subtitleTrack = null;
          } catch {
            /* older expo-video */
          }
        }
      } else {
        const selectedText = subtitleTracks.find((track) => String(track.id) === String(textTrack));
        if (selectedText && player.subtitleTrack?.id !== selectedText.id) {
          player.subtitleTrack = selectedText;
        }
      }

      tracksCallbackRef.current?.({
        audio: audioTracks.map((track: any) => ({
          id: track.id,
          name: [track.label || track.language || `Audio ${track.id}`, track.mimeType].filter(Boolean).join(" · "),
          mimeType: track.mimeType,
          isSupported: track.isSupported !== false,
        })),
        text: subtitleTracks.map((track: any) => ({
          id: track.id,
          name: String(track.label || track.language || `CC ${track.id}`),
        })),
      });

      recordAudioDiagnostics({
        engine: "media3",
        role: sessionRole,
        streamKey: fingerprintStreamUri(uri, kind),
        trackId: selectedAudio?.id ?? null,
        mimeType: selectedAudio?.mimeType ?? null,
        language: selectedAudio?.language ?? null,
        label: selectedAudio?.label ?? null,
        isSupported: selectedAudio ? selectedAudio.isSupported !== false : null,
        trackCount: audioTracks.length,
        supportedCount: supportedTracks.length,
        selectedBy,
        silentAudio: false,
        reason: `mode=${media3Audio};tunnel=${playerCompat.media3Tunneling ? 1 : 0}`,
      });

      // FFmpeg mode may decode tracks marked isSupported=false. Treat a selected
      // track as success so silent-audio fallback does not false-trigger.
      if (media3Audio === "ffmpeg") return selectedAudio != null && audioTracks.length > 0;
      return supportedTracks.length > 0;
    } catch {
      return false;
    }
  }, [
    audioTrack,
    channelKey,
    kind,
    player,
    playerCompat.media3AudioMode,
    playerCompat.media3Tunneling,
    sessionRole,
    textTrack,
    uri,
  ]);

  // Settings changes must re-apply track selection without waiting for a channel change.
  useEffect(() => {
    if (!mediaReady || blocked) return;
    reportAndSelectMedia3Tracks();
  }, [blocked, mediaReady, playerCompat.media3AudioMode, reportAndSelectMedia3Tracks]);

  const hardStop = useCallback(() => {
    loadIdRef.current += 1;
    tearingDownRef.current = true;
    mountedRef.current = false;
    try {
      player.pause();
    } catch {}
    if (mode === "preview") {
      void player.replaceAsync(null as any).catch(() => undefined);
    } else {
      replaceQueueRef.current = replaceQueueRef.current
        .catch(() => undefined)
        .then(() => player.replaceAsync(null as any))
        .catch(() => undefined);
    }
  }, [mode, player]);

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
    const loadId = ++loadIdRef.current;
    mountedRef.current = true;
    tearingDownRef.current = false;
    setMediaReady(false);
    emit("loading");
    (async () => {
      try {
        const contentType = media3ContentType(kind);
        const load = mode === "preview"
          ? player.replaceAsync({ uri, headers, contentType })
          : replaceQueueRef.current
              .catch(() => undefined)
              .then(async () => {
                if (cancelled || loadId !== loadIdRef.current) return;
                await player.replaceAsync({ uri, headers, contentType });
              });
        if (mode !== "preview") replaceQueueRef.current = load.catch(() => undefined);
        await load;
        if (
          !cancelled &&
          loadId === loadIdRef.current &&
          mountedRef.current &&
          !tearingDownRef.current &&
          isSessionCurrent(sessionRole, sessionGeneration)
        ) {
          try {
            player.muted = muted;
            player.volume = muted ? 0 : 1;
          } catch {}
          if (!paused) player.play();
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
      loadIdRef.current += 1;
      tearingDownRef.current = true;
      try {
        player.pause();
      } catch {}
      if (mode === "preview") {
        void player.replaceAsync(null as any).catch(() => undefined);
      } else {
        replaceQueueRef.current = replaceQueueRef.current
          .catch(() => undefined)
          .then(() => player.replaceAsync(null as any))
          .catch(() => undefined);
      }
    };
  }, [blocked, emit, engine, headers, kind, mode, muted, paused, player, sessionGeneration, sessionRole, setBlocked, uri]);

  useEffect(() => {
    if (!mediaReady || blocked) return;
    try {
      if (paused) player.pause();
      else player.play();
    } catch {}
  }, [blocked, mediaReady, paused, player]);

  useEffect(() => {
    try {
      player.muted = muted;
      player.volume = muted ? 0 : 1;
    } catch {
      /* older native builds */
    }
  }, [muted, player]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (!mountedRef.current || tearingDownRef.current || blocked) return;
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      if (status === "readyToPlay") {
        lastPlaybackTimeRef.current = player.currentTime;
        lastPlaybackAdvanceAtRef.current = Date.now();
        setMediaReady(true);
        reportAndSelectMedia3Tracks();
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
  }, [blocked, emit, engine, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, setBlocked, uri]);

  useEffect(() => {
    const progressSub = player.addListener("timeUpdate", ({ currentTime }) => {
      if (currentTime > lastPlaybackTimeRef.current + 0.05) {
        lastPlaybackTimeRef.current = currentTime;
        lastPlaybackAdvanceAtRef.current = Date.now();
      }
    });
    if (mode === "preview" || paused || blocked || !mediaReady) {
      return () => progressSub.remove();
    }
    lastPlaybackTimeRef.current = player.currentTime;
    lastPlaybackAdvanceAtRef.current = Date.now();
    const watchdog = setInterval(() => {
      if (!mountedRef.current || tearingDownRef.current || paused || blocked) return;
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      const stalledFor = Date.now() - lastPlaybackAdvanceAtRef.current;
      if (stalledFor >= STALL_RECOVERY_NUDGE_MS && stalledFor < FROZEN_VIDEO_WATCHDOG_MS) {
        // A live HLS/TS source can legitimately stop advancing for several
        // seconds while waiting for the next provider segment. Nudge play once
        // without tearing down sockets/decoders; only escalate a sustained stall.
        if (Date.now() - lastStallNudgeAtRef.current >= STALL_RECOVERY_NUDGE_MS) {
          lastStallNudgeAtRef.current = Date.now();
          try { player.play(); } catch {}
        }
        return;
      }
      if (stalledFor < FROZEN_VIDEO_WATCHDOG_MS) return;
      lastPlaybackAdvanceAtRef.current = Date.now();
      lastStallNudgeAtRef.current = 0;
      recordFailure(sessionRole, engine, uri, "stream-error");
      emit("error", "stream-error");
    }, 1000);
    return () => {
      progressSub.remove();
      clearInterval(watchdog);
    };
  }, [blocked, emit, engine, mediaReady, mode, paused, player, sessionGeneration, sessionRole, uri]);

  useEffect(() => {
    const onTracksChanged = () => {
      reportAndSelectMedia3Tracks();
    };
    const audioSub = player.addListener("availableAudioTracksChange", onTracksChanged);
    const textSub = player.addListener("availableSubtitleTracksChange", onTracksChanged);
    reportAndSelectMedia3Tracks();
    return () => {
      audioSub.remove();
      textSub.remove();
    };
  }, [player, reportAndSelectMedia3Tracks, uri]);

  // Media3 can paint video while failing to expose/decode audio (AC-3 etc.).
  // Soft-fail when no supported audio track appears after grace so default mode
  // can swap to VLC. Media3-only mode still emits silent-audio for UI messaging.
  useEffect(() => {
    if (blocked || mode === "preview" || !mediaReady) return;
    let cancelled = false;
    let sawSupportedAudio = false;
    const markAudio = () => {
      sawSupportedAudio = reportAndSelectMedia3Tracks() || sawSupportedAudio;
    };
    markAudio();
    const trackSub = player.addListener("availableAudioTracksChange", markAudio);
    const timer = setTimeout(() => {
      if (cancelled || !mountedRef.current || tearingDownRef.current) return;
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      markAudio();
      if (sawSupportedAudio) return;
      recordAudioDiagnostics({
        engine: "media3",
        role: sessionRole,
        streamKey: fingerprintStreamUri(uri, kind),
        trackId: player.audioTrack?.id ?? null,
        mimeType: (player.audioTrack as any)?.mimeType ?? null,
        language: (player.audioTrack as any)?.language ?? null,
        label: (player.audioTrack as any)?.label ?? null,
        isSupported: false,
        trackCount: Array.isArray(player.availableAudioTracks) ? player.availableAudioTracks.length : 0,
        supportedCount: 0,
        selectedBy: "none",
        silentAudio: true,
        reason: "silent-audio",
      });
      emit("error", "silent-audio");
    }, SILENT_AUDIO_GRACE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      try {
        trackSub.remove();
      } catch {}
    };
  }, [blocked, emit, kind, mediaReady, mode, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, uri]);

  if (blocked) return null;

  return (
    <VideoView
      style={style}
      player={player}
      contentFit={scaleMode === "zoom" ? "cover" : scaleMode === "stretch" ? "fill" : "contain"}
      // Keep preview compositable above the Guide; fullscreen gets the cheaper hardware SurfaceView.
      surfaceType={Platform.OS === "android" ? (mode === "preview" ? "textureView" : "surfaceView") : undefined}
      nativeControls={false}
      useExoShutter
    />
  );
}

export function StreamPlayer({
  uri,
  channelKey,
  onStatus,
  style,
  mode,
  sessionRole,
  muted = false,
  audioTrack,
  textTrack,
  onTracksAvailable,
  bufferProfile,
  paused = false,
  scaleMode = "fit",
}: Props) {
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const isGuidePreview = pathname === "/guide";
  const playbackMode = mode ?? (isGuidePreview ? "preview" : "full");
  const role: SessionRole = sessionRole ?? (playbackMode === "preview" ? "preview" : "fullscreen");
  // RN may report null/unknown AppState during initial bridge startup. Treat
  // anything except an explicit background/inactive event as active.
  const [appActive, setAppActive] = useState(
    () => AppState.currentState !== "background" && AppState.currentState !== "inactive",
  );
  const playbackFocused = isFocused && appActive;
  const [playerEnginePreference] = usePlayerEnginePreference();
  const [savedBufferProfile] = usePlaybackBufferProfile();
  const playerCompat = usePlayerCompatibilityPreferences();
  const effectiveBufferProfile = bufferProfile || savedBufferProfile;
  // Remount engines when settings that only apply at construction change.
  const vlcEngineKey = `vlc:${uri}:${playerCompat.vlcAudioOutput}:${playerCompat.vlcHardwareDecode ? 1 : 0}:${effectiveBufferProfile}`;
  const media3EngineKey = `media3:${uri}:${playerCompat.media3AudioMode}:${playerCompat.media3Tunneling ? 1 : 0}:${effectiveBufferProfile}`;
  const forceVlc = playerEnginePreference === "vlc" && vlcAvailable && role !== "preview";
  const forceMedia3 = playerEnginePreference === "media3" && role !== "preview";
  const [session, setSession] = useState({ key: "", generation: 0 });

  const setStatus = useStatusTracker(onStatus, `${role}:${uri}`);
  const cleanUri = useMemo(() => parsePipeHeaders(uri).uri, [uri]);
  const engineMemoryKey = channelKey || cleanUri;
  const kind = useMemo(() => detectStreamKind(cleanUri), [cleanUri]);
  const initialEngine = useMemo(() => {
    if (forceVlc) return "vlc" as Engine;
    if (forceMedia3) return "media3" as Engine;
    const remembered = getRememberedStreamEngine(engineMemoryKey);
    if (remembered === "media3" || (remembered === "vlc" && vlcAvailable)) return remembered;
    const preferred = preferredEngine(kind);
    return preferred === "vlc" && !vlcAvailable ? "media3" : preferred;
  }, [engineMemoryKey, forceMedia3, forceVlc, kind]);
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const stableRef = useRef(false);
  const startTimeoutMs = role === "preview" ? PREVIEW_START_TIMEOUT_MS : FULLSCREEN_START_TIMEOUT_MS;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setAppActive(state !== "background" && state !== "inactive");
    });
    return () => sub.remove();
  }, []);

  // Fullscreen remounts immediately when Settings change. Guide preview stays
  // mounted under Tabs keep-alive — freeze the applied compat key while the
  // Guide route is unfocused so Settings toggles cannot remount a background decoder.
  const appliedCompatKeyRef = useRef(`${media3EngineKey}|${vlcEngineKey}`);
  if (role !== "preview" || isFocused) {
    appliedCompatKeyRef.current = `${media3EngineKey}|${vlcEngineKey}`;
  }
  // Include engine remount keys so mid-play Settings changes reset fallback /
  // stable gates. Otherwise a prior silent-audio swap blocks the next attempt.
  const sessionKey = `${role}:${uri}:${initialEngine}:${appliedCompatKeyRef.current}`;
  useEffect(() => {
    const generation = beginSession(role);
    setSession({ key: sessionKey, generation });
    setSessionPhase(role, generation, "preparing");
    stableRef.current = false;
    setFallbackUsed(false);
    setEngine(initialEngine);
    setStatus("loading");
  }, [initialEngine, role, sessionKey, setStatus, uri]);

  useEffect(() => {
    if (role !== "fullscreen") return;
    setNativePlaybackStarting(true);
    return () => setNativePlaybackStarting(false);
  }, [role, sessionKey]);

  // URI changes render no child until beginSession has invalidated/released the
  // previous decoder. This avoids mounting newUri:oldGeneration and immediately
  // remounting it again when the generation effect runs.
  const sessionGeneration = session.key === sessionKey ? session.generation : 0;

  useEffect(() => {
    if (stableRef.current || !playbackFocused || !sessionGeneration) return;
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
  }, [engine, fallbackUsed, playbackFocused, role, sessionGeneration, setStatus, startTimeoutMs, uri]);

  const handleStatus = useCallback(
    (status: StreamStatus, reason?: SessionFailReason | null) => {
      if (!isSessionCurrent(role, sessionGeneration)) return;

      if (status === "playing") {
        if (role === "fullscreen") setNativePlaybackStarting(false);
        stableRef.current = true;
        rememberSuccessfulStreamEngine(engineMemoryKey, engine);
        setSessionPhase(role, sessionGeneration, "playing");
        setStatus("playing");
        return;
      }
      // One alternate-engine attempt handles HLS/codec differences / silent audio
      // between Media3 and VLC for both preview and fullscreen.
      if (status === "error" && !forceVlc && !forceMedia3 && !fallbackUsed) {
        if (reason === "silent-audio" && !playerCompat.silentAudioFallback) {
          setSessionPhase(role, sessionGeneration, "failed", "silent-audio");
          setStatus("error", "silent-audio");
          return;
        }
        const alternate = alternateEngine(engine, vlcAvailable);
        if (alternate) {
          setFallbackUsed(true);
          setEngine(alternate);
          const swapReason: SessionFailReason =
            reason === "silent-audio" ? "silent-audio" : "engine-swap";
          setSessionPhase(role, sessionGeneration, "recovering", swapReason);
          setStatus("loading", swapReason);
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
    [
      engine,
      engineMemoryKey,
      fallbackUsed,
      forceMedia3,
      forceVlc,
      playerCompat.silentAudioFallback,
      role,
      sessionGeneration,
      setStatus,
    ],
  );

  if (!playbackFocused || !uri || !sessionGeneration) return null;

  if (engine === "vlc") {
    return (
      <VlcStream
        key={vlcEngineKey}
        uri={uri}
        onStatus={handleStatus}
        style={style}
        engine="vlc"
        mode={playbackMode}
        sessionRole={role}
        sessionGeneration={sessionGeneration}
        muted={muted}
        audioTrack={audioTrack}
        textTrack={textTrack}
        onTracksAvailable={onTracksAvailable}
        bufferProfile={effectiveBufferProfile}
        paused={paused}
        scaleMode={scaleMode}
      />
    );
  }
  return (
    <ExpoStream
      key={media3EngineKey}
      uri={uri}
      channelKey={channelKey}
      onStatus={handleStatus}
      style={style}
      engine="media3"
      mode={playbackMode}
      sessionRole={role}
      sessionGeneration={sessionGeneration}
      muted={muted}
      audioTrack={audioTrack}
      textTrack={textTrack}
      onTracksAvailable={onTracksAvailable}
      bufferProfile={effectiveBufferProfile}
      paused={paused}
      scaleMode={scaleMode}
    />
  );
}
