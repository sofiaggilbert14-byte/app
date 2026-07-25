import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { Channel } from "@/src/api";
import { TimelineGrid } from "@/src/components/TimelineGrid";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, StreamStatus } from "@/src/components/StreamPlayer";
import { nowNext, progressPct, fmtTime } from "@/src/utils/time";
import dayjs from "dayjs";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type AppRoute = "/search" | "/favorites" | "/settings";

const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";
const GOLD_DEEP = "#7C4A11";
const PANEL = "rgba(18, 13, 8, 0.92)";
const PANEL_LIGHT = "rgba(43, 29, 17, 0.88)";
const BORDER_GOLD = "rgba(246, 183, 60, 0.34)";
const BASE_CATEGORIES = ["All", "Movies", "TV", "Sports", "Kids", "News", "Favorites"];

function byChannelName(a: Channel, b: Channel): number {
  return (a.name || "").localeCompare(b.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function categoryMatches(channel: Channel, category: string): boolean {
  const haystack = `${channel.group || ""} ${channel.name || ""}`.toLowerCase();
  switch (category) {
    case "Movies":
      return /movie|movies|cinema|film|films|vod/.test(haystack);
    case "TV":
      return /tv|entertainment|series|general|local/.test(haystack);
    case "Sports":
      return /sport|sports|nfl|nba|mlb|nhl|ufc|espn|arena/.test(haystack);
    case "Kids":
      return /kid|kids|family|cartoon|nick|disney/.test(haystack);
    case "News":
      return /news|weather|cnn|fox|msnbc|cnbc|bbc/.test(haystack);
    default:
      return channel.group === category;
  }
}

function CommandButton({
  icon,
  label,
  onPress,
  preferred,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  preferred?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      style={({ focused }: any) => [styles.commandBtn, focused && styles.goldFocus]}
      testID={testID}
    >
      <Ionicons name={icon} size={18} color={GOLD_SOFT} />
      <Text numberOfLines={1} style={styles.commandText}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function GuideScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const {
    channels,
    windowStart,
    windowEnd,
    loading,
    refreshing,
    error,
    refresh,
    hardRefresh,
    addRecent,
    openProgram,
    favorites,
    lastChannelId,
  } = useStore();
  const now = new Date().toISOString();
  const shortScreen = height < 760;

  const [category, setCategory] = useState<string>("All");
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");

  const categories = useMemo(() => {
    const known = new Set(BASE_CATEGORIES);
    const extras = Array.from(new Set(channels.map((c) => c.group).filter(Boolean) as string[]))
      .filter((g) => !known.has(g))
      .slice(0, 10);
    return [...BASE_CATEGORIES, ...extras];
  }, [channels]);

  const filtered = useMemo(() => {
    const list =
      category === "All"
        ? channels
        : category === "Favorites"
          ? channels.filter((c: Channel) => favorites.includes(c.id))
          : channels.filter((c: Channel) => categoryMatches(c, category));
    return [...list].sort(byChannelName);
  }, [channels, category, favorites]);

  const previewChannel = useMemo(() => {
    const focused = focusedChannelId ? filtered.find((c) => c.id === focusedChannelId) : null;
    if (focused) return focused;
    const last = lastChannelId ? filtered.find((c) => c.id === lastChannelId) : null;
    return last || filtered.find((c) => c.programs?.length) || filtered[0] || null;
  }, [filtered, focusedChannelId, lastChannelId]);

  const preview = useMemo(
    () => (previewChannel ? nowNext(previewChannel.programs, new Date(now)) : {}),
    [previewChannel, now],
  );
  const previewProgress = progressPct(preview.current, new Date(now));

  useEffect(() => {
    setPreviewStatus("loading");
  }, [previewChannel?.id]);

  const openChannel = (c: Channel) => {
    void Haptics.selectionAsync().catch(() => {});
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };

  const openLastChannel = () => {
    const last = lastChannelId ? channels.find((c) => c.id === lastChannelId) : null;
    if (last) openChannel(last);
  };

  const openAdjacentChannel = (offset: number) => {
    if (!filtered.length) return;
    const currentIndex = previewChannel ? filtered.findIndex((c) => c.id === previewChannel.id) : 0;
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const target = filtered[(safeIndex + offset + filtered.length) % filtered.length];
    if (target) openChannel(target);
  };

  const navTo = (route: AppRoute) => {
    router.push(route as any);
  };

  const stopPreview = () => {
    void Haptics.selectionAsync().catch(() => {});
    setFocusedChannelId(null);
  };

  return (
    <LinearGradient
      colors={["#050403", "#120B05", "#050403"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <View style={[styles.screen, { paddingTop: insets.top + (shortScreen ? spacing.xs : spacing.sm) }]}>
        <View style={styles.topBrand}>
          <View style={styles.brandRow}>
            <Ionicons name="flame" size={26} color={GOLD} />
            <Text style={styles.brandText}>
              Charm<Text style={styles.brandGold}>IPTV</Text> Phoenix
            </Text>
          </View>
          <Text style={styles.clock}>{dayjs().format("ddd, MMM D, h:mm A")}</Text>
        </View>

        <View style={[styles.previewDetailsRow, shortScreen && styles.previewDetailsRowShort]}>
          <Pressable
            style={({ focused }: any) => [styles.livePreviewPanel, focused && styles.goldFocus]}
            onPress={() => previewChannel && openChannel(previewChannel)}
            testID="guide-preview-card"
          >
            <LinearGradient
              colors={["rgba(246,183,60,0.22)", "rgba(68,39,12,0.78)", "rgba(0,0,0,0.94)"]}
              style={StyleSheet.absoluteFill}
            />
            {previewChannel?.url && previewStatus !== "error" && (
              <ErrorBoundary fallback={() => null}>
                <StreamPlayer
                  key={`guide-preview-${previewChannel.id}`}
                  uri={previewChannel.url}
                  onStatus={setPreviewStatus}
                  style={StyleSheet.absoluteFill}
                />
              </ErrorBoundary>
            )}
            <LinearGradient
              colors={["rgba(0,0,0,0.18)", "rgba(0,0,0,0.70)"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.previewLabel}>
              <Text style={styles.previewLabelText}>LIVE ACTIVE PREVIEW</Text>
            </View>
            <View style={[styles.previewCenter, previewChannel?.url && previewStatus !== "error" && styles.previewCenterOverlay]}>
              {previewChannel ? (
                <ChannelLogo name={previewChannel.name} logo={previewChannel.logo} size={shortScreen ? 46 : 58} />
              ) : (
                <Ionicons name="tv-outline" size={shortScreen ? 44 : 56} color={GOLD_SOFT} />
              )}
              <Text numberOfLines={1} style={styles.previewChannelName}>
                {previewChannel?.name || "Select a channel"}
              </Text>
            </View>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          </Pressable>

          <View style={styles.detailsPanel}>
            <View style={styles.detailsHeader}>
              <Text style={styles.detailsLabel}>NOW PLAYING DETAILS</Text>
              {favorites.includes(previewChannel?.id || "") && <Ionicons name="star" size={20} color={GOLD} />}
            </View>
            <Text numberOfLines={1} style={styles.programTitle}>
              {preview.current?.title || "No program information"}
            </Text>
            <View style={styles.programMetaRow}>
              <Text style={styles.programMeta}>
                {preview.current ? `${fmtTime(preview.current.start)} - ${preview.current.stop ? fmtTime(preview.current.stop) : "Later"}` : "Guide still loading"}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${previewProgress}%` }]} />
              </View>
              <Text style={styles.programMeta}>{preview.current?.stop ? `${Math.max(0, dayjs(preview.current.stop).diff(dayjs(), "minute"))} min left` : ""}</Text>
            </View>
            <Text style={styles.descriptionLabel}>PROGRAM DESCRIPTION</Text>
            <Text numberOfLines={shortScreen ? 2 : 3} style={styles.description}>
              {preview.current?.desc ||
                "Highlight a program in the guide to see its title, time, and description here. Press OK to watch the highlighted channel."}
            </Text>
          </View>
        </View>

        <View style={styles.controlsWrap}>
          <Text style={styles.stripLabel}>QUICK CONTROL BUTTONS</Text>
          <View style={styles.commandControls}>
            <CommandButton icon="settings-outline" label="Settings" onPress={() => navTo("/settings")} testID="cmd-settings-btn" />
            <CommandButton icon="play-back" label="Previous" onPress={() => openAdjacentChannel(-1)} testID="cmd-prev-btn" />
            <CommandButton icon="stop" label="Stop" onPress={stopPreview} testID="cmd-stop-btn" />
            <CommandButton icon="return-up-back" label="Last" onPress={openLastChannel} testID="cmd-last-btn" />
            <CommandButton icon="play-forward" label="Next" onPress={() => openAdjacentChannel(1)} testID="cmd-next-btn" />
            <CommandButton icon="search" label="Search" onPress={() => navTo("/search")} testID="cmd-search-btn" />
            <CommandButton icon="refresh" label="Guide Refresh" onPress={hardRefresh} testID="cmd-guide-refresh-btn" />
          </View>
        </View>

        <View style={styles.categoryWrap}>
          <Text style={styles.stripLabel}>CATEGORY TABS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {categories.map((g) => (
              <Pressable
                key={g}
                onPress={() => {
                  setCategory(g);
                  setFocusedChannelId(null);
                }}
                style={({ focused }: any) => [styles.categoryChip, category === g && styles.categoryChipActive, focused && styles.goldFocus]}
                testID={`chip-${g}`}
              >
                <Text style={[styles.categoryText, category === g && styles.categoryTextActive]}>{g}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <EpgProgressBar />

        {loading && channels.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={GOLD} size="large" />
            <Text style={styles.centerText}>Loading channels & guide...</Text>
          </View>
        ) : error && channels.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={42} color={GOLD_SOFT} />
            <Text style={styles.centerText}>{error}</Text>
            <Pressable style={({ focused }: any) => [styles.retryBtn, focused && styles.goldFocus]} onPress={() => refresh()} testID="guide-retry-btn">
              <Text style={styles.retryText}>Reload Guide</Text>
            </Pressable>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="tv-outline" size={42} color={GOLD_SOFT} />
            <Text style={styles.centerText}>No channels here yet</Text>
          </View>
        ) : (
          <FocusGuide style={styles.timelineArea} autoFocus>
            <Text style={styles.timelineTitle}>FULL GUIDE TIMELINE</Text>
            <TimelineGrid
              channels={filtered}
              windowStart={windowStart}
              windowEnd={windowEnd}
              now={now}
              onChannelPress={openChannel}
              onProgramPress={openProgram}
              onChannelFocus={(c) => setFocusedChannelId(c.id)}
              refreshing={refreshing}
              onRefresh={hardRefresh}
            />
          </FocusGuide>
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs, gap: 4 },
  topBrand: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(246,183,60,0.25)",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandText: { color: "#fff", fontFamily: fonts.bold, fontSize: 18 },
  brandGold: { color: GOLD },
  clock: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.medium, fontSize: 12 },
  previewDetailsRow: { flexDirection: "row", gap: spacing.sm, height: 150 },
  previewDetailsRowShort: { height: 126 },
  livePreviewPanel: {
    flex: 0.82,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    backgroundColor: PANEL,
    overflow: "hidden",
    padding: spacing.sm,
  },
  previewLabel: {
    alignSelf: "center",
    backgroundColor: "rgba(246,183,60,0.16)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  previewLabelText: { color: GOLD_SOFT, fontFamily: fonts.bold, fontSize: 11 },
  previewCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  previewCenterOverlay: { alignItems: "flex-start", justifyContent: "flex-end" },
  previewChannelName: { color: "#fff", fontFamily: fonts.bold, fontSize: 13, textAlign: "center" },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.error },
  liveBadgeText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  detailsPanel: {
    flex: 1.16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    backgroundColor: PANEL,
    padding: spacing.sm,
    gap: 3,
  },
  detailsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailsLabel: { color: GOLD, fontFamily: fonts.bold, fontSize: 12 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 20 },
  programMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  programMeta: { color: GOLD_SOFT, fontFamily: fonts.medium, fontSize: 11 },
  progressTrack: {
    width: 90,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.20)",
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: GOLD },
  descriptionLabel: { color: GOLD, fontFamily: fonts.semibold, fontSize: 10, marginTop: 1 },
  description: { color: "rgba(255,255,255,0.84)", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  controlsWrap: {
    minHeight: 42,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(246,183,60,0.20)",
  },
  stripLabel: { color: GOLD, fontFamily: fonts.semibold, fontSize: 10, textAlign: "center", marginBottom: 1 },
  commandControls: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  commandBtn: {
    flex: 1,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: PANEL_LIGHT,
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.18)",
    paddingHorizontal: spacing.xs,
  },
  commandText: { color: "rgba(255,255,255,0.90)", fontFamily: fonts.semibold, fontSize: 10 },
  categoryWrap: { minHeight: 44 },
  categoryRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  categoryChip: {
    minWidth: 96,
    height: 30,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  categoryChipActive: { backgroundColor: "rgba(246,183,60,0.24)", borderColor: GOLD },
  categoryText: { color: "rgba(255,255,255,0.68)", fontFamily: fonts.medium, fontSize: 11 },
  categoryTextActive: { color: GOLD_SOFT, fontFamily: fonts.bold },
  timelineArea: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(246,183,60,0.22)",
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  timelineTitle: {
    color: GOLD,
    fontFamily: fonts.bold,
    fontSize: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: "rgba(0,0,0,0.34)",
  },
  goldFocus: {
    borderColor: GOLD_SOFT,
    borderWidth: 2,
    shadowColor: GOLD,
    shadowOpacity: 0.65,
    shadowRadius: 14,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  centerText: { color: "rgba(255,255,255,0.74)", fontFamily: fonts.medium, fontSize: 14, textAlign: "center" },
  retryBtn: {
    backgroundColor: GOLD_DEEP,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
  },
  retryText: { color: "#fff", fontFamily: fonts.semibold },
});
