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
import { nowNext, fmtTime } from "@/src/utils/time";
import { addTvKeyListener } from "@/src/utils/tvRemote";

const CHANNEL_PREVIEW_DELAY_MS = 650;
const SWITCH_NOTICE_MS = 2_500;
const STREAM_RETRY_MS = 3_000;
const TV_OVERLAY_HIDE_MS = 8_000;
const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId: string }>();
  const {
    channels,
    addRecent,
    channelById,
    hardRefresh,
    playerControlsTimeoutMs,
    autoRetryStreams,
    isFavorite,
    toggleFavorite,
    channelNumbers,
    channelLogos,
  } = useStore();

  const [channelId, setChannelId] = useState(params.channelId);
  const channel = useMemo(() => channelById(channelId), [channelId, channelById]);
  const channelIndex = useMemo(() => channels.findIndex((c) => c.id === channelId), [channels, channelId]);
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
  const [lastPlayerChannelId, setLastPlayerChannelId] = useState<string | null>(null);
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef(controls);
  const lastPlayerChannel = useMemo(
    () => (lastPlayerChannelId ? channelById(lastPlayerChannelId) : undefined),
    [lastPlayerChannelId, channelById],
  );

  // TVs use remote key events; phones rotate naturally without Phoenix forcing orientation.
  const isTV = Platform.OS !== "web" && Platform.isTV;
  const overlayHideMs = isTV ? Math.min(playerControlsTimeoutMs, TV_OVERLAY_HIDE_MS) : playerControlsTimeoutMs;

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
    setStatus("loading");
    setReconnectAttempt((n) => n + 1);
    showSwitchNotice(`Reconnecting ${channel?.name || "stream"}`);
    setRetryToken((t) => t + 1);
  }, [channel?.name, showSwitchNotice]);

  const changeChannel = useCallback((id: string, { haptic = false } = {}) => {
    if (id === channelId) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const c = channelById(id);
    if (!c) return;
    if (haptic) void Haptics.selectionAsync().catch(() => {});
    setLastPlayerChannelId(channelId);
    showSwitchNotice(c.name);
    setStatus("loading");
    setReconnectAttempt(0);
    setChannelId(id);
    addRecent(c);
    scheduleHide();
  }, [addRecent, channelById, channelId, scheduleHide, showSwitchNotice]);

  const surf = (id: string) => {
    changeChannel(id, { haptic: true });
  };

  const surfByOffset = (offset: number) => {
    if (!channels.length || channelIndex < 0) return;
    const nextIndex = (channelIndex + offset + channels.length) % channels.length;
    const next = channels[nextIndex];
    if (next) surf(next.id);
  };

  const previewChannel = (id: string) => {
    if (id === channelId) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      changeChannel(id);
    }, CHANNEL_PREVIEW_DELAY_MS);
  };

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

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

  // Keep trying forever when a stream drops. The user stays in control: Stop,
  // Back, Guide, Search, or another channel will leave the stream and cancel
  // the retry loop by unmounting this screen or changing channel.
  useEffect(() => {
    if (!autoRetryStreams || !hasStream || status !== "error") return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      retryStreamNow();
    }, STREAM_RETRY_MS);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [autoRetryStreams, channelId, hasStream, retryStreamNow, status]);

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

  const { current, next } = nowNext(channel?.programs, new Date());

  return (
    <View style={styles.container}>
      <RNStatusBar hidden />
      {hasStream && (
        <ErrorBoundary fallback={() => null}>
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
          <Text style={styles.errText}>{hasStream ? "Reconnecting to stream..." : "This channel has no stream"}</Text>
          {hasStream && (
            <Text style={styles.errHint}>
              Attempt {Math.max(1, reconnectAttempt + 1)}. Press Back, Stop, Guide, or pick another channel to leave.
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
            Switching to {switchNotice}
          </Text>
        </View>
      )}

      {controls && (
        <>
          <LinearGradient
            colors={["rgba(0,0,0,0.85)", "transparent"]}
            style={[styles.topScrim, { paddingTop: insets.top + spacing.sm }]}
          >
            <Pressable
              style={({ focused }: any) => [styles.backBtn, focused && styles.ctrlFocused]}
              onPress={stopAndExit}
              testID="player-back-btn"
            >
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.chTitle}>
                {channel ? `${channelNumbers ? `${channelNumberById[channel.id] || ""} · ` : ""}${channel.name}` : "Channel"}
              </Text>
              {current && (
                <Text numberOfLines={1} style={styles.chNow}>
                  Now: {current.title}
                  {next ? `  ·  Next ${fmtTime(next.start)}: ${next.title}` : ""}
                </Text>
              )}
            </View>
          </LinearGradient>

          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.9)"]}
            style={[styles.bottomScrim, { paddingBottom: insets.bottom + spacing.md }]}
          >
            <View style={styles.quickControls}>
              <Pressable
                style={({ focused }: any) => [styles.quickBtn, focused && styles.ctrlFocused]}
                disabled={!channel}
                onPress={() => {
                  if (!channel) return;
                  void Haptics.selectionAsync().catch(() => {});
                  toggleFavorite(channel.id);
                  scheduleHide();
                }}
                testID="player-favorite-btn"
              >
                <Ionicons name={channel && isFavorite(channel.id) ? "star" : "star-outline"} size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Favorite</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.quickBtn, focused && styles.ctrlFocused]}
                onPress={() => leavePlayerTo("/settings")}
                testID="player-settings-btn"
              >
                <Ionicons name="settings-outline" size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Settings</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.quickBtn, focused && styles.ctrlFocused]}
                onPress={() => surfByOffset(-1)}
                testID="player-prev-channel-btn"
              >
                <Ionicons name="play-skip-back" size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Previous</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.quickBtn, focused && styles.ctrlFocused]}
                onPress={stopAndExit}
                testID="player-overlay-stop-btn"
              >
                <Ionicons name="stop" size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Stop</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [
                  styles.quickBtn,
                  !lastPlayerChannel && styles.quickBtnDisabled,
                  focused && styles.ctrlFocused,
                ]}
                disabled={!lastPlayerChannel}
                onPress={() => lastPlayerChannel && surf(lastPlayerChannel.id)}
                testID="player-last-channel-btn"
              >
                <Ionicons name="return-up-back" size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Last</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.quickBtn, focused && styles.ctrlFocused]}
                onPress={() => surfByOffset(1)}
                testID="player-next-channel-btn"
              >
                <Ionicons name="play-skip-forward" size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Next</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.quickBtn, focused && styles.ctrlFocused]}
                onPress={() => leavePlayerTo("/")}
                testID="player-guide-btn"
              >
                <Ionicons name="list" size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Guide</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.quickBtn, focused && styles.ctrlFocused]}
                onPress={() => leavePlayerTo("/search")}
                testID="player-search-btn"
              >
                <Ionicons name="search" size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Search</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.quickBtn, focused && styles.ctrlFocused]}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  hardRefresh();
                  scheduleHide();
                }}
                testID="player-guide-refresh-btn"
              >
                <Ionicons name="refresh" size={18} color={GOLD_SOFT} />
                <Text style={styles.quickBtnText}>Refresh</Text>
              </Pressable>
            </View>
            <Text style={styles.surfLabel}>Channels</Text>
            <FlatList
              data={channels}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(c) => c.id}
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={5}
              removeClippedSubviews
              contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => surf(item.id)}
                  onFocus={() => previewChannel(item.id)}
                  style={({ focused }: any) => [
                    styles.surfItem,
                    item.id === channelId && styles.surfActive,
                    focused && styles.surfFocused,
                  ]}
                  testID={`surf-${item.id}`}
                >
                  <ChannelLogo name={item.name} logo={item.logo} disabled={!channelLogos} size={44} />
                  {channelNumbers && <Text style={styles.surfNumber}>{channelNumberById[item.id] || ""}</Text>}
                  <Text numberOfLines={1} style={styles.surfName}>{item.name}</Text>
                </Pressable>
              )}
            />
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
  errHint: {
    color: colors.onSurfaceTertiary,
    fontFamily: fonts.regular,
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  retryBtn: { backgroundColor: colors.brand, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  retryText: { color: "#fff", fontFamily: fonts.semibold },
  switchNotice: {
    position: "absolute",
    alignSelf: "center",
    top: "54%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    zIndex: 9,
    maxWidth: "82%",
  },
  switchNoticeText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13, maxWidth: 320 },
  ctrlFocused: { borderWidth: 2, borderColor: GOLD_SOFT, borderRadius: radius.sm, backgroundColor: "rgba(246,183,60,0.18)" },
  surfFocused: { borderWidth: 2, borderColor: GOLD_SOFT, borderRadius: radius.sm, backgroundColor: "rgba(246,183,60,0.18)" },
  topScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  chTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 18 },
  chNow: { color: "rgba(255,255,255,0.75)", fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  bottomScrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
  quickControls: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  quickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(30,20,12,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.20)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    minWidth: 92,
    justifyContent: "center",
  },
  quickBtnDisabled: { opacity: 0.35 },
  quickBtnText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  surfLabel: { color: GOLD, fontFamily: fonts.semibold, fontSize: 13, paddingHorizontal: spacing.lg },
  surfItem: {
    width: 98,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.12)",
    backgroundColor: "rgba(0,0,0,0.22)",
    padding: spacing.xs,
  },
  surfActive: { opacity: 1 },
  surfName: { color: "rgba(255,255,255,0.8)", fontFamily: fonts.medium, fontSize: 10, textAlign: "center" },
  surfNumber: { color: GOLD_SOFT, fontFamily: fonts.bold, fontSize: 10 },
});
