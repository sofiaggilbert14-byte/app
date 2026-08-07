import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { requestNativeFocus, requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { MODAL_FOCUS_RETRY_DELAYS_MS } from "@/src/core/guideRegressionPolicy";

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
  // Static copy during surfing — animated marquees were restarting on every focus
  // rail update and hitching the JS thread on weak Fire TVs.
  return (
    <View style={styles.aboutViewport} pointerEvents="none">
      <Text style={styles.description} numberOfLines={8}>
        {text}
      </Text>
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
    activeProgram,
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
  const [, setPreviewStatus] = useState<StreamStatus>("loading");
  const [resetToken, setResetToken] = useState(0);
  const metadataTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupChangedAt = useRef(0);
  const bootRetryRef = useRef(0);
  const groupChipRefs = useRef(new Map<string, any>());
  const lastFocusAtRef = useRef(0);
  const rapidSurfUntilRef = useRef(0);
  const lastGuideFocusNodeRef = useRef<unknown>(null);
  const hadProgramModalRef = useRef(false);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const reminderKeys = useMemo(() => new Set(reminders.map((item) => item.key)), [reminders]);
  // Freeze grid reminder badges while the program sheet is open so Cancel/Remind
  // doesn't rebuild the FlashList under the modal (Fire TV crash / hitch source).
  const [gridReminderKeys, setGridReminderKeys] = useState(reminderKeys);
  useEffect(() => {
    if (activeProgram) {
      hadProgramModalRef.current = true;
      return;
    }
    // Delay badge sync so focus restore isn't competing with FlashList churn.
    const syncTimer = setTimeout(() => setGridReminderKeys(reminderKeys), 220);
    return () => clearTimeout(syncTimer);
  }, [activeProgram, reminderKeys]);

  // After Remind/Cancel sheet closes, return focus to the guide cell — never Live TV.
  useEffect(() => {
    if (activeProgram) return;
    if (!hadProgramModalRef.current) return;
    hadProgramModalRef.current = false;
    return requestNativeFocusWithRetry(lastGuideFocusNodeRef.current, [...MODAL_FOCUS_RETRY_DELAYS_MS]);
  }, [activeProgram]);

  const onGuideFocusNode = useCallback((node: unknown) => {
    if (node) lastGuideFocusNodeRef.current = node;
  }, []);

  // One deferred recovery only — stacked hardRefresh on boot freezes focus on weak TVs.
  useEffect(() => {
    if (loading || refreshing || channels.length > 0) return;
    if (bootRetryRef.current >= 1) return;
    bootRetryRef.current += 1;
    const timer = setTimeout(() => void hardRefresh(), 5000);
    return () => clearTimeout(timer);
  }, [loading, refreshing, channels.length, hardRefresh]);

  // Live clock for the rail only — do not rebuild the guide geometry every minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 5 * 60_000);
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
    const present = new Set<string>();
    for (const channel of channels) {
      for (const base of BASE_GROUPS) {
        if (base === "All" || base === "Favorites" || base === "Recently Watched") continue;
        if (matches(channel, base)) present.add(base);
      }
      if (channel.group && !known.has(channel.group)) present.add(channel.group);
    }
    const extras = Array.from(present).filter((item) => !known.has(item)).slice(0, 8);
    return [...BASE_GROUPS, ...extras].filter((item) => {
      if (item === "All") return true;
      if (item === "Favorites") return favorites.length > 0;
      if (item === "Recently Watched") return recent.length > 0;
      return present.has(item);
    });
  }, [channels, favorites.length, recent.length]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const filtered = useMemo(() => {
    // All: return the same channels ref so favorite toggles do not rebuild TimelineGrid geometry.
    if (group === "All") return channels;
    if (group === "Favorites") {
      return channels.filter((c) => favoriteSet.has(c.id)).sort(byName);
    }
    if (group === "Recently Watched") {
      const list = recent
        .map((item) => channels.find((c) => c.id === item.id) || item)
        .filter(Boolean) as Channel[];
      return list.sort(byName);
    }
    return channels.filter((c) => matches(c, group)).sort(byName);
  }, [channels, favoriteSet, group, recent]);

  const onChannelLongPress = useCallback(
    (channel: Channel) => {
      toggleFavorite(channel.id);
    },
    [toggleFavorite],
  );

  // If Favorites/Recent (or a vanished category) becomes empty, fall back to All
  // so the guide never leaves an unfocusable empty FlashList.
  useEffect(() => {
    if (!groups.includes(group)) {
      setGroup("All");
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
    previewId === previewChannel.id;

  const previewDelay = safePreviewMode === "delayed" ? 2200 : 1600;

  const schedulePreview = useCallback((requestedId: string, delay: number, hasUrl: boolean) => {
    if (safePreviewMode === "off" || !hasUrl) {
      setPreviewId(null);
      return;
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      // Break the sticky error latch — always remount the decoder for this tune.
      setPreviewStatus("loading");
      setPreviewEpoch((value) => value + 1);
      setPreviewId(requestedId);
    }, delay);
  }, [safePreviewMode]);

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
      const rapid = nowTs - lastFocusAtRef.current < 240;
      lastFocusAtRef.current = nowTs;
      if (rapid) rapidSurfUntilRef.current = nowTs + 700;

      // While the user is holding/repeating directions: zero rail/preview work.
      if (nowTs < rapidSurfUntilRef.current || rapid) {
        metadataTimer.current = setTimeout(() => {
          if (Date.now() < rapidSurfUntilRef.current) return;
          setFocusedId(requestedId);
          schedulePreview(requestedId, previewDelay, !!channel.url);
        }, 750);
        return;
      }

      const recentlyChangedGroup = nowTs - groupChangedAt.current < 1800;
      const delay = recentlyChangedGroup ? Math.max(previewDelay, 1800) : previewDelay;

      metadataTimer.current = setTimeout(() => {
        setFocusedId((prev) => (prev === requestedId ? prev : requestedId));
        schedulePreview(requestedId, delay, !!channel.url);
      }, 180);
    },
    [previewDelay, schedulePreview],
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
    // Scroll/filter reset only — never reclaim grid preferred focus (keeps chip focused).
    setResetToken((value) => value + 1);
    // Re-assert focus on the chip the user pressed after the list swaps.
    requestAnimationFrame(() => {
      const chip = groupChipRefs.current.get(next);
      if (chip) requestNativeFocus(chip);
    });
  }, []);

  const onFocusedGuideRow = useCallback((_index: number) => {
    // Intentionally no-op for trapFocus toggling — flipping traps mid-surf freezes Fire TV focus.
  }, []);

  const onGuideUpBoundary = useCallback(() => {
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
            {/* No autoFocus / trapFocusUp — preferred focus is mount-once on row 0, and Up-escape
                is gated inside the grid. Flipping traps mid-surf freezes Fire TV focus. */}
            <FocusGuide style={styles.gridPanel} trapFocusDown trapFocusRight>
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
                  reminderKeys={gridReminderKeys}
                  resetToken={resetToken}
                  active={!activeProgram}
                  onUpBoundary={onGuideUpBoundary}
                  onFocusedRowChange={onFocusedGuideRow}
                  onGuideFocusNode={onGuideFocusNode}
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
                  onChannelLongPress={onChannelLongPress}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  density={guideDensity}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={channelLogos}
                  reminderKeys={gridReminderKeys}
                  resetToken={resetToken}
                  active={!activeProgram}
                  onUpBoundary={onGuideUpBoundary}
                  onFocusedRowChange={onFocusedGuideRow}
                  onGuideFocusNode={onGuideFocusNode}
                />
              )}
            </FocusGuide>

            <View style={[styles.detailsPanel, { width: detailsRailWidth }]}>
              <View style={styles.preview} pointerEvents="none">
                {previewVisible && previewChannel ? (
                  <ErrorBoundary fallback={() => null}>
                    <StreamPlayer
                      key={`purple-guide-preview-${previewChannel.id}-${previewEpoch}`}
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
                      name={previewChannel && favoriteSet.has(previewChannel.id) ? "heart" : "heart-outline"}
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
