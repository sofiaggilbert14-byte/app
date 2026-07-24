import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Platform,
  StatusBar as RNStatusBar,
  BackHandler,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ScreenOrientation from "expo-screen-orientation";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { StreamPlayer, StreamStatus, vlcAvailable } from "@/src/components/StreamPlayer";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { nowNext, fmtTime } from "@/src/utils/time";
import { addTvKeyListener } from "@/src/utils/tvRemote";

const CONTROLS_HIDE_MS = 8_000;
const CHANNEL_PREVIEW_DELAY_MS = 650;

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId: string }>();
  const { channels, addRecent, channelById } = useStore();

  const [channelId, setChannelId] = useState(params.channelId);
  const channel = useMemo(() => channelById(channelId), [channelId, channelById]);
  const hasStream = !!channel?.url;
  const [controls, setControls] = useState(true);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef(controls);

  // TVs are fixed landscape and reject runtime orientation locking (throws
  // ERR_SCREEN_ORIENTATION_UNSUPPORTED_ORIENTATION_LOCK → crash). Only rotate
  // on real handheld devices.
  const isTV = Platform.OS !== "web" && Platform.isTV;
  const canRotate = Platform.OS !== "web" && !Platform.isTV;

  // Auto-rotate handheld devices to landscape so the video plays full-screen
  // with the correct aspect ratio; restore portrait on exit. The lock is
  // delayed until AFTER the screen-transition animation — locking during the
  // transition is a known crash trigger on some devices.
  useEffect(() => {
    if (!canRotate) return;
    const t = setTimeout(() => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
        .then(() => setFullscreen(true))
        .catch(() => {});
    }, 400);
    return () => {
      clearTimeout(t);
      (async () => {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
          await ScreenOrientation.unlockAsync();
        } catch {}
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFullscreen = async () => {
    void Haptics.selectionAsync().catch(() => {});
    scheduleHide();
    if (Platform.OS === "web") {
      setFullscreen((v) => !v);
      return;
    }
    if (!canRotate) return; // TV: always full-screen, nothing to toggle
    try {
      if (!fullscreen) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        setFullscreen(true);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        setFullscreen(false);
        setTimeout(() => ScreenOrientation.unlockAsync().catch(() => {}), 300);
      }
    } catch {}
  };

  const surf = (id: string) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    const c = channelById(id);
    if (!c) return;
    void Haptics.selectionAsync().catch(() => {});
    setChannelId(id);
    addRecent(c);
    scheduleHide();
  };

  const previewChannel = (id: string) => {
    if (id === channelId) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      if (channelById(id)) {
        setStatus("loading");
        setChannelId(id);
      }
    }, CHANNEL_PREVIEW_DELAY_MS);
  };

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), CONTROLS_HIDE_MS);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, hasStream, retryToken]);

  useEffect(() => {
    if (status === "playing" && controlsRef.current) scheduleHide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // On TV, any D-pad / remote key reveals the controls again, then re-arms the
  // auto-hide. Uses native TvRemoteKey events from the withTvRemote plugin.
  useEffect(() => {
    if (!isTV) return;
    const unsub = addTvKeyListener(() => {
      if (!controlsRef.current) {
        setControls(true);
        scheduleHide();
      }
    });
    return unsub;
  }, [isTV]);

  const toggleControls = () => {
    setControls((v) => {
      const nv = !v;
      if (nv) scheduleHide();
      return nv;
    });
  };

  const stopAndExit = async () => {
    void Haptics.selectionAsync().catch(() => {});
    if (canRotate) {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        await ScreenOrientation.unlockAsync();
      } catch {}
    }
    // Leaving the screen unmounts <StreamPlayer/>, which stops the stream.
    router.back();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls]);

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
          <Text style={styles.errText}>{hasStream ? "Unable to play this stream" : "This channel has no stream"}</Text>
          {hasStream && !vlcAvailable && (
            <Text style={styles.errHint}>
              Live playback needs the installed app build — not the Expo Go preview.
            </Text>
          )}
          {hasStream && (
            <Pressable
              style={({ focused }: any) => [styles.retryBtn, focused && styles.ctrlFocused]}
              onPress={() => {
                setStatus("loading");
                setRetryToken((t) => t + 1);
              }}
              testID="player-retry-btn"
            >
              <Text style={styles.retryText}>Retry Source</Text>
            </Pressable>
          )}
        </View>
      )}

      {controls && (
        <>
          {hasStream && (
            <Pressable
              style={({ focused }: any) => [styles.stopBtn, focused && styles.stopFocused]}
              hasTVPreferredFocus
              onPress={stopAndExit}
              testID="player-stop-btn"
            >
              <Ionicons name="stop" size={24} color="#fff" />
              <Text style={styles.stopText}>Stop</Text>
            </Pressable>
          )}
          <LinearGradient
            colors={["rgba(0,0,0,0.85)", "transparent"]}
            style={[styles.topScrim, { paddingTop: insets.top + spacing.sm }]}
          >
            <Pressable
              style={({ focused }: any) => [styles.backBtn, focused && styles.ctrlFocused]}
              onPress={() => router.back()}
              testID="player-back-btn"
            >
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.chTitle}>{channel?.name || "Channel"}</Text>
              {current && (
                <Text numberOfLines={1} style={styles.chNow}>
                  Now: {current.title}
                  {next ? `  ·  Next ${fmtTime(next.start)}: ${next.title}` : ""}
                </Text>
              )}
            </View>
            {!isTV && (
              <Pressable
                style={({ focused }: any) => [styles.fsBtn, focused && styles.ctrlFocused]}
                onPress={toggleFullscreen}
                testID="player-fullscreen-btn"
              >
                <Ionicons name={fullscreen ? "contract" : "expand"} size={22} color="#fff" />
              </Pressable>
            )}
          </LinearGradient>

          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.9)"]}
            style={[styles.bottomScrim, { paddingBottom: insets.bottom + spacing.md }]}
          >
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
                  <ChannelLogo name={item.name} logo={item.logo} size={44} />
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
  stopBtn: {
    position: "absolute",
    alignSelf: "center",
    top: "44%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    zIndex: 10,
  },
  stopText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 15 },
  stopFocused: { borderWidth: 3, borderColor: "#fff" },
  ctrlFocused: { borderWidth: 2, borderColor: "#fff", borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.15)" },
  surfFocused: { borderWidth: 2, borderColor: "#fff", borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.15)" },
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
  fsBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
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
  surfLabel: { color: "rgba(255,255,255,0.9)", fontFamily: fonts.semibold, fontSize: 13, paddingHorizontal: spacing.lg },
  surfItem: { width: 68, alignItems: "center", gap: 4 },
  surfActive: { opacity: 1 },
  surfName: { color: "rgba(255,255,255,0.8)", fontFamily: fonts.medium, fontSize: 10, textAlign: "center" },
});
