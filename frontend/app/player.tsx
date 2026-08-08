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
  vlcAvailable,
  clearFullscreenCircuit,
  type StreamTrack,
} from "@/src/components/StreamPlayer";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { addTvKeyListener } from "@/src/utils/tvRemote";
import { getTvSafeInsets } from "@/src/utils/tvLayout";
import { requestNativeFocus } from "@/src/utils/tvFocus";
import { stopFullscreenSession, stopAllPlaybackSessions, pauseSessionDecoders, type SessionFailReason } from "@/src/core/playbackSession";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";

const CHANNEL_PREVIEW_DELAY_MS = 650;
const CHANNEL_ZAP_SETTLE_MS = 850;
const STREAM_RETRY_MS = 3000;
const MAX_AUTO_STREAM_RETRIES = 4;
const SWITCH_NOTICE_MS = 1800;

const FAIL_REASON_LABEL: Record<SessionFailReason, string> = {
  "start-timeout": "start timeout — trying alternate engine",
  "engine-swap": "switched playback engine",
  "circuit-open": "temporarily paused after repeated failures",
  "stream-error": "stream error",
  "silent-audio": "no supported Media3 audio track",
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
  const params = useLocalSearchParams<{ channelId: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const {
    channels,
    channelById,
    addRecent,
    playerControlsTimeoutMs,
    autoRetryStreams,
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
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [playerNow, setPlayerNow] = useState(() => new Date());
  // Decoder is disarmed while rapid Next/Prev or strip surfing — prevents VLC pile-up / audio leaks.
  const [decoderArmed, setDecoderArmed] = useState(true);
  const [audioTracks, setAudioTracks] = useState<StreamTrack[]>([]);
  const [textTracks, setTextTracks] = useState<StreamTrack[]>([]);
  const [audioTrackId, setAudioTrackId] = useState<string | number | undefined>(undefined);
  const [textTrackId, setTextTrackId] = useState<string | number | undefined>(undefined);
  const [tracksOpen, setTracksOpen] = useState(false);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef(true);
  const channelsOpenRef = useRef(false);
  const generationRef = useRef(0);
  const channelsButtonRef = useRef<any>(null);
  const nextButtonRef = useRef<any>(null);
  const prevButtonRef = useRef<any>(null);
  const preferControlRef = useRef<"next" | "prev" | null>(null);
  const lastStripFocusAtRef = useRef(0);
  const rapidStripUntilRef = useRef(0);
  const pendingChannelIdRef = useRef(params.channelId);
  const channelIdRef = useRef(params.channelId);

  const isTV = Platform.OS !== "web" && Platform.isTV;
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
  const sortedChannels = useMemo(
    () => [...channels].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" })),
    [channels],
  );
  const streamChannels = useMemo(() => sortedChannels.filter((item) => !!item.url), [sortedChannels]);
  const numberById = useMemo(() => {
    const result: Record<string, number> = {};
    sortedChannels.forEach((item, index) => { result[item.id] = index + 1; });
    return result;
  }, [sortedChannels]);

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
    setAudioTracks([]);
    setTextTracks([]);
    setAudioTrackId(undefined);
    setTextTrackId(undefined);
    setTracksOpen(false);
  }, [channelId, retryToken]);

  const { current, next } = nowNext(channel?.programs, playerNow);
  const progress = current ? progressPct(current, playerNow) : 0;
  const hasStream = !!channel?.url;
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
    }, overlayHideMs);
  }, [overlayHideMs]);

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

  const armDecoderAfterSettle = useCallback((delayMs: number) => {
    if (zapTimer.current) clearTimeout(zapTimer.current);
    zapTimer.current = setTimeout(() => {
      // Commit pending channel and remount a single decoder only after surfing settles.
      const pending = pendingChannelIdRef.current;
      channelIdRef.current = pending;
      setChannelId(pending);
      setRetryAttempt(0);
      setStatus("loading");
      setFailReason(null);
      setDecoderArmed(true);
      setRetryToken((value) => value + 1);
    }, delayMs);
  }, []);

  const changeChannel = useCallback((id: string, haptic = false, opts?: { immediate?: boolean }) => {
    if (!id) return;
    const target = channelById(id);
    if (!target) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (zapTimer.current) clearTimeout(zapTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (haptic) void Haptics.selectionAsync().catch(() => undefined);

    pendingChannelIdRef.current = id;
    channelIdRef.current = id;
    generationRef.current += 1;
    setRetryAttempt(0);
    setStatus("loading");
    setFailReason(null);
    setChannelId(id);
    addRecent(target);
    showNotice(`Switching to ${target.name}`);
    // Keep strip/card focus — do not reclaim Channels button.
    revealControls({ claimChannelsFocus: false });

    if (opts?.immediate) {
      // Pause decoders only — do not bump session generation while StreamPlayer is still mounted.
      pauseSessionDecoders("fullscreen");
      setDecoderArmed(true);
      setRetryToken((value) => value + 1);
      return;
    }

    // Tear down the live fullscreen decoder before swapping — rapid Next/Prev was orphaning VLC audio.
    pauseSessionDecoders("fullscreen");
    setDecoderArmed(false);
    armDecoderAfterSettle(CHANNEL_ZAP_SETTLE_MS);
  }, [addRecent, armDecoderAfterSettle, channelById, revealControls, showNotice]);

  const previewChannel = useCallback((id: string) => {
    if (id === pendingChannelIdRef.current) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (zapTimer.current) clearTimeout(zapTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const nowTs = Date.now();
    const rapid = nowTs - lastStripFocusAtRef.current < 240;
    lastStripFocusAtRef.current = nowTs;
    if (rapid) rapidStripUntilRef.current = nowTs + 900;
    pendingChannelIdRef.current = id;
    setChannelId(id);
    const target = channelById(id);
    if (target) {
      addRecent(target);
      showNotice(`Switching to ${target.name}`);
    }
    pauseSessionDecoders("fullscreen");
    setDecoderArmed(false);
    revealControls({ claimChannelsFocus: false });
    const delay = nowTs < rapidStripUntilRef.current || rapid
      ? Math.max(CHANNEL_PREVIEW_DELAY_MS, CHANNEL_ZAP_SETTLE_MS)
      : CHANNEL_PREVIEW_DELAY_MS;
    previewTimer.current = setTimeout(() => {
      const remaining = rapidStripUntilRef.current - Date.now();
      if (remaining > 0) {
        // Still in a held-strip burst — reschedule instead of abandoning the arm.
        previewTimer.current = setTimeout(() => {
          if (pendingChannelIdRef.current !== id) return;
          if (Date.now() < rapidStripUntilRef.current) return;
          armDecoderAfterSettle(40);
        }, remaining + 40);
        return;
      }
      if (pendingChannelIdRef.current !== id) return;
      armDecoderAfterSettle(40);
    }, delay);
  }, [addRecent, armDecoderAfterSettle, channelById, revealControls, showNotice]);

  const stepChannel = useCallback((direction: -1 | 1) => {
    if (streamChannels.length < 2) return;
    const currentId = pendingChannelIdRef.current || channelIdRef.current;
    const base = Math.max(0, streamChannels.findIndex((item) => item.id === currentId));
    const nextIndex = (base + direction + streamChannels.length) % streamChannels.length;
    const target = streamChannels[nextIndex];
    if (!target) return;
    preferControlRef.current = direction > 0 ? "next" : "prev";
    // Debounced zap: UI + notice update now; decoder remounts only after settle.
    changeChannel(target.id, true);
  }, [changeChannel, streamChannels]);

  const restartStream = useCallback((clearCircuit: boolean) => {
    if (!hasStream) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (zapTimer.current) clearTimeout(zapTimer.current);
    const generation = generationRef.current;
    // Only a deliberate Retry button clears the breaker. Auto retry must honor
    // accumulated failures or a bad source remounts native decoders forever.
    if (clearCircuit) clearFullscreenCircuit(channel?.url);
    pauseSessionDecoders("fullscreen");
    // Force a real native-view remount. Keeping a stopped VLC view mounted with
    // the same source is a black-screen dead end on Fire TV.
    setDecoderArmed(false);
    setStatus("loading");
    setFailReason(null);
    setRetryAttempt((value) => value + 1);
    showNotice(`Reconnecting ${channel?.name || "stream"}`);
    setRetryToken((value) => value + 1);
    requestAnimationFrame(() => {
      if (generation === generationRef.current) setDecoderArmed(true);
    });
  }, [channel?.name, channel?.url, hasStream, showNotice]);

  const retryNow = useCallback(() => {
    setRetryAttempt(0);
    restartStream(true);
  }, [restartStream]);

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  useEffect(() => {
    channelsOpenRef.current = channelsOpen;
  }, [channelsOpen]);

  // Cold mount / explicit retry only — channel zaps must not reclaim Channels focus.
  useEffect(() => {
    revealControls({ claimChannelsFocus: true });
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (zapTimer.current) clearTimeout(zapTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional cold-mount/retry only
  }, [retryToken]);

  useEffect(
    () => () => {
      stopFullscreenSession();
      if (zapTimer.current) clearTimeout(zapTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    [],
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
      setRetryAttempt(0);
      if (controlsRef.current) scheduleHide();
    }
  }, [scheduleHide, status]);

  useEffect(() => {
    if (status !== "error" && hasStream) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    controlsRef.current = true;
    setControls(true);
  }, [hasStream, status]);

  useEffect(() => {
    if (!autoRetryStreams || !hasStream || status !== "error") return;
    if (retryAttempt >= MAX_AUTO_STREAM_RETRIES) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const delay = STREAM_RETRY_MS * Math.min(4, 2 ** retryAttempt);
    retryTimer.current = setTimeout(() => restartStream(false), delay);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [autoRetryStreams, hasStream, restartStream, retryAttempt, status]);

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
    if (zapTimer.current) clearTimeout(zapTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    generationRef.current += 1;
    setDecoderArmed(false);
    stopFullscreenSession();
    router.back();
  }, [router]);

  const handleStreamStatus = useCallback(
    (next: StreamStatus, reason?: SessionFailReason | null) => {
      setStatus(next);
      if (reason !== undefined) setFailReason(reason);
      // Engine swaps invalidate prior Media3 track ids (derived FORMAT ids differ).
      if (reason === "silent-audio" || reason === "engine-swap") {
        setAudioTrackId(undefined);
        setTextTrackId(undefined);
        setTracksOpen(false);
      }
      if (next === "playing") setFailReason(null);
    },
    [],
  );

  const goGuide = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (zapTimer.current) clearTimeout(zapTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    generationRef.current += 1;
    setDecoderArmed(false);
    stopFullscreenSession();
    router.replace("/guide" as any);
  }, [router]);

  useEffect(() => {
    if (!params.channelId || params.channelId === channelIdRef.current) return;
    changeChannel(params.channelId, false, { immediate: true });
  }, [changeChannel, params.channelId]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!controlsRef.current) {
        revealControls();
        return true;
      }
      if (tracksOpen) {
        setTracksOpen(false);
        scheduleHide();
        return true;
      }
      if (channelsOpen) {
        setChannelsOpen(false);
        scheduleHide();
        return true;
      }
      stopAndExit();
      return true;
    });
    return () => sub.remove();
  }, [channelsOpen, revealControls, scheduleHide, stopAndExit, tracksOpen]);

  return (
    <View style={styles.root}>
      <RNStatusBar hidden />
      {hasStream && decoderArmed ? (
        <ErrorBoundary
          onReset={() => {
            stopAllPlaybackSessions("crashed");
            setDecoderArmed(true);
            setRetryToken((value) => value + 1);
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
            uri={channel?.url || ""}
            sessionRole="fullscreen"
            audioTrack={audioTrackId}
            textTrack={textTrackId}
            onTracksAvailable={(tracks) => {
              setAudioTracks(tracks.audio.filter((track) => track.id !== "" && track.id != null));
              setTextTracks(tracks.text.filter((track) => track.id !== "" && track.id != null));
            }}
            onStatus={handleStreamStatus}
            style={StyleSheet.absoluteFill}
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
          } else {
            revealControls();
          }
        }}
        testID="player-surface"
      />

      {(!hasStream || status === "error") ? (
        <View style={styles.errorOverlay} pointerEvents="box-none">
          <Ionicons name="warning-outline" size={32} color={tvColors.purpleSoft} />
          <Text style={styles.errorTitle}>{hasStream ? "Reconnecting stream…" : "No stream available"}</Text>
          {hasStream ? (
            <Text style={styles.errorText}>
              Attempt {Math.max(1, retryAttempt + 1)}
              {failReason ? ` · ${FAIL_REASON_LABEL[failReason]}` : " · recovering"}
            </Text>
          ) : null}
          {hasStream && !vlcAvailable ? <Text style={styles.errorText}>Playback requires the installed Android build.</Text> : null}
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
                onPress={() => setChannelsOpen((value) => !value)}
                style={({ focused }: any) => [styles.textControl, channelsOpen && styles.controlActive, focused && styles.focused]}
              >
                <Ionicons name="list" size={15} color="#fff" />
                <Text style={styles.controlLabel}>Channels</Text>
              </Pressable>
              <Pressable
                onPress={() => setTracksOpen((value) => !value)}
                style={({ focused }: any) => [styles.textControl, tracksOpen && styles.controlActive, focused && styles.focused]}
              >
                <Ionicons name="musical-notes-outline" size={15} color="#fff" />
                <Text style={styles.controlLabel}>Audio/CC</Text>
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
                accessibilityLabel="Hide player controls"
                onPress={() => {
                  controlsRef.current = false;
                  setControls(false);
                  setChannelsOpen(false);
                }}
                style={({ focused }: any) => [styles.pauseControl, focused && styles.focused]}
              >
                <Ionicons name="eye-off-outline" size={18} color="#fff" />
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
              <Pressable onPress={() => router.replace("/settings" as any)} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}>
                <Ionicons name="settings-outline" size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={stopAndExit} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}>
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>

            {tracksOpen ? (
              <View style={styles.tracksPanel}>
                <Text style={styles.controlLabel}>Audio</Text>
                {audioTracks.length ? audioTracks.map((track) => (
                  <Pressable
                    key={`a-${track.id}`}
                    disabled={track.isSupported === false}
                    onPress={() => setAudioTrackId(track.id)}
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
              <FlatList
                data={streamChannels}
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
                    onPress={() => changeChannel(item.id, true, { immediate: true })}
                    onFocus={() => previewChannel(item.id)}
                    style={({ focused }: any) => [styles.channelCard, item.id === channelId && styles.channelCardActive, focused && styles.focused]}
                  >
                    <ChannelLogo name={item.name} logo={item.logo} disabled={!channelLogos} size={30} />
                    <Text numberOfLines={1} style={styles.channelCardName}>{item.name}</Text>
                  </Pressable>
                )}
              />
            ) : null}
          </LinearGradient>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
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