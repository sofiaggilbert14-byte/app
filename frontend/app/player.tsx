import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import {
  StreamPlayer,
  StreamStatus,
  type StreamTrack,
  type PlayerScaleMode,
} from "@/src/components/StreamPlayer";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { addPlayerQuickCommandListener, addTvKeyListener, addTvLongPressListener, addTvShortcutListener, emitTvQuickActions, resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";
import { useRemoteShortcutPreferences, type PlayerRemoteAction } from "@/src/core/remoteShortcutPreferences";
import { getTvSafeInsets } from "@/src/utils/tvLayout";
import { requestNativeFocus } from "@/src/utils/tvFocus";
import { stopFullscreenSession, stopAllPlaybackSessions, type SessionFailReason } from "@/src/core/playbackSession";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { requestGuideJump } from "@/src/core/guideSearchJump";
import {
  audioDiagnosticsExtras,
  getLastAudioDiagnostics,
} from "@/src/core/audioDiagnostics";
import { pickDefaultSubtitleTrack, useSubtitlePreferences } from "@/src/core/subtitlePreferences";
import { pickPreferredAudioTrack, useAudioTrackPreferences } from "@/src/core/audioTrackPreferences";
import * as FileSystem from "expo-file-system/legacy";
import type { Channel } from "@/src/api";

const SWITCH_NOTICE_MS = 1800;
const STABLE_HISTORY_DELAY_MS = 5000;
type PlayerViewMode = "fit" | "fill" | "zoom" | "stretch";

const FAIL_REASON_LABEL: Record<SessionFailReason, string> = {
  "start-timeout": "start timeout",
  "engine-swap": "playback reset",
  "circuit-open": "temporarily paused",
  "stream-error": "stream error",
  "silent-audio": "no supported audio track",
  "user-stop": "stopped",
  superseded: "replaced",
  crashed: "player crash",
};

function AutoScrollProgramDescription({ text }: { text: string; activeKey: string }) {
  // Static copy — animated marquees hitch the JS thread during channel surfing.
  if (!text) return null;
  return (
    <View style={styles.descriptionViewport}>
      <Text numberOfLines={2} style={styles.description}>
        {text}
      </Text>
    </View>
  );
}

export default function PlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId: string; returnToGuide?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const {
    channels,
    recent,
    channelById,
    addRecent,
    toggleFavorite,
    playerControlsTimeoutMs,
    channelLogos,
    channelNumbers,
    deviceLayoutMode,
    sleepTimerMinutes,
    setSleepTimerMinutes,
  } = useStore();

  const [channelId, setChannelId] = useState(params.channelId);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [failReason, setFailReason] = useState<SessionFailReason | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [controls, setControls] = useState(true);
  const [playerOverlay, setPlayerOverlay] = useState<"channels" | "tracks" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playerNow, setPlayerNow] = useState(() => new Date());
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const [scaleMode, setScaleMode] = useState<PlayerViewMode>("fit");
  const [audioTracks, setAudioTracks] = useState<StreamTrack[]>([]);
  const [textTracks, setTextTracks] = useState<StreamTrack[]>([]);
  const [audioTrackId, setAudioTrackId] = useState<string | number | undefined>(undefined);
  const [textTrackId, setTextTrackId] = useState<string | number | undefined>(undefined);
  const channelsOpen = playerOverlay === "channels";
  const tracksOpen = playerOverlay === "tracks";
  const setOverlayOpen = useCallback((name: "channels" | "tracks", next: React.SetStateAction<boolean>) => {
    setPlayerOverlay((current) => {
      const open = current === name;
      const resolved = typeof next === "function" ? next(open) : next;
      return resolved ? name : current === name ? null : current;
    });
  }, []);
  const setChannelsOpen = useCallback((next: React.SetStateAction<boolean>) => setOverlayOpen("channels", next), [setOverlayOpen]);
  const setTracksOpen = useCallback((next: React.SetStateAction<boolean>) => setOverlayOpen("tracks", next), [setOverlayOpen]);
  const { defaultLanguage: subtitleDefaultLanguage } = useSubtitlePreferences();
  const audioPreferences = useAudioTrackPreferences();
  const remoteShortcuts = useRemoteShortcutPreferences();

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef(true);
  const channelsOpenRef = useRef(false);
  const generationRef = useRef(0);
  const channelsButtonRef = useRef<any>(null);
  const overlayOpenerRef = useRef<any>(null);
  const saveAudioReportRef = useRef<() => void>(() => undefined);
  const nextButtonRef = useRef<any>(null);
  const prevButtonRef = useRef<any>(null);
  const preferControlRef = useRef<"next" | "prev" | null>(null);
  const pendingChannelIdRef = useRef(params.channelId);
  const channelIdRef = useRef(params.channelId);
  // Route ownership is edge-triggered: in-player zaps own playback until the router actually changes.
  const lastRouteChannelIdRef = useRef(params.channelId);
  const previousChannelIdRef = useRef<string | null>(null);
  const textTrackIdRef = useRef<string | number | undefined>(undefined);
  const subtitleDefaultLanguageRef = useRef(subtitleDefaultLanguage);
  const subtitleAutoAppliedRef = useRef<string | null>(null);
  const audioAutoAppliedRef = useRef<string | null>(null);

  const isTV = Platform.OS !== "web" && Platform.isTV;
  useEffect(() => {
    if (!isTV) return;
    setRemoteContext("player");
    // Route transitions can install the next owner before this screen's cleanup
    // runs. Never let stale player cleanup clobber that newer focus context.
    return () => {
      resetRemoteContextIfOwned("player", "default");
    };
  }, [isTV]);
  const overlayHideMs = playerControlsTimeoutMs;
  const safe = useMemo(
    () => getTvSafeInsets(width, height, deviceLayoutMode),
    [deviceLayoutMode, height, width],
  );
  const channelMeta = useMemo(() => channelById(channelId), [channelById, channelId]);
  const channelPrograms = useGuidePrograms(channelId);
  const channel = useMemo(
    () => (channelMeta ? { ...channelMeta, programs: channelPrograms } : undefined),
    [channelMeta, channelPrograms],
  );
  const streamUri = channel?.url || "";
  // Native source/cache channels are already name-sorted and playable. Avoid
  // cloning/sorting several 6k+ arrays while the fullscreen decoder is starting.
  const streamChannels = channels;
  const historyChannels = useMemo(() => {
    const seen = new Set<string>();
    const out: Channel[] = [];
    for (const item of recent) {
      if (!item.url || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    for (const item of streamChannels) {
      if (!item.url || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }, [recent, streamChannels]);
  const numberById = useMemo(() => {
    const result: Record<string, number> = {};
    if (!channelNumbers) return result;
    for (let index = 0; index < channels.length; index += 1) result[channels[index].id] = index + 1;
    return result;
  }, [channelNumbers, channels]);

  useEffect(() => {
    const timer = setInterval(() => setPlayerNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sleepTimerMinutes) return;
    const endsAt = Date.now() + sleepTimerMinutes * 60_000;
    const timer = setInterval(() => {
      if (Date.now() < endsAt) return;
      setSleepTimerMinutes(0);
      void stopFullscreenSession();
      router.replace("/" as any);
    }, 15_000);
    return () => clearInterval(timer);
  }, [router, setSleepTimerMinutes, sleepTimerMinutes]);

  useEffect(() => {
    textTrackIdRef.current = textTrackId;
  }, [textTrackId]);

  useEffect(() => {
    subtitleDefaultLanguageRef.current = subtitleDefaultLanguage;
  }, [subtitleDefaultLanguage]);

  useEffect(() => {
    setAudioTracks([]);
    setTextTracks([]);
    setAudioTrackId(undefined);
    setTextTrackId(undefined);
    textTrackIdRef.current = undefined;
    subtitleAutoAppliedRef.current = null;
    audioAutoAppliedRef.current = null;
    setTracksOpen(false);
  }, [channelId, retryToken, setTracksOpen]);

  const { current, next } = nowNext(channel?.programs, playerNow);
  const progress = current ? progressPct(current, playerNow) : 0;
  const hasStream = !!streamUri;
  const programDescription = current?.desc || (next ? `Next: ${next.title}` : "Live television");
  const programDescriptionKey = `${channelId}:${current?.start || ""}:${current?.title || ""}`;

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), SWITCH_NOTICE_MS);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      controlsRef.current = false;
      setControls(false);
      setChannelsOpen(false);
      setTracksOpen(false);
    }, overlayHideMs);
  }, [overlayHideMs, setChannelsOpen, setTracksOpen]);

  const revealControls = useCallback((opts?: { claimChannelsFocus?: boolean }) => {
    const wasHidden = !controlsRef.current;
    controlsRef.current = true;
    setControls(true);
    // Keep Retry focused during stream errors — don't steal focus to Channels.
    if (status === "error" || !hasStream) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return;
    }
    scheduleHide();
    // Only claim Channels focus when waking from hidden controls — never while the
    // strip is open or on every D-pad tick (that yanks focus off the active card).
    const shouldClaim =
      opts?.claimChannelsFocus !== false &&
      wasHidden &&
      isTV &&
      !channelsOpenRef.current;
    if (shouldClaim) {
      requestAnimationFrame(() => requestNativeFocus(channelsButtonRef.current));
    }
  }, [hasStream, isTV, scheduleHide, status]);

  const changeChannel = useCallback((id: string, haptic = false) => {
    if (!id) return;
    const target = channelById(id);
    if (!target) return;
    if (haptic) void Haptics.selectionAsync().catch(() => undefined);

    pendingChannelIdRef.current = id;
    if (channelIdRef.current && channelIdRef.current !== id) previousChannelIdRef.current = channelIdRef.current;
    channelIdRef.current = id;
    generationRef.current += 1;
    setStatus("loading");
    setFailReason(null);
    setChannelId(id);
    setPlaybackPaused(false);
    if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
    showNotice(`Switching to ${target.name}`);
    // Keep strip/card focus — do not reclaim Channels button.
    revealControls({ claimChannelsFocus: false });
  }, [channelById, revealControls, showNotice]);

  const previewChannel = useCallback((id: string) => {
    if (id !== pendingChannelIdRef.current) changeChannel(id);
  }, [changeChannel]);

  const stepChannel = useCallback((direction: -1 | 1) => {
    if (streamChannels.length < 2) return;
    const currentId = pendingChannelIdRef.current || channelIdRef.current;
    const base = Math.max(0, streamChannels.findIndex((item) => item.id === currentId));
    const nextIndex = (base + direction + streamChannels.length) % streamChannels.length;
    const target = streamChannels[nextIndex];
    if (!target) return;
    preferControlRef.current = direction > 0 ? "next" : "prev";
    // A zap replaces the MediaItem on the existing native ExoPlayer.
    changeChannel(target.id, true);
  }, [changeChannel, streamChannels]);

  const returnToPreviousChannel = useCallback(() => {
    const previous = previousChannelIdRef.current;
    if (!previous || previous === channelIdRef.current) return;
    changeChannel(previous, true);
    setPlayerOverlay(null);
  }, [changeChannel]);

  const cycleScaleMode = useCallback(() => {
    setScaleMode((current) => {
      const next: PlayerViewMode = current === "fit" ? "fill" : current === "fill" ? "zoom" : current === "zoom" ? "stretch" : "fit";
      showNotice(next === "fit" ? "Aspect: Fit" : next === "fill" ? "Aspect: Fill" : next === "zoom" ? "Aspect: Zoom" : "Aspect: Stretch");
      return next;
    });
    revealControls({ claimChannelsFocus: false });
  }, [revealControls, showNotice]);

  useEffect(() => {
    if (!isTV) return;
    return addPlayerQuickCommandListener((command) => {
      if (command === "CYCLE_ASPECT") {
        cycleScaleMode();
        return;
      }
      if (command === "OPEN_TRACKS") {
        controlsRef.current = true;
        setControls(true);
        setChannelsOpen(false);
        setTracksOpen(true);
        overlayOpenerRef.current = null;
        scheduleHide();
        return;
      }
      if (command === "PREVIOUS_CHANNEL") {
        returnToPreviousChannel();
        return;
      }
      if (command === "SAVE_DIAGNOSTICS") {
        saveAudioReportRef.current();
      }
    });
  }, [cycleScaleMode, isTV, returnToPreviousChannel, scheduleHide, setChannelsOpen, setTracksOpen]);

  const restartStream = useCallback(() => {
    if (!hasStream) return;
    generationRef.current += 1;
    setStatus("loading");
    setFailReason(null);
    showNotice(`Reconnecting ${channel?.name || "stream"}`);
    // This only remounts the command adapter. NativePlaybackManager retains its
    // single ExoPlayer and re-prepares the current MediaItem.
    setRetryToken((value) => value + 1);
  }, [channel?.name, hasStream, showNotice]);

  const retryNow = useCallback(() => restartStream(), [restartStream]);

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  useEffect(() => {
    channelsOpenRef.current = channelsOpen;
  }, [channelsOpen]);

  const closeOverlayAndRestoreFocus = useCallback(() => {
    setPlayerOverlay(null);
    const opener = overlayOpenerRef.current;
    overlayOpenerRef.current = null;
    if (opener) requestAnimationFrame(() => requestNativeFocus(opener));
  }, []);


  // Cold mount / explicit retry only — channel zaps must not reclaim Channels focus.
  useEffect(() => {
    revealControls({ claimChannelsFocus: true });
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional cold-mount/retry only
  }, [retryToken]);

  useEffect(
    () => () => {
      stopFullscreenSession();
    },
    [setTracksOpen],
  );

  useEffect(() => {
    // Keep focus on Next/Prev while zapping even if the stream errors and Retry appears.
    if (!controls) return;
    const which = preferControlRef.current;
    if (!which) return;
    const node = which === "next" ? nextButtonRef.current : prevButtonRef.current;
    requestAnimationFrame(() => requestNativeFocus(node));
  }, [channelId, controls, status, retryToken]);

  useEffect(() => {
    if (status === "playing") {
      if (controlsRef.current) scheduleHide();
      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
      const stableChannelId = channelIdRef.current;
      stableHistoryTimer.current = setTimeout(() => {
        if (channelIdRef.current !== stableChannelId) return;
        const stableChannel = channelById(stableChannelId);
        if (stableChannel) addRecent(stableChannel);
      }, STABLE_HISTORY_DELAY_MS);
      return () => {
        if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
      };
    }
  }, [addRecent, channelById, scheduleHide, status]);

  useEffect(() => {
    if (status !== "error" && hasStream) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    controlsRef.current = true;
    setControls(true);
  }, [hasStream, status]);

  useEffect(() => {
    if (!isTV) return;
    // Wake controls from hidden state only — never steal strip focus on every key.
    return addTvKeyListener(() => {
      if (!controlsRef.current) revealControls({ claimChannelsFocus: true });
      else scheduleHide();
    });
  }, [isTV, revealControls, scheduleHide]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const stopAndExit = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    const currentChannelId = pendingChannelIdRef.current || channelIdRef.current;
    generationRef.current += 1;
    stopFullscreenSession();

    // A fullscreen session launched from Guide owns a Guide return anchor.
    // Use the currently tuned channel (including rapid zaps), not the channel
    // that originally opened the player. Other entry points keep normal Back.
    if (params.returnToGuide === "1" && currentChannelId) {
      requestGuideJump({ channelId: currentChannelId, group: "All" });
      router.replace("/guide" as any);
      return;
    }
    router.back();
  }, [params.returnToGuide, router]);

  const handleStreamStatus = useCallback(
    (next: StreamStatus, reason?: SessionFailReason | null) => {
      setStatus(next);
      if (reason !== undefined) setFailReason(reason);
      if (next === "playing") setFailReason(null);
    },
    [],
  );

  const saveAudioReport = useCallback(async () => {
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      const snap = getLastAudioDiagnostics();
      const extras = audioDiagnosticsExtras(snap);
      const lines = [
        `channelId=${channelIdRef.current}`,
        `channelName=${channelMeta?.name || ""}`,
        failReason ? `failReason=${failReason}` : null,
        ...Object.entries(extras).map(([key, value]) => `${key}=${value == null ? "" : String(value)}`),
      ].filter((line): line is string => !!line);
      const root = FileSystem.documentDirectory || "";
      if (!root || Platform.OS === "web") {
        showNotice("Diagnostics unavailable");
        return;
      }
      const path = `${root}charmiptv-audio-${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(path, lines.join("\n"));
      showNotice("Diagnostics saved");
    } catch {
      showNotice("Diagnostics failed");
    }
  }, [channelMeta?.name, failReason, showNotice]);
  saveAudioReportRef.current = () => { void saveAudioReport(); };

  const goGuide = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    const currentChannelId = pendingChannelIdRef.current || channelIdRef.current;
    if (currentChannelId) {
      requestGuideJump({
        channelId: currentChannelId,
        // Raw provider groups can be hidden in Phase 9. Restore the exact
        // channel through All so fullscreen -> Guide never depends on an
        // invisible M3U category.
        group: "All",
      });
    }
    generationRef.current += 1;
    stopFullscreenSession();
    router.replace("/guide" as any);
  }, [router]);

  const runRemoteAction = useCallback((action: PlayerRemoteAction) => {
    if (action === "channel_up") return stepChannel(-1);
    if (action === "channel_down") return stepChannel(1);
    if (action === "channels") {
      controlsRef.current = true;
      setControls(true);
      setTracksOpen(false);
      setChannelsOpen(true);
      scheduleHide();
      return;
    }
    if (action === "controls") return revealControls({ claimChannelsFocus: true });
    if (action === "favorite") {
      const target = pendingChannelIdRef.current || channelIdRef.current;
      if (target) { toggleFavorite(target); showNotice("Favorite updated"); }
      return;
    }
    if (action === "guide") return goGuide();
    if (action === "previous") return returnToPreviousChannel();
  }, [goGuide, returnToPreviousChannel, revealControls, scheduleHide, setChannelsOpen, setTracksOpen, showNotice, stepChannel, toggleFavorite]);

  useEffect(() => {
    if (!isTV) return;
    return addTvShortcutListener((key) => {
      if (key === "CHANNEL_UP") runRemoteAction(remoteShortcuts.channelUp);
      else if (key === "CHANNEL_DOWN") runRemoteAction(remoteShortcuts.channelDown);
      else runRemoteAction(remoteShortcuts.mediaPlayPause);
    });
  }, [isTV, remoteShortcuts.channelDown, remoteShortcuts.channelUp, remoteShortcuts.mediaPlayPause, runRemoteAction]);

  useEffect(() => {
    if (!isTV) return;
    // Long Select is exclusively owned by the contextual Quick Actions route.
    // The generic long-press channel keeps only Long Down browsing behavior.
    return addTvLongPressListener((key) => {
      if (key === "DOWN") runRemoteAction(remoteShortcuts.longDown);
    });
  }, [isTV, remoteShortcuts.longDown, runRemoteAction]);

  useEffect(() => {
    const routeChannelId = String(params.channelId || "").trim();
    if (!routeChannelId || routeChannelId === lastRouteChannelIdRef.current) return;
    lastRouteChannelIdRef.current = routeChannelId;
    if (routeChannelId === channelIdRef.current) return;
    changeChannel(routeChannelId);
  }, [changeChannel, params.channelId]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!controlsRef.current) {
        revealControls();
        return true;
      }
      if (tracksOpen) {
        closeOverlayAndRestoreFocus();
        scheduleHide();
        return true;
      }
      if (channelsOpen) {
        closeOverlayAndRestoreFocus();
        scheduleHide();
        return true;
      }
      stopAndExit();
      return true;
    });
    return () => sub.remove();
  }, [channelsOpen, closeOverlayAndRestoreFocus, revealControls, scheduleHide, stopAndExit, tracksOpen]);

  const engineScaleMode: PlayerScaleMode = scaleMode === "fill" ? "zoom" : scaleMode === "stretch" ? "stretch" : "fit";

  return (
    <View style={styles.root}>
      <RNStatusBar hidden />
      {hasStream ? (
        <ErrorBoundary
          onReset={() => {
            const generation = generationRef.current + 1;
            generationRef.current = generation;
            setStatus("loading");
            setFailReason(null);
            // A render crash is the one path that destroys the native player.
            // Wait for that release before mounting the next command adapter.
            void stopAllPlaybackSessions("crashed").catch(() => undefined).then(() => {
              if (generation === generationRef.current) setRetryToken((value) => value + 1);
            });
          }}
          fallback={(reset) => (
            <View style={styles.errorOverlay}>
              <Ionicons name="warning-outline" size={32} color={tvColors.purpleSoft} />
              <Text style={styles.errorTitle}>Player crashed</Text>
              <Text style={styles.errorText}>The decoder hit an unexpected error. Retry keeps you on this channel.</Text>
              <Pressable
                hasTVPreferredFocus
                onPress={reset}
                style={({ focused }: any) => [styles.retry, focused && styles.focused]}
              >
                <Ionicons name="refresh" size={14} color="#fff" />
                <Text style={styles.retryText}>Retry Player</Text>
              </Pressable>
            </View>
          )}
        >
          <StreamPlayer
            key={`play-${retryToken}`}
            uri={streamUri}
            channelKey={channelId}
            mode="full"
          sessionRole="fullscreen"
            audioTrack={audioTrackId}
            textTrack={textTrackId}
            paused={playbackPaused}
            scaleMode={engineScaleMode}
            onTracksAvailable={(tracks) => {
              const audio = tracks.audio.filter((track) => track.id !== "" && track.id != null);
              const text = tracks.text.filter((track) => track.id !== "" && track.id != null);
              setAudioTracks(audio);
              setTextTracks(text);
              const appliedAudioFor = channelIdRef.current;
              if (audioAutoAppliedRef.current !== appliedAudioFor) {
                const pickedAudio = pickPreferredAudioTrack(
                  audio.filter((track) => track.isSupported !== false),
                  audioPreferences.byChannel[appliedAudioFor],
                  audioPreferences.defaultLanguage,
                );
                if (pickedAudio) setAudioTrackId(pickedAudio.id);
                audioAutoAppliedRef.current = appliedAudioFor;
              }
              // Auto-pick default subtitle language once per channel; Off keeps textTrackId undefined.
              const appliedFor = channelIdRef.current;
              if (
                textTrackIdRef.current === undefined &&
                subtitleAutoAppliedRef.current !== appliedFor &&
                subtitleDefaultLanguageRef.current
              ) {
                const picked = pickDefaultSubtitleTrack(text, subtitleDefaultLanguageRef.current);
                if (picked) {
                  textTrackIdRef.current = picked.id;
                  setTextTrackId(picked.id);
                }
                subtitleAutoAppliedRef.current = appliedFor;
              }
            }}
            onStatus={handleStreamStatus}
            style={scaleMode === "zoom" ? [StyleSheet.absoluteFill, styles.zoomedVideo] : StyleSheet.absoluteFill}
          />
        </ErrorBoundary>
      ) : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        focusable={!isTV}
        onPress={() => {
          if (controls) {
            controlsRef.current = false;
            setControls(false);
            setChannelsOpen(false);
            setTracksOpen(false);
                } else {
            revealControls();
          }
        }}
        testID="player-surface"
      />

      {(!hasStream || status === "error") ? (
        <View style={styles.errorOverlay} pointerEvents="box-none">
          <Ionicons name="warning-outline" size={32} color={tvColors.purpleSoft} />
          <Text style={styles.errorTitle}>{hasStream ? "Stream unavailable" : "No stream available"}</Text>
          {hasStream ? (
            <Text style={styles.errorText}>
              {failReason ? FAIL_REASON_LABEL[failReason] : "Use Retry Now to re-prepare this stream."}
            </Text>
          ) : null}
          {hasStream ? (
            <Pressable
              // Never steal focus from Next/Prev while controls are up during rapid zapping.
              hasTVPreferredFocus={!controls}
              onPress={retryNow}
              style={({ focused }: any) => [styles.retry, focused && styles.focused]}
            >
              <Ionicons name="refresh" size={14} color="#fff" />
              <Text style={styles.retryText}>Retry Now</Text>
            </Pressable>
          ) : (
            <Pressable
              hasTVPreferredFocus={!controls}
              onPress={stopAndExit}
              style={({ focused }: any) => [styles.retry, focused && styles.focused]}
            >
              <Ionicons name="arrow-back" size={14} color="#fff" />
              <Text style={styles.retryText}>Back to Guide</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {notice ? (
        <View style={styles.notice} pointerEvents="none">
          <ActivityIndicator size="small" color="#fff" />
          <Text numberOfLines={1} style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {controls ? (
        <>
          <LinearGradient
            colors={["rgba(5,4,13,0.92)", "rgba(5,4,13,0.42)", "transparent"]}
            style={[
              styles.topOverlay,
              {
                paddingTop: insets.top + safe.top + 8,
                paddingLeft: safe.left + 14,
                paddingRight: safe.right + 14,
              },
            ]}
          >
            <View style={styles.channelIdentity}>
              {channel ? <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={34} /> : null}
              <View>
                <Text style={styles.channelTitle}>
                  {channel ? `${channelNumbers ? `${numberById[channel.id] || ""}  ` : ""}${channel.name}` : "Live TV"}
                </Text>
                <Text numberOfLines={1} style={styles.nowText}>{current?.title || "Live channel"}</Text>
              </View>
            </View>
            <View style={styles.topSpacer} />
            <Text style={styles.clock}>{fmtTime(playerNow.toISOString())}</Text>
          </LinearGradient>

          <LinearGradient
            colors={["transparent", "rgba(5,4,13,0.90)", "rgba(5,4,13,0.98)"]}
            style={[
              styles.bottomOverlay,
              {
                paddingLeft: safe.left + 14,
                paddingRight: safe.right + 14,
                paddingBottom: insets.bottom + safe.bottom + 10,
              },
            ]}
          >
            <View style={styles.infoRow}>
              <View style={styles.programCopy}>
                <View style={styles.liveLine}>
                  <View style={styles.livePill}><Text style={styles.livePillText}>LIVE</Text></View>
                  <Text style={styles.programTime}>
                    {current ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}` : "Streaming now"}
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.programTitle}>{current?.title || channel?.name || "Live TV"}</Text>
                <AutoScrollProgramDescription text={programDescription} activeKey={programDescriptionKey} />
              </View>
            </View>

            <View style={styles.progressRow}>
              <Text style={styles.edgeTime}>{current ? fmtTime(current.start) : "LIVE"}</Text>
              <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
              <Text style={styles.edgeTime}>{current?.stop ? fmtTime(current.stop) : "LIVE"}</Text>
            </View>

            <View style={styles.controlsRow}>
              <Pressable onPress={goGuide} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}>
                <Ionicons name="information-circle-outline" size={15} color="#fff" />
                <Text style={styles.controlLabel}>Guide</Text>
              </Pressable>
              <Pressable
                ref={channelsButtonRef}
                onPress={() => {
                  overlayOpenerRef.current = channelsButtonRef.current;
                  setTracksOpen(false);
                              setChannelsOpen((value) => !value);
                  scheduleHide();
                }}
                style={({ focused }: any) => [styles.textControl, channelsOpen && styles.controlActive, focused && styles.focused]}
              >
                <Ionicons name="list" size={15} color="#fff" />
                <Text style={styles.controlLabel}>Channels</Text>
              </Pressable>
              <View style={styles.controlsSpacer} />
              <Pressable
                ref={prevButtonRef}
                disabled={streamChannels.length < 2}
                onPress={() => stepChannel(-1)}
                style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}
              >
                <Ionicons name="play-skip-back" size={18} color="#fff" />
              </Pressable>
              <Pressable
                accessibilityLabel={playbackPaused ? "Play stream" : "Pause stream"}
                onPress={() => {
                  setPlaybackPaused((value) => !value);
                  revealControls({ claimChannelsFocus: false });
                }}
                style={({ focused }: any) => [styles.pauseControl, focused && styles.focused]}
              >
                <Ionicons name={playbackPaused ? "play" : "pause"} size={18} color="#fff" />
              </Pressable>
              <Pressable
                ref={nextButtonRef}
                disabled={streamChannels.length < 2}
                onPress={() => stepChannel(1)}
                style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}
              >
                <Ionicons name="play-skip-forward" size={18} color="#fff" />
              </Pressable>
              <View style={styles.controlsSpacer} />
              <Pressable
                onPress={() => {
                  setChannelsOpen(false);
                  setTracksOpen(false);
                  if (hideTimer.current) clearTimeout(hideTimer.current);
                  emitTvQuickActions("player");
                }}
                style={({ focused }: any) => [styles.textControl, focused && styles.focused]}
              >
                <Ionicons name="ellipsis-horizontal" size={15} color="#fff" />
                <Text style={styles.controlLabel}>Quick Actions</Text>
              </Pressable>
              <Pressable onPress={stopAndExit} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}>
                <Ionicons name="stop" size={15} color="#fff" />
                <Text style={styles.controlLabel}>Stop</Text>
              </Pressable>
            </View>

            {tracksOpen ? (
              <View style={styles.tracksPanel}>
                <Text style={styles.controlLabel}>Audio</Text>
                {audioTracks.length ? audioTracks.map((track) => (
                  <Pressable
                    key={`a-${track.id}`}
                    disabled={track.isSupported === false}
                    onPress={() => {
                      setAudioTrackId(track.id);
                      audioPreferences.rememberChannelTrack(channelId, track.id);
                    }}
                    style={({ focused }: any) => [
                      styles.trackRow,
                      audioTrackId === track.id && styles.controlActive,
                      track.isSupported === false && styles.trackUnsupported,
                      focused && styles.focused,
                    ]}
                  >
                    <Text style={styles.controlLabel}>
                      {track.name}{track.isSupported === false ? " · unsupported on this decoder" : ""}
                    </Text>
                  </Pressable>
                )) : <Text style={styles.errorText}>No audio tracks reported</Text>}
                <Text style={[styles.controlLabel, { marginTop: 8 }]}>Subtitles</Text>
                <Pressable
                  onPress={() => setTextTrackId(undefined)}
                  style={({ focused }: any) => [styles.trackRow, textTrackId == null && styles.controlActive, focused && styles.focused]}
                >
                  <Text style={styles.controlLabel}>Off</Text>
                </Pressable>
                {textTracks.map((track) => (
                  <Pressable
                    key={`t-${track.id}`}
                    onPress={() => setTextTrackId(track.id)}
                    style={({ focused }: any) => [styles.trackRow, textTrackId === track.id && styles.controlActive, focused && styles.focused]}
                  >
                    <Text style={styles.controlLabel}>{track.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {channelsOpen ? (
              <View>
                <Text style={styles.controlLabel}>Previous & recent channels</Text>
              <FlatList
                data={historyChannels}
                horizontal
                keyExtractor={(item) => item.id}
                initialNumToRender={8}
                maxToRenderPerBatch={6}
                windowSize={4}
                removeClippedSubviews={false}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.channelStrip}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => changeChannel(item.id, true)}
                    onFocus={() => previewChannel(item.id)}
                    style={({ focused }: any) => [styles.channelCard, item.id === channelId && styles.channelCardActive, focused && styles.focused]}
                  >
                    <ChannelLogo name={item.name} logo={item.logo} disabled={!channelLogos} size={30} />
                    <Text numberOfLines={1} style={styles.channelCardName}>{item.name}</Text>
                  </Pressable>
                )}
              />
              </View>
            ) : null}
          </LinearGradient>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  zoomedVideo: { transform: [{ scale: 1.2 }] },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.54)" },
  errorTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  errorText: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5 },
  retry: { minHeight: 31, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8.5 },
  notice: { position: "absolute", top: "47%", alignSelf: "center", maxWidth: "70%", minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, borderRadius: 18, backgroundColor: "rgba(10,8,22,0.88)", borderWidth: 1, borderColor: tvColors.lineStrong },
  noticeText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9 },
  topOverlay: { position: "absolute", top: 0, left: 0, right: 0, minHeight: 82, flexDirection: "row", alignItems: "flex-start", paddingBottom: 18 },
  channelIdentity: { flexDirection: "row", alignItems: "center", gap: 9 },
  channelTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 15 },
  nowText: { color: "rgba(255,255,255,0.78)", fontFamily: fonts.regular, fontSize: 8.5, marginTop: 2, maxWidth: 360 },
  topSpacer: { flex: 1 },
  clock: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5, marginTop: 4 },
  bottomOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 70 },
  infoRow: { flexDirection: "row", alignItems: "flex-end" },
  programCopy: { maxWidth: "62%" },
  liveLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  livePill: { backgroundColor: tvColors.purple, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  livePillText: { color: "#fff", fontFamily: fonts.bold, fontSize: 6.5 },
  programTime: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 14, marginTop: 3 },
  descriptionViewport: { height: 26, overflow: "hidden" },
  description: { color: "rgba(255,255,255,0.76)", fontFamily: fonts.regular, fontSize: 8.5, lineHeight: 12, marginTop: 2 },
  progressRow: { height: 20, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  edgeTime: { width: 42, color: "#fff", fontFamily: fonts.medium, fontSize: 7.5 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  fill: { height: 3, backgroundColor: tvColors.purpleBright },
  controlsRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6 },
  textControl: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  controlActive: { backgroundColor: tvColors.purpleDeep },
  controlLabel: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  controlsSpacer: { flex: 1 },
  iconControl: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, borderWidth: 2, borderColor: "transparent" },
  pauseControl: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple },
  channelStrip: { gap: 6, paddingTop: 5 },
  tracksPanel: { maxHeight: 160, marginTop: 6, padding: 8, borderRadius: radius.sm, backgroundColor: "rgba(16,16,30,0.94)", gap: 4 },
  trackRow: { minHeight: 28, justifyContent: "center", paddingHorizontal: 8, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  trackUnsupported: { opacity: 0.45 },
  channelCard: { width: 96, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: "rgba(16,16,30,0.94)", padding: 4 },
  channelCardActive: { backgroundColor: tvColors.purpleDeep, borderColor: tvColors.purpleBright },
  channelCardName: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.5, textAlign: "center" },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
