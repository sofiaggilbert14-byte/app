import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
  Platform,
  Animated,
  Easing,
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
import { BoxGrid } from "@/src/components/BoxGrid";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, StreamStatus } from "@/src/components/StreamPlayer";
import { nowNext, progressPct, fmtTime } from "@/src/utils/time";
import dayjs from "dayjs";

type MenuRoute = "/" | "/favorites" | "/search" | "/settings";

const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";
const GOLD_DEEP = "#7C4A11";
const PANEL = "rgba(18, 13, 8, 0.92)";
const BORDER_GOLD = "rgba(246, 183, 60, 0.34)";
const BASE_CATEGORIES = ["All", "Favorites", "Recently Watched", "Movies", "TV", "Sports", "News", "Kids", "Music", "24/7"];
const GUIDE_PREVIEW_FOCUS_DELAY_MS = 450;

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
    case "Music":
      return /music|mtv|vh1|audio|radio|hits/.test(haystack);
    case "24/7":
      return /24\/7|24-7|24 7|marathon|all day/.test(haystack);
    default:
      return channel.group === category;
  }
}

function AutoScrollDescription({
  text,
  activeKey,
  compact,
}: {
  text: string;
  activeKey: string;
  compact: boolean;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    translateY.stopAnimation();
    translateY.setValue(0);

    if (!viewportHeight || !contentHeight || contentHeight <= viewportHeight + 2) {
      return;
    }

    const overflow = contentHeight - viewportHeight;
    const scrollDuration = Math.max(6500, overflow * 95);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1500),
        Animated.timing(translateY, {
          toValue: -overflow,
          duration: scrollDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(1300),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => {
      loop.stop();
      translateY.stopAnimation();
    };
  }, [activeKey, contentHeight, translateY, viewportHeight]);

  return (
    <View
      style={[styles.descriptionViewport, compact && styles.descriptionViewportCompact]}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      <Animated.Text
        onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
        style={[styles.description, { transform: [{ translateY }] }]}
      >
        {text}
      </Animated.Text>
    </View>
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
    recent,
    lastChannelId,
    isFavorite,
    toggleFavorite,
    guideLayout,
    guideDensity,
    safePreviewMode,
    channelNumbers,
    channelLogos,
    deviceLayoutMode,
  } = useStore();
  const now = new Date().toISOString();
  const shortScreen = height < 760;
  const mobileSafeGuide =
    deviceLayoutMode === "mobile" || (deviceLayoutMode === "auto" && Platform.OS !== "web" && !Platform.isTV);
  const compactGuide = guideLayout === "compact";
  const livePreviewEnabled = safePreviewMode !== "off";
  const previewDelayMs = safePreviewMode === "delayed" ? 700 : GUIDE_PREVIEW_FOCUS_DELAY_MS;

  const [category, setCategory] = useState<string>("All");
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [menuOpen, setMenuOpen] = useState(false);
  const previewFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const categories = useMemo(() => {
    const known = new Set(BASE_CATEGORIES);
    const extras = Array.from(new Set(channels.map((c) => c.group).filter(Boolean) as string[]))
      .filter((g) => !known.has(g))
      .slice(0, 10);
    const allCategories = [...BASE_CATEGORIES, ...extras];
    return allCategories.filter((g) => {
      if (g === "All") return channels.length > 0;
      if (g === "Favorites") return favorites.length > 0;
      if (g === "Recently Watched") return recent.length > 0;
      return channels.some((c) => categoryMatches(c, g));
    });
  }, [channels, favorites.length, recent.length]);

  const filtered = useMemo(() => {
    const list =
      category === "All"
        ? channels
        : category === "Favorites"
          ? channels.filter((c: Channel) => favorites.includes(c.id))
          : category === "Recently Watched"
            ? recent.map((c) => channels.find((live) => live.id === c.id) || c).filter(Boolean)
          : channels.filter((c: Channel) => categoryMatches(c, category));
    return [...list].sort(byChannelName);
  }, [channels, category, favorites, recent]);

  const channelNumberById = useMemo(() => {
    const map: Record<string, number> = {};
    [...channels].sort(byChannelName).forEach((channel, index) => {
      map[channel.id] = index + 1;
    });
    return map;
  }, [channels]);

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
  const descriptionText =
    preview.current?.desc ||
    "Highlight a program in the guide to see its title, time, and description here. Press OK to watch the highlighted channel.";
  const descriptionKey = `${previewChannel?.id || "none"}:${preview.current?.start || ""}:${preview.current?.title || ""}`;

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(category)) {
      setCategory("All");
      setFocusedChannelId(null);
    }
  }, [categories, category]);

  useEffect(
    () => () => {
      if (previewFocusTimer.current) clearTimeout(previewFocusTimer.current);
    },
    [],
  );

  useEffect(() => {
    setPreviewStatus("loading");
  }, [previewChannel?.id]);

  const focusPreviewChannel = (c: Channel) => {
    if (previewFocusTimer.current) clearTimeout(previewFocusTimer.current);
    if (safePreviewMode === "off") {
      setFocusedChannelId(c.id);
      return;
    }
    previewFocusTimer.current = setTimeout(() => {
      setFocusedChannelId(c.id);
    }, previewDelayMs);
  };

  const openChannel = (c: Channel) => {
    void Haptics.selectionAsync().catch(() => {});
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };

  const goMenu = (route: MenuRoute) => {
    void Haptics.selectionAsync().catch(() => {});
    setMenuOpen(false);
    if (route === "/") {
      setCategory("All");
      setFocusedChannelId(null);
      return;
    }
    router.push(route as any);
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
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              setMenuOpen((v) => !v);
            }}
            style={({ focused }: any) => [styles.menuButton, focused && styles.goldFocus]}
            testID="home-menu-button"
          >
            <Ionicons name={menuOpen ? "chevron-up" : "menu"} size={20} color={GOLD_SOFT} />
            <Text style={styles.menuButtonText}>Menu</Text>
          </Pressable>

          <View pointerEvents="none" style={styles.brandRow}>
            <Ionicons name="flame" size={26} color={GOLD} />
            <Text style={styles.brandText}>
              Charm<Text style={styles.brandGold}>IPTV</Text> Phoenix
            </Text>
          </View>
          <Text style={styles.clock}>{dayjs().format("ddd, MMM D, h:mm A")}</Text>
          {menuOpen && (
            <View style={styles.menuDropdown}>
              <Pressable
                onPress={() => goMenu("/")}
                style={({ focused }: any) => [styles.menuItem, focused && styles.goldFocus]}
                testID="home-menu-guide"
              >
                <Ionicons name="grid" size={18} color={GOLD_SOFT} />
                <Text style={styles.menuItemText}>TV Guide</Text>
              </Pressable>
              <Pressable
                onPress={() => goMenu("/favorites")}
                style={({ focused }: any) => [styles.menuItem, focused && styles.goldFocus]}
                testID="home-menu-favorites"
              >
                <Ionicons name="star" size={18} color={GOLD_SOFT} />
                <Text style={styles.menuItemText}>Favorites</Text>
              </Pressable>
              <Pressable
                onPress={() => goMenu("/search")}
                style={({ focused }: any) => [styles.menuItem, focused && styles.goldFocus]}
                testID="home-menu-search"
              >
                <Ionicons name="search" size={18} color={GOLD_SOFT} />
                <Text style={styles.menuItemText}>Search</Text>
              </Pressable>
              <Pressable
                onPress={() => goMenu("/settings")}
                style={({ focused }: any) => [styles.menuItem, focused && styles.goldFocus]}
                testID="home-menu-settings"
              >
                <Ionicons name="settings" size={18} color={GOLD_SOFT} />
                <Text style={styles.menuItemText}>Settings</Text>
              </Pressable>
            </View>
          )}
        </View>

        {mobileSafeGuide ? (
          <View style={styles.mobileHero}>
            <View style={styles.mobileHeroText}>
              <Text style={styles.detailsLabel}>MOBILE SAFE GUIDE</Text>
              <Text numberOfLines={1} style={styles.mobileHeroTitle}>
                {preview.current?.title || previewChannel?.name || "Phoenix guide"}
              </Text>
              <Text numberOfLines={2} style={styles.description}>
                Cards are easier and safer on phones. Tap a channel card to play it; use the star to favorite it.
              </Text>
            </View>
            <View style={styles.mobileHeroActions}>
              <Pressable
                style={({ focused }: any) => [styles.mobileHeroButton, focused && styles.goldFocus]}
                onPress={() => previewChannel && openChannel(previewChannel)}
                testID="mobile-continue-btn"
              >
                <Ionicons name="play" size={16} color="#fff" />
                <Text style={styles.mobileHeroButtonText}>Play</Text>
              </Pressable>
              <Pressable
                style={({ focused }: any) => [styles.mobileHeroButton, focused && styles.goldFocus]}
                onPress={hardRefresh}
                testID="mobile-refresh-btn"
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.mobileHeroButtonText}>Refresh</Text>
              </Pressable>
            </View>
          </View>
        ) : (
        <View style={[styles.previewDetailsRow, compactGuide && styles.previewDetailsRowCompact, shortScreen && styles.previewDetailsRowShort]}>
          <Pressable
            style={({ focused }: any) => [styles.livePreviewPanel, focused && styles.goldFocus]}
            onPress={() => previewChannel && openChannel(previewChannel)}
            testID="guide-preview-card"
          >
            <LinearGradient
              colors={["rgba(246,183,60,0.22)", "rgba(68,39,12,0.78)", "rgba(0,0,0,0.94)"]}
              style={StyleSheet.absoluteFill}
            />
            {livePreviewEnabled && previewChannel?.url && previewStatus !== "error" && (
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
            <View style={[styles.previewCenter, livePreviewEnabled && previewChannel?.url && previewStatus !== "error" && styles.previewCenterOverlay]}>
              {previewChannel ? (
                <ChannelLogo name={previewChannel.name} logo={previewChannel.logo} disabled={!channelLogos} size={compactGuide || shortScreen ? 42 : 58} />
              ) : (
                <Ionicons name="tv-outline" size={compactGuide || shortScreen ? 40 : 56} color={GOLD_SOFT} />
              )}
              <Text numberOfLines={1} style={styles.previewChannelName}>
                {previewChannel
                  ? `${channelNumbers ? `${channelNumberById[previewChannel.id] || ""} · ` : ""}${previewChannel.name}`
                  : "Select a channel"}
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
              {previewChannel && (
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {});
                    toggleFavorite(previewChannel.id);
                  }}
                  style={({ focused }: any) => [styles.favoriteButton, focused && styles.goldFocus]}
                  testID="guide-preview-favorite-btn"
                >
                  <Ionicons name={isFavorite(previewChannel.id) ? "star" : "star-outline"} size={20} color={GOLD} />
                  <Text style={styles.favoriteButtonText}>{isFavorite(previewChannel.id) ? "Favorite" : "Add Favorite"}</Text>
                </Pressable>
              )}
            </View>
            <Text numberOfLines={1} style={[styles.programTitle, compactGuide && styles.programTitleCompact]}>
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
            <AutoScrollDescription text={descriptionText} activeKey={descriptionKey} compact={compactGuide || shortScreen} />
          </View>
        </View>
        )}

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
        ) : mobileSafeGuide ? (
          <BoxGrid
            channels={filtered}
            now={now}
            onChannelPress={openChannel}
            onProgramPress={openProgram}
            refreshing={refreshing}
            onRefresh={hardRefresh}
            showChannelNumbers={channelNumbers}
            channelNumberById={channelNumberById}
            showChannelLogos={channelLogos}
          />
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
              onChannelFocus={focusPreviewChannel}
              onChannelLongPress={(c) => {
                void Haptics.selectionAsync().catch(() => {});
                toggleFavorite(c.id);
              }}
              refreshing={refreshing}
              onRefresh={hardRefresh}
              density={guideDensity}
              showChannelNumbers={channelNumbers}
              channelNumberById={channelNumberById}
              showChannelLogos={channelLogos}
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
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(246,183,60,0.25)",
    zIndex: 30,
  },
  menuButton: {
    position: "absolute",
    left: 0,
    minWidth: 96,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.22)",
    backgroundColor: "rgba(28,18,10,0.82)",
  },
  menuButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  menuDropdown: {
    position: "absolute",
    top: 34,
    left: 0,
    width: 178,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    backgroundColor: "rgba(10,7,4,0.98)",
    padding: spacing.xs,
    gap: spacing.xs,
    zIndex: 40,
    shadowColor: GOLD,
    shadowOpacity: 0.28,
    shadowRadius: 14,
  },
  menuItem: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  menuItemText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandText: { color: "#fff", fontFamily: fonts.bold, fontSize: 18 },
  brandGold: { color: GOLD },
  clock: { position: "absolute", right: 0, color: "rgba(255,255,255,0.72)", fontFamily: fonts.medium, fontSize: 12 },
  mobileHero: {
    minHeight: 104,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    backgroundColor: PANEL,
    padding: spacing.sm,
  },
  mobileHeroText: { flex: 1, gap: 3 },
  mobileHeroTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 18 },
  mobileHeroActions: { gap: spacing.xs, width: 92 },
  mobileHeroButton: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: GOLD_DEEP,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
  },
  mobileHeroButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  previewDetailsRow: { flexDirection: "row", gap: spacing.sm, height: 225, alignItems: "stretch" },
  previewDetailsRowCompact: { height: 165 },
  previewDetailsRowShort: { height: 189 },
  livePreviewPanel: {
    height: "100%",
    aspectRatio: 16 / 9,
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
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    backgroundColor: PANEL,
    padding: spacing.sm,
    gap: 3,
  },
  detailsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailsLabel: { color: GOLD, fontFamily: fonts.bold, fontSize: 12 },
  favoriteButton: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.20)",
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  favoriteButtonText: { color: GOLD_SOFT, fontFamily: fonts.semibold, fontSize: 11 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 20 },
  programTitleCompact: { fontSize: 16 },
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
  descriptionViewport: { flex: 1, minHeight: 42, overflow: "hidden" },
  descriptionViewportCompact: { minHeight: 18 },
  description: { color: "rgba(255,255,255,0.84)", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  stripLabel: { color: GOLD, fontFamily: fonts.semibold, fontSize: 10, textAlign: "center", marginBottom: 1 },
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
