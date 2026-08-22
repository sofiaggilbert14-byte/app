import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, StyleProp, ViewStyle } from "react-native";
import { VideoView, type VideoSource } from "expo-video";
import { useIsFocused } from "@react-navigation/native";
import {
  detectStreamKind,
  media3ContentType,
  parsePipeHeaders,
} from "@/src/core/streamPolicy";
import {
  beginSession,
  getPlaybackOwnershipRevision,
  isPreviewPlaybackAllowed,
  isSessionCurrent,
  registerSessionStop,
  setSessionPhase,
  subscribePlaybackOwnership,
  type SessionFailReason,
  type SessionRole,
} from "@/src/core/playbackSession";
import {
  claimMedia3Playback,
  loadMedia3Source,
  releaseFullscreenMedia3,
  releasePreviewMedia3,
} from "@/src/core/media3PlaybackManager";
import { shouldUseLowRamTuning, useDeviceMemoryProfile } from "@/src/core/deviceMemoryProfile";
import {
  getPreferredAudioLanguage,
  getRememberedChannelAudioTrack,
  pickPreferredAudioTrack,
} from "@/src/core/audioTrackPreferences";
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

// Compatibility exports kept so PlayerScreen can be migrated incrementally.
// VLC/circuit breaking are intentionally gone from the new core.
export const vlcAvailable = false;
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
  bufferProfile?: "low_latency" | "balanced" | "stable";
  paused?: boolean;
  scaleMode?: PlayerScaleMode;
};

const START_TIMEOUT_MS = 10_000;
const REBUFFER_REPREPARE_MS = 5_000;
const REBUFFER_FAIL_MS = 12_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

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
  const firstFrameRef = useRef(false);
  const bufferingSinceRef = useRef<number | null>(null);
  const reprepareUsedRef = useRef(false);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const kind = useMemo(() => detectStreamKind(uri), [uri]);
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const player = useMemo(() => claimMedia3Playback(role), [role]);
  const deviceMemory = useDeviceMemoryProfile();
  const lowRam = shouldUseLowRamTuning(deviceMemory);
  const compat = usePlayerCompatibilityPreferences();

  const emit = useCallback((status: StreamStatus, reason?: SessionFailReason | null) => {
    if (generation && !isSessionCurrent(role, generation)) return;
    onStatusRef.current(status, reason);
  }, [generation, role]);

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    retryTimerRef.current = null;
    startTimerRef.current = null;
    watchdogRef.current = null;
  }, []);

  const applyBufferPolicy = useCallback(() => {
    try {
      // Live TV only: tight forward buffer, no VOD-sized allocator. Expo 3.0.16
      // exposes forward duration/byte caps; native LoadControl tuning can stay
      // below this JS ceiling.
      player.bufferOptions = mode === "preview"
        ? {
            preferredForwardBufferDuration: 1.5,
            maxBufferBytes: (lowRam ? 6 : 8) * 1024 * 1024,
            minBufferForPlayback: 0.35,
          }
        : {
            preferredForwardBufferDuration: lowRam ? 2.5 : 3,
            maxBufferBytes: (lowRam ? 12 : 18) * 1024 * 1024,
            minBufferForPlayback: 0.5,
          };
    } catch {}
    try {
      player.audioMixingMode = mode === "preview" ? "mixWithOthers" : "doNotMix";
    } catch {}
  }, [lowRam, mode, player]);

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
      onTracksAvailable?.({
        audio: mappedAudio,
        text: text.map((track: any) => ({ id: track.id, name: track.label || track.language || `CC ${track.id}` })),
      });

      const requestedAudio = audioTrack == null
        ? pickPreferredAudioTrack(mappedAudio as any, getRememberedChannelAudioTrack(channelKey), getPreferredAudioLanguage())
        : mappedAudio.find((track) => String(track.id) === String(audioTrack));
      if (requestedAudio) {
        const raw = audio.find((track: any) => String(track.id) === String(requestedAudio.id));
        if (raw && (compat.media3AudioMode === "ffmpeg" || raw.isSupported !== false)) player.audioTrack = raw;
      }

      if (textTrack == null) player.subtitleTrack = null;
      else {
        const rawText = text.find((track: any) => String(track.id) === String(textTrack));
        if (rawText) player.subtitleTrack = rawText;
      }
    } catch {}
  }, [audioTrack, channelKey, compat.media3AudioMode, onTracksAvailable, player, textTrack]);

  const load = useCallback(async (isRecovery = false) => {
    if (!uri || !playbackFocused || !generation || !isSessionCurrent(role, generation)) return;
    if (!isRecovery) {
      stableRef.current = false;
      firstFrameRef.current = false;
      reprepareUsedRef.current = false;
      retryRef.current = 0;
    }
    bufferingSinceRef.current = null;
    applyBufferPolicy();
    emit("loading");
    setSessionPhase(role, generation, isRecovery ? "recovering" : "preparing", isRecovery ? "stream-error" : null);
    const source: VideoSource = {
      uri,
      headers,
      contentType: contentType as any,
      useCaching: false,
    };
    try {
      await loadMedia3Source(role, `${uri}|${JSON.stringify(headers)}|${contentType}`, source);
      if (!isSessionCurrent(role, generation)) return;
      try {
        player.muted = muted;
        player.volume = muted ? 0 : 1;
      } catch {}
      publishTracks();
      if (paused) player.pause(); else player.play();
    } catch {
      if (!isSessionCurrent(role, generation)) return;
      emit("error", "stream-error");
      setSessionPhase(role, generation, "failed", "stream-error");
    }
  }, [
    applyBufferPolicy,
    contentType,
    emit,
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

  const failOrRetry = useCallback(() => {
    if (!generation || !isSessionCurrent(role, generation)) return;
    if (retryRef.current >= RETRY_DELAYS_MS.length) {
      setSessionPhase(role, generation, "failed", "stream-error");
      emit("error", "stream-error");
      return;
    }
    const delay = RETRY_DELAYS_MS[retryRef.current++];
    setSessionPhase(role, generation, "recovering", "stream-error");
    emit("loading", "stream-error");
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => void load(true), delay);
  }, [emit, generation, load, role]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setAppActive(state !== "background" && state !== "inactive");
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!playbackFocused || !uri) {
      setGeneration(0);
      if (role === "preview") void releasePreviewMedia3();
      else if (!appActive) void releaseFullscreenMedia3();
      return;
    }
    const next = beginSession(role);
    setGeneration(next);
    stableRef.current = false;
    firstFrameRef.current = false;
    bufferingSinceRef.current = null;
    reprepareUsedRef.current = false;
    retryRef.current = 0;
    if (role === "fullscreen") setNativePlaybackStarting(true);
  }, [appActive, playbackFocused, role, uri]);

  useEffect(() => {
    if (!generation || !playbackFocused) return;
    const stop = role === "preview" ? releasePreviewMedia3 : releaseFullscreenMedia3;
    const unregister = registerSessionStop(role, generation, stop);
    void load(false);
    return () => {
      unregister();
      clearTimers();
      // Preview surfaces are ephemeral and must never survive Guide focus loss.
      // Fullscreen Media3 intentionally survives temporary React unmounts during
      // channel surfing; stopFullscreenSession owns the real release.
      if (role === "preview") void releasePreviewMedia3();
    };
  }, [clearTimers, generation, load, playbackFocused, role]);

  useEffect(() => {
    if (!generation || !playbackFocused) return;
    startTimerRef.current = setTimeout(() => {
      if (stableRef.current || !isSessionCurrent(role, generation)) return;
      failOrRetry();
    }, START_TIMEOUT_MS);
    return () => {
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    };
  }, [failOrRetry, generation, playbackFocused, role]);

  useEffect(() => {
    const statusSub = player.addListener("statusChange", ({ status, error }) => {
      if (!generation || !isSessionCurrent(role, generation)) return;
      if (status === "loading") {
        if (stableRef.current && bufferingSinceRef.current == null) bufferingSinceRef.current = Date.now();
        emit("loading");
      } else if (status === "readyToPlay") {
        publishTracks();
      } else if (error || status === "error") {
        failOrRetry();
      }
    });
    const audioSub = player.addListener("availableAudioTracksChange", publishTracks);
    const textSub = player.addListener("availableSubtitleTracksChange", publishTracks);
    return () => {
      statusSub.remove();
      audioSub.remove();
      textSub.remove();
    };
  }, [emit, failOrRetry, generation, player, publishTracks, role]);

  useEffect(() => {
    if (!generation || !playbackFocused || paused) return;
    watchdogRef.current = setInterval(() => {
      const since = bufferingSinceRef.current;
      if (since == null || !stableRef.current || !isSessionCurrent(role, generation)) return;
      const elapsed = Date.now() - since;
      if (elapsed >= REBUFFER_REPREPARE_MS && !reprepareUsedRef.current) {
        reprepareUsedRef.current = true;
        bufferingSinceRef.current = Date.now();
        void load(true);
        return;
      }
      if (elapsed >= REBUFFER_FAIL_MS) {
        bufferingSinceRef.current = null;
        failOrRetry();
      }
    }, 1000);
    return () => {
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    };
  }, [failOrRetry, generation, load, paused, playbackFocused, role]);

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
        firstFrameRef.current = true;
        stableRef.current = true;
        bufferingSinceRef.current = null;
        reprepareUsedRef.current = false;
        retryRef.current = 0;
        setSessionPhase(role, generation, "playing");
        if (role === "fullscreen") setNativePlaybackStarting(false);
        emit("playing");
      }}
    />
  );
}
