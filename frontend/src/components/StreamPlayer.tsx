import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, StyleProp, ViewStyle } from "react-native";
import { VideoView, type VideoSource } from "expo-video";
import { useIsFocused } from "@react-navigation/native";
import { detectStreamKind, media3ContentType, parsePipeHeaders } from "@/src/core/streamPolicy";
import {
  beginSession,
  getPlaybackOwnershipRevision,
  isPreviewPlaybackAllowed,
  isSessionCurrent,
  setNativePlaybackPauseHandler,
  setNativePlaybackReleaseHandler,
  setSessionPhase,
  subscribePlaybackOwnership,
  type SessionFailReason,
  type SessionRole,
} from "@/src/core/playbackSession";
import {
  getMedia3Player,
  loadMedia3Source,
  pauseFullscreenMedia3,
  releaseFullscreenMedia3,
  releasePreviewMedia3,
  suspendFullscreenMedia3,
} from "@/src/core/media3PlaybackManager";
import { shouldUseLowRamTuning, useDeviceMemoryProfile } from "@/src/core/deviceMemoryProfile";
import {
  getPreferredAudioLanguage,
  getRememberedChannelAudioTrack,
  pickPreferredAudioTrack,
} from "@/src/core/audioTrackPreferences";
import { fingerprintStreamUri, recordAudioDiagnostics } from "@/src/core/audioDiagnostics";
import {
  usePlaybackBufferProfile,
  type PlaybackBufferProfile,
} from "@/src/core/playbackBufferProfile";
import { usePlayerCompatibilityPreferences } from "@/src/core/playerCompatibilityPreferences";
import { setNativePlaybackStarting } from "@/src/utils/tvRemote";

export type StreamStatus = "loading" | "playing" | "error";
export type PlayerScaleMode = "fit" | "zoom" | "stretch";
export type StreamTrack = {
  id: string | number;
  name: string;
  mimeType?: string | null;
  isSupported?: boolean;
};

setNativePlaybackReleaseHandler((role) =>
  role === "preview" ? releasePreviewMedia3() : releaseFullscreenMedia3(),
);
setNativePlaybackPauseHandler((role) => {
  if (role === "fullscreen") pauseFullscreenMedia3();
});

// Compatibility exports retained while PlayerScreen terminology is migrated.
// The rebuilt live-TV playback core itself is Media3-only.
export const vlcAvailable = Platform.OS !== "web";
export function clearFullscreenCircuit(_uri?: string): void {}
export function isFullscreenCircuitOpen(_uri?: string): boolean { return false; }

type Props = {
  uri: string;
  channelKey?: string;
  onStatus: (s: StreamStatus, reason?: SessionFailReason | null) => void;
  style?: StyleProp<ViewStyle>;
  mode?: "preview" | "full";
  sessionRole?: SessionRole;
  muted?: boolean;
  audioTrack?: string | number;
  textTrack?: string | number | null;
  onTracksAvailable?: (tracks: { audio: StreamTrack[]; text: StreamTrack[] }) => void;
  bufferProfile?: PlaybackBufferProfile;
  paused?: boolean;
  scaleMode?: PlayerScaleMode;
};

const FULLSCREEN_START_TIMEOUT_MS = 12_000;
const PREVIEW_START_TIMEOUT_MS = 8_000;
const REBUFFER_REPREPARE_MS = 5_000;
const REBUFFER_FAIL_MS = 12_000;
const MAX_SILENT_BUFFERING_RESYNCS = 1;
const RESYNC_REARM_STABLE_MS = 30_000;

export function StreamPlayer({
  uri: rawUri,
  channelKey,
  onStatus,
  style,
  mode = "full",
  sessionRole,
  muted = false,
  audioTrack,
  textTrack,
  onTracksAvailable,
  bufferProfile,
  paused = false,
  scaleMode = "fit",
}: Props) {
  const role: SessionRole = sessionRole ?? (mode === "preview" ? "preview" : "fullscreen");
  const isFocused = useIsFocused();
  useSyncExternalStore(subscribePlaybackOwnership, getPlaybackOwnershipRevision, getPlaybackOwnershipRevision);
  const previewAllowed = role !== "preview" || isPreviewPlaybackAllowed();
  const [appActive, setAppActive] = useState(
    () => AppState.currentState !== "background" && AppState.currentState !== "inactive",
  );
  const playbackFocused = isFocused && appActive && previewAllowed;
  const [generation, setGeneration] = useState(0);
  const stableRef = useRef(false);
  const stableSinceRef = useRef<number | null>(null);
  const bufferingSinceRef = useRef<number | null>(null);
  const silentResyncCountRef = useRef(0);
  const loadRequestRef = useRef(0);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStatusRef = useRef(onStatus);
  const tracksCallbackRef = useRef(onTracksAvailable);
  onStatusRef.current = onStatus;
  tracksCallbackRef.current = onTracksAvailable;

  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const kind = useMemo(() => detectStreamKind(uri), [uri]);
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const player = useMemo(() => getMedia3Player(), []);
  const deviceMemory = useDeviceMemoryProfile();
  const lowRam = shouldUseLowRamTuning(deviceMemory);
  const compat = usePlayerCompatibilityPreferences();
  const [savedBufferProfile] = usePlaybackBufferProfile();
  const effectiveBufferProfile = bufferProfile ?? savedBufferProfile;

  const emit = useCallback((status: StreamStatus, reason?: SessionFailReason | null) => {
    if (generation && !isSessionCurrent(role, generation)) return;
    try { onStatusRef.current(status, reason); } catch {}
  }, [generation, role]);

  const fail = useCallback((reason: SessionFailReason = "stream-error") => {
    if (!generation || !isSessionCurrent(role, generation)) return;
    bufferingSinceRef.current = null;
    stableSinceRef.current = null;
    setSessionPhase(role, generation, "failed", reason);
    if (role === "fullscreen") setNativePlaybackStarting(false);
    emit("error", reason);
  }, [emit, generation, role]);

  const clearTimers = useCallback(() => {
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    startTimerRef.current = null;
    watchdogRef.current = null;
  }, []);

  const applyBufferPolicy = useCallback(() => {
    const coordinatedCacheBudget = Math.max(
      8 * 1024 * 1024,
      Math.min(
        deviceMemory?.playerCacheBytes || Number.MAX_SAFE_INTEGER,
        deviceMemory?.vodCacheBytes || Number.MAX_SAFE_INTEGER,
      ),
    );
    const profile = compat.media3Tunneling && effectiveBufferProfile !== "stable"
      ? "low_latency"
      : effectiveBufferProfile;
    const full = profile === "low_latency"
      ? {
          preferredForwardBufferDuration: lowRam ? 1.6 : 2.2,
          maxBufferBytes: (lowRam ? 10 : 16) * 1024 * 1024,
          minBufferForPlayback: 0.4,
        }
      : profile === "stable"
        ? {
            preferredForwardBufferDuration: lowRam ? 4 : 5,
            maxBufferBytes: (lowRam ? 20 : 32) * 1024 * 1024,
            minBufferForPlayback: 0.8,
          }
        : {
            preferredForwardBufferDuration: lowRam ? 2.5 : 3,
            maxBufferBytes: (lowRam ? 14 : 24) * 1024 * 1024,
            minBufferForPlayback: 0.5,
          };
    try {
      player.bufferOptions = mode === "preview"
        ? {
            preferredForwardBufferDuration: 1.2,
            maxBufferBytes: Math.min((lowRam ? 6 : 10) * 1024 * 1024, coordinatedCacheBudget),
            minBufferForPlayback: 0.3,
          }
        : {
            ...full,
            maxBufferBytes: Math.min(full.maxBufferBytes, coordinatedCacheBudget),
          };
    } catch {}
    try {
      player.audioMixingMode = mode === "preview" ? "mixWithOthers" : "doNotMix";
    } catch {}
  }, [
    compat.media3Tunneling,
    deviceMemory?.playerCacheBytes,
    deviceMemory?.vodCacheBytes,
    effectiveBufferProfile,
    lowRam,
    mode,
    player,
  ]);

  const publishTracks = useCallback(() => {
    try {
      const audio = Array.isArray(player.availableAudioTracks) ? player.availableAudioTracks : [];
      const text = Array.isArray(player.availableSubtitleTracks) ? player.availableSubtitleTracks : [];
      const mappedAudio = audio.map((track: any) => ({
        id: track.id,
        name: [track.label || track.language || `Audio ${track.id}`, track.mimeType].filter(Boolean).join(" · "),
        mimeType: track.mimeType ?? null,
        isSupported: track.isSupported !== false,
        language: track.language,
      }));
      const supportedAudio = audio.filter((track: any) => track.isSupported !== false);
      const mappedText = text.map((track: any) => ({
        id: track.id,
        name: String(track.label || track.language || `CC ${track.id}`),
      }));
      tracksCallbackRef.current?.({ audio: mappedAudio, text: mappedText });

      const preferred = audioTrack == null
        ? pickPreferredAudioTrack(
            mappedAudio as any,
            getRememberedChannelAudioTrack(channelKey),
            getPreferredAudioLanguage(),
          )
        : mappedAudio.find((track) => String(track.id) === String(audioTrack));
      const preferredRaw = preferred
        ? audio.find((track: any) => String(track.id) === String(preferred.id)) ?? null
        : null;
      const currentAudio = player.audioTrack as any;
      const ffmpegMode = compat.media3AudioMode === "ffmpeg";
      let selectedAudio: any = null;
      let selectedBy: "user" | "current" | "auto-supported" | "auto-first" | "none" = "none";

      if (preferredRaw && (ffmpegMode || preferredRaw.isSupported !== false)) {
        selectedAudio = preferredRaw;
        selectedBy = audioTrack == null ? "auto-supported" : "user";
      } else if (currentAudio && (ffmpegMode || currentAudio.isSupported !== false)) {
        selectedAudio = currentAudio;
        selectedBy = "current";
      } else if (supportedAudio[0]) {
        selectedAudio = supportedAudio[0];
        selectedBy = "auto-supported";
      } else if (ffmpegMode && (preferredRaw || audio[0])) {
        selectedAudio = preferredRaw || audio[0];
        selectedBy = preferredRaw ? (audioTrack == null ? "auto-first" : "user") : "auto-first";
      }

      if (selectedAudio && player.audioTrack?.id !== selectedAudio.id) player.audioTrack = selectedAudio;

      if (textTrack == null) {
        if (player.subtitleTrack != null) player.subtitleTrack = null;
      } else {
        const selectedText = text.find((track: any) => String(track.id) === String(textTrack));
        if (selectedText && player.subtitleTrack?.id !== selectedText.id) player.subtitleTrack = selectedText;
      }

      recordAudioDiagnostics({
        engine: "media3",
        role,
        streamKey: fingerprintStreamUri(uri, kind),
        trackId: selectedAudio?.id ?? null,
        mimeType: selectedAudio?.mimeType ?? null,
        language: selectedAudio?.language ?? null,
        label: selectedAudio?.label ?? null,
        isSupported: selectedAudio ? selectedAudio.isSupported !== false : null,
        trackCount: audio.length,
        supportedCount: supportedAudio.length,
        selectedBy,
        silentAudio: false,
        reason: `mode=${compat.media3AudioMode};tunnel=${compat.media3Tunneling ? 1 : 0}`,
      });
    } catch {}
  }, [audioTrack, channelKey, compat.media3AudioMode, compat.media3Tunneling, kind, player, role, textTrack, uri]);

  const load = useCallback(async (isRecovery = false) => {
    if (!uri || !playbackFocused || !generation || !isSessionCurrent(role, generation)) return;
    const requestId = ++loadRequestRef.current;
    if (!isRecovery) {
      stableRef.current = false;
      stableSinceRef.current = null;
      silentResyncCountRef.current = 0;
    }
    bufferingSinceRef.current = null;
    applyBufferPolicy();
    emit("loading", isRecovery ? "stream-error" : undefined);
    setSessionPhase(role, generation, isRecovery ? "recovering" : "preparing", isRecovery ? "stream-error" : null);
    const source: VideoSource = {
      uri,
      headers,
      contentType: contentType as any,
      useCaching: false,
    };
    try {
      await loadMedia3Source(role, `${uri}|${JSON.stringify(headers)}|${contentType}`, source);
      if (requestId !== loadRequestRef.current) return;
      if (!isSessionCurrent(role, generation)) return;
      try {
        player.muted = muted;
        player.volume = muted ? 0 : 1;
      } catch {}
      publishTracks();
      if (paused) player.pause(); else player.play();
    } catch {
      if (requestId !== loadRequestRef.current) return;
      fail("stream-error");
    }
  }, [
    applyBufferPolicy,
    contentType,
    emit,
    fail,
    generation,
    headers,
    muted,
    paused,
    playbackFocused,
    player,
    publishTracks,
    role,
    uri,
  ]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setAppActive(state !== "background" && state !== "inactive");
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!playbackFocused || !uri) {
      loadRequestRef.current += 1;
      setGeneration(0);
      stableSinceRef.current = null;
      if (role === "preview") void releasePreviewMedia3();
      else if (!appActive) void suspendFullscreenMedia3();
      return;
    }
    const next = beginSession(role);
    setGeneration(next);
    stableRef.current = false;
    stableSinceRef.current = null;
    bufferingSinceRef.current = null;
    silentResyncCountRef.current = 0;
    if (role === "fullscreen") setNativePlaybackStarting(true);
  }, [appActive, playbackFocused, role, uri]);

  useEffect(() => {
    if (!generation || !playbackFocused) return;
    void load(false);
    return () => {
      loadRequestRef.current += 1;
      clearTimers();
      if (role === "preview") void releasePreviewMedia3();
    };
  }, [clearTimers, generation, load, playbackFocused, role]);

  useEffect(() => {
    if (!generation || !playbackFocused) return;
    const timeoutMs = role === "preview" ? PREVIEW_START_TIMEOUT_MS : FULLSCREEN_START_TIMEOUT_MS;
    startTimerRef.current = setTimeout(() => {
      if (!stableRef.current && isSessionCurrent(role, generation)) fail("start-timeout");
    }, timeoutMs);
    return () => {
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    };
  }, [fail, generation, playbackFocused, role]);

  useEffect(() => {
    const statusSub = player.addListener("statusChange", ({ status, error }) => {
      if (!generation || !isSessionCurrent(role, generation)) return;
      if (status === "loading") {
        if (stableRef.current && bufferingSinceRef.current == null) {
          const now = Date.now();
          if (
            silentResyncCountRef.current >= MAX_SILENT_BUFFERING_RESYNCS &&
            stableSinceRef.current != null &&
            now - stableSinceRef.current >= RESYNC_REARM_STABLE_MS
          ) {
            silentResyncCountRef.current = 0;
          }
          stableSinceRef.current = null;
          bufferingSinceRef.current = now;
        }
        emit("loading");
      } else if (status === "readyToPlay") {
        publishTracks();
      } else if (error || status === "error") {
        fail("stream-error");
      }
    });
    const audioSub = player.addListener("availableAudioTracksChange", publishTracks);
    const textSub = player.addListener("availableSubtitleTracksChange", publishTracks);
    return () => {
      statusSub.remove();
      audioSub.remove();
      textSub.remove();
    };
  }, [emit, fail, generation, player, publishTracks, role]);

  useEffect(() => {
    if (!generation || !playbackFocused || paused) return;
    watchdogRef.current = setInterval(() => {
      const since = bufferingSinceRef.current;
      if (since == null || !stableRef.current || !isSessionCurrent(role, generation)) return;
      const elapsed = Date.now() - since;
      if (
        elapsed >= REBUFFER_REPREPARE_MS &&
        silentResyncCountRef.current < MAX_SILENT_BUFFERING_RESYNCS
      ) {
        silentResyncCountRef.current += 1;
        stableSinceRef.current = null;
        bufferingSinceRef.current = Date.now();
        void load(true);
        return;
      }
      if (elapsed >= REBUFFER_FAIL_MS) {
        bufferingSinceRef.current = null;
        stableSinceRef.current = null;
        fail("stream-error");
      }
    }, 1000);
    return () => {
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    };
  }, [fail, generation, load, paused, playbackFocused, role]);

  useEffect(() => {
    try {
      player.muted = muted;
      player.volume = muted ? 0 : 1;
      if (paused) player.pause(); else if (playbackFocused) player.play();
    } catch {}
  }, [muted, paused, playbackFocused, player]);

  useEffect(() => {
    publishTracks();
  }, [audioTrack, textTrack, publishTracks]);

  if (!playbackFocused || !uri || !generation) return null;

  return (
    <VideoView
      style={style}
      player={player}
      contentFit={scaleMode === "zoom" ? "cover" : scaleMode === "stretch" ? "fill" : "contain"}
      surfaceType={Platform.OS === "android" ? (mode === "preview" ? "textureView" : "surfaceView") : undefined}
      nativeControls={false}
      useExoShutter
      onFirstFrameRender={() => {
        if (!isSessionCurrent(role, generation)) return;
        stableRef.current = true;
        stableSinceRef.current = Date.now();
        bufferingSinceRef.current = null;
        setSessionPhase(role, generation, "playing");
        if (role === "fullscreen") setNativePlaybackStarting(false);
        emit("playing");
      }}
    />
  );
}
