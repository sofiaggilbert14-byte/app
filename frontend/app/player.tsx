import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Platform,
  StatusBar as RNStatusBar,
  BackHandler,
  useWindowDimensions,
  Animated,
  Easing,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { StreamPlayer, StreamStatus, vlcAvailable } from "@/src/components/StreamPlayer";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { nowNext, fmtTime, progressPct } from "@/src/utils/time";
import { formatChannelLabel } from "@/src/utils/channelLabel";
import { addTvKeyListener } from "@/src/utils/tvRemote";
import { getTvSafeInsets } from "@/src/utils/tvLayout";

const CHANNEL_PREVIEW_DELAY_MS = 650;
const SWITCH_NOTICE_MS = 2_500;
const STREAM_RETRY_MS = 3_000;
const MAX_AUTO_RETRIES = 20;
const RED = "#E3222A";
const RED_SOFT = "#FF5258";

function AutoScrollProgramDescription({ text, activeKey }: { text: string; activeKey: string }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    translateY.stopAnimation();
    translateY.setValue(0);
    if (!text || !viewportHeight || contentHeight <= viewportHeight + 2) return;

    const overflow = contentHeight - viewportHeight;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1100),
        Animated.timing(translateY, {
          toValue: -overflow,
          duration: Math.max(4200, overflow * 95),
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(900),
        Animated.timing(translateY, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      translateY.stopAnimation();
    };
  }, [activeKey, contentHeight, text, translateY, viewportHeight]);

  if (!text) return null;
  return (
    <View
      style={styles.programDescViewport}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      <Animated.Text
        onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
        style={[styles.programDesc, { transform: [{ translateY }] }]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const tvSafe = getTvSafeInsets(width, height);
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId: string }>();
  const {
    channels,
    addRecent,
    channelById,
    playerControlsTimeoutMs,
    autoRetryStreams,
    channelNumbers,
    channelLogos,
    safePreviewMode,
  } = useStore();

  const [channelId, setChannelId] = useState(params.channelId);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const channel = useMemo(() => channelById(channelId), [channelId, channelById]);
  const streamChannels = useMemo(() => channels.filter((item) => !!item.url), [channels]);
  const streamIndex = useMemo(
    () => streamChannels.findIndex((item) => item.id === channelId),
    [channelId, streamChannels],
  );
  const channelNumberById = useMemo(() => {
    const map: Record<string, number> = {};
    [...channels]
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }))
      .forEach((item, index) => {
        map[item.id] = index + 1;
      });
    return map;
  }, [channels]);
  const hasStream = !!channel?.url;
  const [controls, setControls] = useState(true);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef(controls);
  const tuneGenerationRef = useRef(0);
  // TVs use remote key events; phones rotate naturally without forcing orientation.
  const isTV = Platform.OS !== "web" && Platform.isTV;
  const overlayHideMs = playerControlsTimeoutMs;

  const showSwitchNotice = useCallback((name: string) => {
    if (switchNoticeTimer.current) clearTimeout(switchNoticeTimer.current);
    setSwitchNotice(name);
    switchNoticeTimer.current = setTimeout(() => setSwitchNotice(null), SWITCH_NOTICE_MS);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), overlayHideMs);
  }, [overlayHideMs]);

  const retryStreamNow = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const generation = tuneGenerationRef.current;
    setStatus("loading");
    setReconnectAttempt((n) => n + 1);
    showSwitchNotice(`Reconnecting ${channel?.name || "stream"}`);
    requestAnimationFrame(() => {
      if (generation === tuneGenerationRef.current) setRetryToken((t) => t + 1);
    });
  }, [channel?.name, showSwitchNotice]);

  const changeChannel = useCallback((id: string, { haptic = false } = {}) => {
    if (id === channelId) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const c = channelById(id);
    if (!c) return;
    if (haptic) void Haptics.selectionAsync().catch(() => {});
    tuneGenerationRef.current += 1;
    showSwitchNotice(`Switching to ${c.name}`);
    setStatus("loading");
    setReconnectAttempt(0);
    setChannelId(id);
    addRecent(c);
    scheduleHide();
  }, [addRecent, channelById, channelId, scheduleHide, showSwitchNotice]);

  const stepStream = useCallback((direction: -1 | 1) => {
    if (streamChannels.length < 2) return;
    const baseIndex = streamIndex >= 0 ? streamIndex : 0;
    const nextIndex = (baseIndex + direction + streamChannels.length) % streamChannels.length;
    const target = streamChannels[nextIndex];
    if (target) changeChannel(target.id, { haptic: true });
  }, [changeChannel, streamChannels, streamIndex]);

  const surf = (id: string) => {
    changeChannel(id, { haptic: true });
  };

  const previewChannel = (id: string) => {
    if (safePreviewMode === "off") return;
    if (id === channelId) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    const delayMs = safePreviewMode === "delayed" ? 1500 : CHANNEL_PREVIEW_DELAY_MS;
    previewTimer.current = setTimeout(() => {
      changeChannel(id);
    }, delayMs);
  };

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Burn-in protection: auto-hide the controls (incl. the top channel name and
  // bottom channel list) shortly after the stream starts. Tap the screen
  // (mobile) or press any remote key (TV) to bring them back briefly.
  useEffect(() => {
    if (hasStream) {
      setControls(true);
      scheduleHide();
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [channelId, hasStream, retryToken, scheduleHide]);

  useEffect(
    () => () => {
      if (switchNoticeTimer.current) clearTimeout(switchNoticeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (channel) addRecent(channel);
  }, [channel, addRecent]);

  useEffect(() => {
    if (status === "playing") {
      setReconnectAttempt(0);
      if (controlsRef.current) scheduleHide();
    }
  }, [scheduleHide, status]);

  // Auto-retry when a stream drops, capped so we don't loop forever.
  // Stop, Back, Guide, Search, or another channel leaves and cancels retries.
  useEffect(() => {
    if (!autoRetryStreams || !hasStream || status !== "error") return;
    if (reconnectAttempt >= MAX_AUTO_RETRIES) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      retryStreamNow();
    }, STREAM_RETRY_MS);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [autoRetryStreams, channelId, hasStream, reconnectAttempt, retryStreamNow, status]);

  // On TV, any D-pad / remote key reveals the controls again, then re-arms the
  // auto-hide. Uses native TvRemoteKey events from the withTvRemote plugin.
  useEffect(() => {
    if (!isTV) return;
    const unsub = addTvKeyListener(() => {
      if (!controlsRef.current) {
        setControls(true);
      }
      scheduleHide();
    });
    return unsub;
  }, [isTV, scheduleHide]);

  const toggleControls = () => {
    setControls((v) => {
      const nv = !v;
      if (nv) scheduleHide();
      return nv;
    });
  };

  const stopAndExit = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    // Leaving the screen unmounts <StreamPlayer/>, which stops the stream.
    router.back();
  }, [router]);

  const leavePlayerTo = (route: "/" | "/search" | "/settings") => {
    void Haptics.selectionAsync().catch(() => {});
    router.replace(route as any);
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!controls) {
        setControls(true);
        scheduleHide();
        return true;
      }
      stopAndExit();
      return true;
    });
    return () => sub.remove();
  }, [controls, scheduleHide, stopAndExit]);

  const playerNow = new Date(nowMs);
  const { current, next } = nowNext(channel?.programs, playerNow);
  const programProgress = current ? progressPct(current, playerNow) : 0;
  const programDescriptionKey = `${channelId}:${current?.start || ""}:${current?.title || ""}`;
  const autoRetryPaused = hasStream && status === "error" && reconnectAttempt >= MAX_AUTO_RETRIES;

  return (
    <View style={styles.container}>
      <RNStatusBar hidden />
      {hasStream && (
        <ErrorBoundary
          fallback={(reset) => (
            <Pressable
              onPress={() => {
                reset();
                retryStreamNow();
              }}
              style={styles.centerOverlay}
            >
              <Text style={styles.errText}>Playback crashed — tap to retry</Text>
            </Pressable>
          )}
        >
          <StreamPlayer
            key={`${channelId}-${retryToken}`}
            uri={channel?.url || ""}
            onStatus={setStatus}
            style={StyleSheet.absoluteFill}
          />
        </ErrorBoundary>
      )}

      <Pressable style={StyleSheet.absoluteFill} focusable={!isTV} onPress={toggleControls} testID="player-surface" />

      {(!hasStream || status === "error") && (
        <View style={styles.centerOverlay}>
          <Ionicons name="warning-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.errText}>
            {!hasStream
              ? "This channel has no stream"
              : autoRetryPaused
                ? "Auto-retry paused — press Retry Now"
                : "Reconnecting to stream..."}
          </Text>
          {hasStream && (
            <Text style={styles.errHint}>
              Attempt {Math.max(1, reconnectAttempt + 1)}
              {autoRetryStreams ? ` (stops after ${MAX_AUTO_RETRIES} attempts)` : ""}.
              {" "}If retries pause, wait a minute then Retry Now.
              {" "}Press Back, Stop, Guide, or pick another channel to leave.
            </Text>
          )}
          {hasStream && !vlcAvailable && (
            <Text style={styles.errHint}>
              Live playback needs the installed app build — not the Expo Go preview.
            </Text>
          )}
          {hasStream && (
            <Pressable
              style={({ focused }: any) => [styles.retryBtn, focused && styles.ctrlFocused]}
              onPress={() => {
                retryStreamNow();
              }}
              testID="player-retry-btn"
            >
              <Text style={styles.retryText}>Retry Now</Text>
            </Pressable>
          )}
        </View>
      )}

      {switchNotice && (
        <View style={styles.switchNotice} pointerEvents="none">
          <ActivityIndicator color="#fff" size="small" />
          <Text numberOfLines={1} style={styles.switchNoticeText}>
            {switchNotice}
          </Text>
        </View>
      )}

      {controls && (
        <>
          <LinearGradient
            colors={["rgba(3,7,11,0.94)", "rgba(3,7,11,0.35)", "transparent"]}
            style={[
              styles.topScrim,
              {
                paddingTop: insets.top + tvSafe.top + spacing.sm,
                paddingLeft: spacing.lg + tvSafe.left,
                paddingRight: spacing.lg + tvSafe.right,
              },
            ]}
          >
            <Pressable
              style={({ focused }: any) => [styles.backBtn, focused && styles.ctrlFocused]}
              onPress={stopAndExit}
              testID="player-back-btn"
            >
              <Ionicons name="arrow-back" size={32} color="#fff" />
            </Pressable>
            {channel && <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={58} />}
            <View style={styles.topChannelText}>
              <Text numberOfLines={1} style={styles.chTitle}>
                {channel
                  ? formatChannelLabel(channel.name, {
                      number: channelNumberById[channel.id],
                      showNumber: channelNumbers,
                    })
                  : "Channel"}
              </Text>
              <Text numberOfLines={1} style={styles.chNow}>
                {current ? <Text><Text style={styles.liveText}>Now: </Text>{current.title}</Text> : "Live channel"}
                {next ? <Text>  <Text style={styles.liveText}>•  Next {fmtTime(next.start)}: </Text>{next.title}</Text> : null}
              </Text>
            </View>
            <View style={styles.buildPill}>
              <Text style={styles.buildPillText}>RC1</Text>
            </View>
          </LinearGradient>

          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.97)"]}
            style={[
              styles.bottomScrim,
              {
                paddingBottom: insets.bottom + tvSafe.bottom + spacing.md,
                paddingLeft: spacing.lg + tvSafe.left,
                paddingRight: spacing.lg + tvSafe.right,
              },
            ]}
          >
            <View style={styles.programPanel}>
              {channel && (
                <View style={styles.programArt}>
                  <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={88} />
                </View>
              )}
              <View style={styles.programCopy}>
                <Text numberOfLines={1} style={styles.programTitle}>{current?.title || channel?.name || "Live TV"}</Text>
                <View style={styles.programTimeRow}>
                  <View style={styles.livePill}><Text style={styles.livePillText}>LIVE</Text></View>
                  <Text style={styles.programTime}>
                    {current ? `${fmtTime(current.start)} – ${current.stop ? fmtTime(current.stop) : "Live"}` : "Streaming now"}
                  </Text>
                </View>
                <AutoScrollProgramDescription text={current?.desc || ""} activeKey={programDescriptionKey} />
                {!!current?.category && <Text numberOfLines={1} style={styles.programCategory}>{current.category}</Text>}
              </View>
              <View style={styles.panelChannelMark}>
                <Text numberOfLines={2} style={styles.panelChannelName}>{channel?.name || "CharmIPTV"}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${programProgress}%` }]} />
              </View>
              <Text style={styles.liveEdge}>LIVE ●</Text>
            </View>

            <View style={styles.mainControls}>
              <Pressable
                style={({ focused }: any) => [styles.mainBtn, focused && styles.ctrlFocused]}
                onPress={() => stepStream(-1)}
                disabled={streamChannels.length < 2}
                testID="player-previous-btn"
              >
                <Ionicons name="play-skip-back-outline" size={22} color="#fff" />
                <Text style={styles.mainBtnText}>Previous</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.mainBtn, focused && styles.ctrlFocused]}
                onPress={() => leavePlayerTo("/")}
                testID="player-guide-btn"
              >
                <Ionicons name="list-outline" size={22} color="#fff" />
                <Text style={styles.mainBtnText}>Guide</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.mainBtn, channelsOpen && styles.mainBtnActive, focused && styles.ctrlFocused]}
                onPress={() => {
                  setChannelsOpen((value) => !value);
                  scheduleHide();
                }}
                testID="player-channels-btn"
              >
                <Ionicons name="list" size={22} color="#fff" />
                <Text style={styles.mainBtnText}>Channels</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.mainBtn, focused && styles.ctrlFocused]}
                onPress={() => stepStream(1)}
                disabled={streamChannels.length < 2}
                testID="player-next-btn"
              >
                <Ionicons name="play-skip-forward-outline" size={22} color="#fff" />
                <Text style={styles.mainBtnText}>Next</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.mainBtn, styles.stopBtn, focused && styles.ctrlFocused]}
                onPress={stopAndExit}
                testID="player-overlay-stop-btn"
              >
                <Ionicons name="stop" size={22} color="#fff" />
                <Text style={styles.mainBtnText}>Stop</Text>
              </Pressable>
            </View>

            {channelsOpen && (
              <FlatList
                data={streamChannels}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(c) => c.id}
                initialNumToRender={8}
                maxToRenderPerBatch={6}
                windowSize={4}
                removeClippedSubviews
                contentContainerStyle={styles.channelStrip}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => surf(item.id)}
                    onFocus={() => {
                      if (safePreviewMode !== "off") previewChannel(item.id);
                    }}
                    style={({ focused }: any) => [
                      styles.surfItem,
                      item.id === channelId && styles.surfActive,
                      focused && styles.surfFocused,
                    ]}
                    testID={`surf-${item.id}`}
                  >
                    <ChannelLogo name={item.name} logo={item.logo} disabled={!channelLogos} size={38} />
                    {channelNumbers && <Text style={styles.surfNumber}>{channelNumberById[item.id] || ""}</Text>}
                    <Text numberOfLines={1} style={styles.surfName}>{item.name}</Text>
                  </Pressable>
                )}
              />
            )}
          </LinearGradient>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: spacing.md },
  errText: { color: colors.onSurfaceSecondary, fontFamily: fonts.medium, fontSize: 15 },
  errHint: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", paddingHorizontal: spacing.xl },
  retryBtn: { backgroundColor: RED, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  retryText: { color: "#fff", fontFamily: fonts.semibold },
  switchNotice: {
    position: "absolute", alignSelf: "center", top: "48%", flexDirection: "row", alignItems: "center",
    gap: spacing.sm, backgroundColor: "rgba(0,0,0,0.82)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, zIndex: 9, maxWidth: "82%",
  },
  switchNoticeText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13, maxWidth: 360 },
  ctrlFocused: { borderWidth: 3, borderColor: "#fff", borderRadius: radius.md, backgroundColor: "rgba(227,34,42,0.25)" },
  surfFocused: { borderWidth: 3, borderColor: "#fff", borderRadius: radius.md, backgroundColor: "rgba(227,34,42,0.25)" },
  topScrim: {
    position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center",
    gap: spacing.md, paddingBottom: spacing.xxl, minHeight: 118,
  },
  backBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  topChannelText: { flex: 1, minWidth: 0 },
  chTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 25 },
  chNow: { color: "rgba(255,255,255,0.9)", fontFamily: fonts.regular, fontSize: 15, marginTop: 5 },
  liveText: { color: RED_SOFT, fontFamily: fonts.semibold },
  buildPill: { borderWidth: 1.5, borderColor: RED_SOFT, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  buildPillText: { color: RED_SOFT, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.4 },
  bottomScrim: { position: "absolute", bottom: 0, left: 0, right: 0, paddingTop: 70, gap: spacing.sm },
  programPanel: {
    minHeight: 88, maxHeight: 96, borderRadius: 12, backgroundColor: "rgba(3,3,3,0.88)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)", flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm,
    paddingTop: 6, paddingBottom: 13, gap: spacing.sm, overflow: "hidden",
  },
  programArt: {
    width: 92, alignSelf: "stretch", minHeight: 58, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  programCopy: { flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 17 },
  programTimeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  livePill: { backgroundColor: RED, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  livePillText: { color: "#fff", fontFamily: fonts.bold, fontSize: 11 },
  programTime: { color: "rgba(255,255,255,0.85)", fontFamily: fonts.medium, fontSize: 11 },
  programDescViewport: { height: 28, overflow: "hidden", marginTop: 3 },
  programDesc: { color: "rgba(255,255,255,0.92)", fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 14 },
  programCategory: { color: "rgba(255,255,255,0.58)", fontFamily: fonts.medium, fontSize: 9.5, marginTop: 2 },
  panelChannelMark: {
    width: 116, alignSelf: "stretch", borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm,
  },
  panelChannelName: { color: "#fff", fontFamily: fonts.bold, fontSize: 13, textAlign: "center" },
  progressTrack: { position: "absolute", left: spacing.md, right: 78, bottom: 10, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: RED, borderRadius: 3 },
  liveEdge: { position: "absolute", right: spacing.md, bottom: 5, color: RED_SOFT, fontFamily: fonts.bold, fontSize: 12 },
  mainControls: { flexDirection: "row", gap: 6 },
  mainBtn: {
    flex: 1, minWidth: 0, height: 47, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingHorizontal: 4, backgroundColor: "rgba(30,32,35,0.96)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)", borderRadius: radius.md,
  },
  mainBtnActive: { backgroundColor: "rgba(227,34,42,0.42)", borderColor: RED_SOFT },
  stopBtn: { backgroundColor: RED, borderColor: RED_SOFT },
  mainBtnText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  channelStrip: { gap: spacing.sm, paddingTop: spacing.xs },
  surfItem: {
    width: 104, minHeight: 68, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: radius.md,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(18,20,23,0.96)", padding: spacing.xs,
  },
  surfActive: { borderColor: RED, backgroundColor: "rgba(227,34,42,0.20)" },
  surfName: { color: "rgba(255,255,255,0.86)", fontFamily: fonts.medium, fontSize: 10, textAlign: "center" },
  surfNumber: { color: RED_SOFT, fontFamily: fonts.bold, fontSize: 10 },
});
