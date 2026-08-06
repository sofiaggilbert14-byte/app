import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { TimelineGrid } from "@/src/components/TimelineGrid";
import { BoxGrid } from "@/src/components/BoxGrid";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, StreamStatus } from "@/src/components/StreamPlayer";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { requestNativeFocus } from "@/src/utils/tvFocus";

const BASE_GROUPS = ["All", "Favorites", "Recently Watched", "Sports", "News", "Movies", "Kids", "Music"];

function byName(a: Channel, b: Channel) {
  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
}

function matches(channel: Channel, group: string) {
  const value = `${channel.group || ""} ${channel.name || ""}`.toLowerCase();
  if (group === "Sports") return /sport|nfl|nba|mlb|nhl|ufc|espn/.test(value);
  if (group === "News") return /news|weather|cnn|fox|msnbc|bbc|cnbc/.test(value);
  if (group === "Movies") return /movie|cinema|film|vod/.test(value);
  if (group === "Kids") return /kid|family|cartoon|nick|disney/.test(value);
  if (group === "Music") return /music|mtv|vh1|radio|hits/.test(value);
  return channel.group === group;
}

function AutoScrollDescription({ text }: { text: string }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    const overflow = Math.max(0, contentHeight - viewportHeight);

    translateY.stopAnimation();
    translateY.setValue(0);
    if (overflow <= 2 || !viewportHeight || !contentHeight) return undefined;

    const schedule = () => {
      pauseTimer = setTimeout(() => {
        if (cancelled) return;
        const duration = Math.max(6500, Math.round((overflow / 14) * 1000));
        Animated.timing(translateY, {
          toValue: -overflow,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (cancelled || !finished) return;
          // Jump back to the beginning, pause there, then repeat.
          translateY.setValue(0);
          schedule();
        });
      }, 3500);
    };

    schedule();
    return () => {
      cancelled = true;
      if (pauseTimer) clearTimeout(pauseTimer);
      translateY.stopAnimation();
      translateY.setValue(0);
    };
  }, [contentHeight, text, translateY, viewportHeight]);

  return (
    <View
      style={styles.aboutViewport}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      pointerEvents="none"
    >
      <Animated.View
        onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
        style={{ transform: [{ translateY }] }}
      >
        <Text style={styles.description}>{text}</Text>
      </Animated.View>
    </View>
  );
}

export default function PurpleGuideScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const {
    channels,
    windowStart,
    windowEnd,
    loading,
    refreshing,
    error,
    hardRefresh,
    addRecent,
    openProgram,
    favorites,
    recent,
    lastChannelId,
    toggleFavorite,
    guideLayout,
    guideDensity,
    safePreviewMode,
    channelNumbers,
    channelLogos,
    reminders,
  } = useStore();

  const [now, setNow] = useState(() => new Date().toISOString());
  const [group, setGroup] = useState("All");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [resetToken, setResetToken] = useState(0);
  // First guide row starts focused; allow Up to reach group chips until focus moves deeper.
  const [trapGuideUp, setTrapGuideUp] = useState(false);
  const metadataTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupChangedAt = useRef(0);
  const bootRetryRef = useRef(0);
  const groupChipRefs = useRef(new Map<string, any>());
  const trapGuideUpRef = useRef(false);
  const lastFocusAtRef = useRef(0);
  const reminderKeys = useMemo(() => new Set(reminders.map((item) => item.key)), [reminders]);

  // Aggressive recovery: if the guide is empty after load, retry without requiring Settings.
  useEffect(() => {
    if (loading || refreshing) return;
    if (channels.length > 0) return;
    if (bootRetryRef.current >= 2) return;
    bootRetryRef.current += 1;
    void hardRefresh();
  }, [loading, refreshing, channels.length, hardRefresh]);

  useEffect(() => {
    if (loading || refreshing || !error || channels.length > 0) return;
    if (bootRetryRef.current >= 2) return;
    bootRetryRef.current += 1;
    const timer = setTimeout(() => void hardRefresh(), 1500);
    return () => clearTimeout(timer);
  }, [loading, refreshing, error, channels.length, hardRefresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (metadataTimer.current) clearTimeout(metadataTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    [],
  );

  const groups = useMemo(() => {
    const known = new Set(BASE_GROUPS);
    const extras = Array.from(new Set(channels.map((c) => c.group).filter(Boolean) as string[]))
      .filter((item) => !known.has(item))
      .slice(0, 8);
    return [...BASE_GROUPS, ...extras].filter((item) => {
      if (item === "All") return true;
      if (item === "Favorites") return favorites.length > 0;
      if (item === "Recently Watched") return recent.length > 0;
      return channels.some((channel) => matches(channel, item));
    });
  }, [channels, favorites.length, recent.length]);

  const filtered = useMemo(() => {
    let list: Channel[];
    if (group === "All") list = channels;
    else if (group === "Favorites") list = channels.filter((c) => favorites.includes(c.id));
    else if (group === "Recently Watched") {
      list = recent.map((item) => channels.find((c) => c.id === item.id) || item).filter(Boolean) as Channel[];
    } else list = channels.filter((c) => matches(c, group));
    return [...list].sort(byName);
  }, [channels, favorites, group, recent]);

  // If Favorites/Recent (or a vanished category) becomes empty, fall back to All
  // so the guide never leaves an unfocusable empty FlashList.
  useEffect(() => {
    if (!groups.includes(group)) {
      setGroup("All");
      setTrapGuideUp(false);
      setResetToken((value) => value + 1);
    }
  }, [group, groups]);

  const channelNumberById = useMemo(() => {
    const result: Record<string, number> = {};
    [...channels].sort(byName).forEach((channel, index) => {
      result[channel.id] = index + 1;
    });
    return result;
  }, [channels]);

  const previewChannel = useMemo(() => {
    const focused = focusedId ? filtered.find((c) => c.id === focusedId) : null;
    if (focused) return focused;
    const last = lastChannelId ? filtered.find((c) => c.id === lastChannelId) : null;
    return last || filtered.find((c) => c.programs?.length) || filtered[0] || null;
  }, [filtered, focusedId, lastChannelId]);

  const current = useMemo(
    () => (previewChannel ? nowNext(previewChannel.programs, new Date(now)).current : undefined),
    [now, previewChannel],
  );
  const progress = current ? progressPct(current, new Date(now)) : 0;
  const previewVisible =
    safePreviewMode !== "off" &&
    !!previewChannel?.url &&
    previewId === previewChannel.id &&
    previewStatus !== "error";

  const previewDelay = safePreviewMode === "delayed" ? 1500 : 950;

  const detailsRailWidth = useMemo(() => {
    // The former rail used a 0.78 / 1.9 flex relationship, clamped to 228–340.
    // Recreate that effective width, then reduce it by exactly 30% so the
    // reclaimed space always goes to the guide on both 720p and 1080p TVs.
    const available = Math.max(480, screenWidth - 196);
    const former = Math.min(340, Math.max(228, available * (0.78 / (1.9 + 0.78))));
    return Math.round(Math.min(238, Math.max(160, former * 0.7)));
  }, [screenWidth]);

  const onFocusChannel = useCallback(
    (channel: Channel) => {
      if (metadataTimer.current) clearTimeout(metadataTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
      const requestedId = channel.id;
      const nowTs = Date.now();
      const rapid = nowTs - lastFocusAtRef.current < 220;
      lastFocusAtRef.current = nowTs;
      const recentlyChangedGroup = nowTs - groupChangedAt.current < 1800;
      const delay = recentlyChangedGroup
        ? Math.max(previewDelay, 1300)
        : rapid
          ? Math.max(previewDelay, 1600)
          : previewDelay;
      // Defer rail/preview updates while the remote is repeating so the grid stays snappy.
      const metadataDelay = rapid ? 360 : 160;

      metadataTimer.current = setTimeout(() => {
        setFocusedId(requestedId);
        setPreviewStatus("loading");
        if (safePreviewMode === "off" || !channel.url) {
          setPreviewId(null);
          return;
        }
        previewTimer.current = setTimeout(() => setPreviewId(requestedId), delay);
      }, metadataDelay);
    },
    [previewDelay, safePreviewMode],
  );

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      addRecent(channel);
      router.push({ pathname: "/player", params: { channelId: channel.id } });
    },
    [addRecent, router],
  );

  const chooseGroup = useCallback((next: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (metadataTimer.current) clearTimeout(metadataTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    groupChangedAt.current = Date.now();
    setGroup(next);
    setFocusedId(null);
    setPreviewId(null);
    setPreviewStatus("loading");
    setTrapGuideUp(false);
    setResetToken((value) => value + 1);
  }, []);

  const onFocusedGuideRow = useCallback((index: number) => {
    const next = index > 0;
    if (trapGuideUpRef.current === next) return;
    trapGuideUpRef.current = next;
    setTrapGuideUp(next);
  }, []);

  const onGuideUpBoundary = useCallback(() => {
    if (trapGuideUpRef.current) {
      trapGuideUpRef.current = false;
      setTrapGuideUp(false);
    }
    const chip = groupChipRefs.current.get(group);
    if (chip) requestNativeFocus(chip);
  }, [group]);

  const resetGuide = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (metadataTimer.current) clearTimeout(metadataTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    groupChangedAt.current = Date.now();
    setGroup("All");
    setFocusedId(null);
    setPreviewId(null);
    setPreviewStatus("loading");
    setTrapGuideUp(false);
    setResetToken((value) => value + 1);
    void hardRefresh();
  }, [hardRefresh]);

  const aboutText = current?.desc || "Move through the guide to preview a channel and read its current program description.";

  return (
    <PurpleTvShell
      active="/guide"
      footerAction={{
        label: "Reset",
        icon: "refresh-outline",
        onPress: resetGuide,
        disabled: refreshing,
        testID: "purple-guide-reset",
      }}
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>TV GUIDE</Text>
            <Text style={styles.title}>{group === "All" ? "All Channels" : group}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupRow}>
            {groups.map((item) => (
              <Pressable
                key={item}
                ref={(node) => {
                  if (node) groupChipRefs.current.set(item, node);
                  else groupChipRefs.current.delete(item);
                }}
                onPress={() => chooseGroup(item)}
                style={({ focused }: any) => [
                  styles.groupChip,
                  group === item && styles.groupChipActive,
                  focused && styles.focused,
                ]}
              >
                <Text style={[styles.groupText, group === item && styles.groupTextActive]}>
                  {item === "Recently Watched" ? "Recent" : item}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <EpgProgressBar />

        {loading && channels.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={tvColors.purpleBright} size="large" />
            <Text style={styles.centerText}>Loading channels and guide…</Text>
            <Pressable
              hasTVPreferredFocus
              focusable
              disabled={refreshing}
              onPress={() => void hardRefresh()}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="purple-guide-retry-loading"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Loading…" : "Retry now"}</Text>
            </Pressable>
          </View>
        ) : error && channels.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={32} color={tvColors.purpleSoft} />
            <Text style={styles.centerText}>{error}</Text>
            <Pressable
              hasTVPreferredFocus
              focusable
              disabled={refreshing}
              onPress={() => void hardRefresh()}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="purple-guide-retry-error"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Reloading…" : "Reload guide"}</Text>
            </Pressable>
          </View>
        ) : channels.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="tv-outline" size={32} color={tvColors.purpleSoft} />
            <Text style={styles.centerText}>No channels in the current playlist yet.</Text>
            <Pressable
              hasTVPreferredFocus
              focusable
              disabled={refreshing}
              onPress={() => void hardRefresh()}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="purple-guide-retry-empty"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Loading…" : "Reload guide"}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.body}>
            <FocusGuide style={styles.gridPanel} autoFocus trapFocusUp={trapGuideUp} trapFocusDown trapFocusRight>
              {guideLayout === "compact" ? (
                <BoxGrid
                  channels={filtered}
                  now={now}
                  onChannelPress={play}
                  onProgramPress={openProgram}
                  onChannelFocus={onFocusChannel}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={channelLogos}
                  reminderKeys={reminderKeys}
                  resetToken={resetToken}
                  active
                  onUpBoundary={onGuideUpBoundary}
                  onFocusedRowChange={onFocusedGuideRow}
                />
              ) : (
                <TimelineGrid
                  channels={filtered}
                  windowStart={windowStart}
                  windowEnd={windowEnd}
                  now={now}
                  onChannelPress={play}
                  onProgramPress={openProgram}
                  onChannelFocus={onFocusChannel}
                  onChannelLongPress={(channel) => toggleFavorite(channel.id)}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  density={guideDensity}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={channelLogos}
                  reminderKeys={reminderKeys}
                  resetToken={resetToken}
                  active
                  onUpBoundary={onGuideUpBoundary}
                  onFocusedRowChange={onFocusedGuideRow}
                />
              )}
            </FocusGuide>

            <View style={[styles.detailsPanel, { width: detailsRailWidth }]}>
              <View style={styles.preview} pointerEvents="none">
                {previewVisible && previewChannel ? (
                  <ErrorBoundary fallback={() => null}>
                    <StreamPlayer
                      key={`purple-guide-preview-${previewChannel.id}`}
                      uri={previewChannel.url}
                      onStatus={setPreviewStatus}
                      style={StyleSheet.absoluteFill}
                    />
                  </ErrorBoundary>
                ) : (
                  <View style={styles.previewFallback}>
                    {previewChannel ? (
                      <ChannelLogo name={previewChannel.name} logo={previewChannel.logo} disabled={!channelLogos} size={46} />
                    ) : (
                      <Ionicons name="tv-outline" size={34} color={tvColors.purpleSoft} />
                    )}
                  </View>
                )}
                <View style={styles.liveTag}><Text style={styles.liveTagText}>LIVE PREVIEW</Text></View>
              </View>

              <View style={styles.detailsCopy}>
                <Text numberOfLines={1} style={styles.channelName}>
                  {previewChannel
                    ? `${channelNumbers ? `${channelNumberById[previewChannel.id] || ""}  ` : ""}${previewChannel.name}`
                    : "Select a channel"}
                </Text>
                <Text numberOfLines={2} style={styles.programTitle}>{current?.title || "No program information"}</Text>
                <Text numberOfLines={1} style={styles.timeText}>
                  {current
                    ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}`
                    : "Guide information will appear here"}
                </Text>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
                <Text style={styles.descLabel}>ABOUT</Text>
                <AutoScrollDescription text={aboutText} />
                {current?.stop ? (
                  <Text style={styles.remaining}>{Math.max(0, dayjs(current.stop).diff(dayjs(), "minute"))} min remaining</Text>
                ) : null}
                <View style={styles.actions}>
                  <Pressable
                    disabled={!previewChannel}
                    onPress={() => previewChannel && play(previewChannel)}
                    style={({ focused }: any) => [styles.watchButton, focused && styles.focused]}
                  >
                    <Ionicons name="play" size={12} color="#fff" />
                    <Text style={styles.watchText}>Watch</Text>
                  </Pressable>
                  <Pressable
                    disabled={!previewChannel}
                    onPress={() => previewChannel && toggleFavorite(previewChannel.id)}
                    style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
                  >
                    <Ionicons
                      name={previewChannel && favorites.includes(previewChannel.id) ? "heart" : "heart-outline"}
                      size={12}
                      color={tvColors.purpleSoft}
                    />
                    <Text style={styles.secondaryText}>Favorite</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 12, gap: 5 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 17, marginTop: 1, minWidth: 120 },
  groupRow: { gap: 5, alignItems: "center", paddingHorizontal: 4 },
  groupChip: { minHeight: 28, paddingHorizontal: 10, justifyContent: "center", borderRadius: 6, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  groupChipActive: { backgroundColor: tvColors.purple },
  groupText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  groupTextActive: { color: "#fff", fontFamily: fonts.semibold },
  body: { flex: 1, flexDirection: "row", gap: 8, minHeight: 0 },
  gridPanel: { flex: 1, minWidth: 0, overflow: "hidden", backgroundColor: tvColors.canvasRaised, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.sm },
  detailsPanel: { flexShrink: 0, backgroundColor: tvColors.panel, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line, overflow: "hidden" },
  preview: { width: "100%", aspectRatio: 16 / 9, flexShrink: 0, backgroundColor: "#05050B", overflow: "hidden" },
  previewFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  liveTag: { position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(124,58,237,0.92)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  liveTagText: { color: "#fff", fontFamily: fonts.bold, fontSize: 6 },
  detailsCopy: { flex: 1, minHeight: 0, padding: 8 },
  channelName: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 8 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 13, lineHeight: 15.5, marginTop: 3 },
  timeText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 7.2, marginTop: 3 },
  progressTrack: { height: 3, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 2, overflow: "hidden", marginTop: 6 },
  progressFill: { height: 3, backgroundColor: tvColors.purpleBright },
  descLabel: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 6.8, letterSpacing: 0.7, marginTop: 7, marginBottom: 3 },
  aboutViewport: { flex: 1, minHeight: 42, overflow: "hidden", borderWidth: 1, borderColor: "rgba(168,85,247,0.16)", borderRadius: 4, backgroundColor: "rgba(7,7,17,0.38)", paddingHorizontal: 5, paddingVertical: 4 },
  description: { color: "rgba(255,255,255,0.82)", fontFamily: fonts.regular, fontSize: 8.1, lineHeight: 11.5 },
  remaining: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 6.8, marginTop: 5 },
  actions: { flexDirection: "row", gap: 5, marginTop: 7, marginBottom: 4 },
  watchButton: { flex: 1, minWidth: 0, minHeight: 27, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: tvColors.purple, borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 3 },
  watchText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 7.5 },
  secondaryButton: { flex: 1, minWidth: 0, minHeight: 27, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: tvColors.panelRaised, borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 3 },
  secondaryText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  centerText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 11, textAlign: "center", maxWidth: 320 },
  retryButton: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 6, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple, marginTop: 4 },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});