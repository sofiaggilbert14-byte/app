import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  Platform,
  StatusBar as RNStatusBar,
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
import { nowNext, fmtTime } from "@/src/utils/time";

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId: string }>();
  const { channels, addRecent, channelById } = useStore();

  const [channelId, setChannelId] = useState(params.channelId);
  const channel = useMemo(() => channelById(channelId), [channelId, channelById]);
  const [controls, setControls] = useState(true);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Allow the device to rotate freely while watching; restore on exit.
  useEffect(() => {
    if (Platform.OS === "web") return;
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  const toggleFullscreen = async () => {
    Haptics.selectionAsync();
    scheduleHide();
    if (Platform.OS === "web") {
      setFullscreen((v) => !v);
      return;
    }
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
    const c = channelById(id);
    if (!c) return;
    Haptics.selectionAsync();
    setChannelId(id);
    addRecent(c);
    scheduleHide();
  };

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 4500);
  };

  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const toggleControls = () => {
    setControls((v) => {
      const nv = !v;
      if (nv) scheduleHide();
      return nv;
    });
  };

  const { current, next } = nowNext(channel?.programs, new Date());

  return (
    <View style={styles.container}>
      <RNStatusBar hidden />
      <StreamPlayer
        key={`${channelId}-${retryToken}`}
        uri={channel?.url || ""}
        onStatus={setStatus}
        style={StyleSheet.absoluteFill}
      />

      <Pressable style={StyleSheet.absoluteFill} onPress={toggleControls} testID="player-surface" />

      {status === "loading" && (
        <View style={[styles.centerOverlay, { pointerEvents: "none" }]}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      )}
      {status === "error" && (
        <View style={styles.centerOverlay}>
          <Ionicons name="warning-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.errText}>Unable to play this stream</Text>
          {!vlcAvailable && (
            <Text style={styles.errHint}>
              Live playback needs the installed app build — not the Expo Go preview.
            </Text>
          )}
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              setStatus("loading");
              setRetryToken((t) => t + 1);
            }}
            testID="player-retry-btn"
          >
            <Text style={styles.retryText}>Retry Source</Text>
          </Pressable>
        </View>
      )}

      {controls && (
        <>
          <LinearGradient
            colors={["rgba(0,0,0,0.85)", "transparent"]}
            style={[styles.topScrim, { paddingTop: insets.top + spacing.sm }]}
          >
            <Pressable style={styles.backBtn} onPress={() => router.back()} testID="player-back-btn">
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
            <Pressable style={styles.fsBtn} onPress={toggleFullscreen} testID="player-fullscreen-btn">
              <Ionicons name={fullscreen ? "contract" : "expand"} size={22} color="#fff" />
            </Pressable>
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
              contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => surf(item.id)}
                  style={[styles.surfItem, item.id === channelId && styles.surfActive]}
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
