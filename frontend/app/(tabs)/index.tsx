import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  BackHandler,
  Animated,
  Easing,
  ScrollView,
  useTVEventHandler,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
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
import {
  GUIDE_RAIL_WIDTH,
  GuideGroupsDrawer,
  guideGroupsWidth,
} from "@/src/components/GuideGroupsDrawer";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, StreamStatus } from "@/src/components/StreamPlayer";
import { nowNext, progressPct, fmtTime } from "@/src/utils/time";
import { getTvSafeInsets } from "@/src/utils/tvLayout";
import { formatChannelLabel } from "@/src/utils/channelLabel";
import { loadNativeChannelPrograms, nativeEpgAvailable } from "@/src/nativeEpg";
import dayjs from "dayjs";

type MenuRoute = "/" | "/favorites" | "/search" | "/settings";
type GuideDrawerMode = "groups" | "rail";

const GOLD = "#E3262E";
const GOLD_SOFT = "#FFFFFF";
const GOLD_DEEP = "#8E1118";
const PANEL = "rgba(18, 22, 27, 0.94)";
const BORDER_GOLD = "rgba(227, 38, 46, 0.42)";
const BASE_CATEGORIES = ["All", "Favorites", "Recently Watched", "Movies", "TV", "Sports", "News", "Kids", "Music", "24/7"];
const GUIDE_PREVIEW_FOCUS_DELAY_MS = 900;
const GUIDE_METADATA_SETTLE_MS = 240;
const DESCRIPTION_SCROLL_PASSES = 3;

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
    const scrollDuration = Math.max(6500, overflow * 105);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1000),
        Animated.timing(translateY, {
          toValue: -overflow,
          duration: scrollDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(900),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
      { iterations: DESCRIPTION_SCROLL_PASSES },
    );

    loop.start(({ finished }) => {
      if (finished) translateY.setValue(0);
    });
    return () => {
      loop.stop();
      translateY.stopAnimation();
      translateY.setValue(0);
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
  const isFocused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const tvSafe = getTvSafeInsets(width, height);
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
    toggleFavorite,
    guideLayout,
    setGuideLayout,
    guideDensity,
    safePreviewMode,
    channelNumbers,
    channelLogos,
    deviceLayoutMode,
    reminders,
  } = useStore();
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const reminderKeys = useMemo(
    () => new Set(reminders.map((reminder) => reminder.key)),
    [reminders],
  );
  const [now, setNow] = useState(() => new Date().toISOString());
  const shortScreen = height < 760;
  const mobileSafeGuide =
    deviceLayoutMode === "mobile" || (deviceLayoutMode === "auto" && Platform.OS !== "web" && !Platform.isTV);
  const compactGuide = guideLayout === "compact";
  const livePreviewEnabled = safePreviewMode !== "off";
  // Delayed mode waits longer on weak devices so D-pad scanning stays smooth.
  const previewDelayMs = safePreviewMode === "delayed" ? 1500 : GUIDE_PREVIEW_FOCUS_DELAY_MS;
  // Keep the heavy guide mounted only while this tab is focused. Leaving it
  // live under Settings caused freezes when guide hours / preview prefs changed.
  const guideContentActive = isFocused || mobileSafeGuide;

  const [category, setCategory] = useState<string>("All");
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(null);
  const [previewStreamChannelId, setPreviewStreamChannelId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [drawerMode, setDrawerMode] = useState<GuideDrawerMode | null>(() => mobileSafeGuide ? null : "groups");
  const [guideResetToken, setGuideResetToken] = useState(0);
  const [enrichedDesc, setEnrichedDesc] = useState("");
  const wasFocusedRef = useRef(isFocused);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const previewFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewMetadataTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDrawerNavAt = useRef(0);
  const drawerGuideInset = mobileSafeGuide
    ? 0
    : drawerMode === "groups"
      ? guideGroupsWidth(width)
      : drawerMode === "rail"
        ? GUIDE_RAIL_WIDTH
        : 0;

  const sortedChannels = useMemo(() => [...channels].sort(byChannelName), [channels]);

  const categories = useMemo(() => {
    const known = new Set(BASE_CATEGORIES);
    const extras = Array.from(new Set(channels.map((c) => c.group).filter(Boolean) as string[]))
      .filter((g) => !known.has(g))
      .slice(0, 10);
    const allCategories = [...BASE_CATEGORIES, ...extras];
    return allCategories.filter((g) => {
      if (g === "All") return true;
      if (g === "Favorites") return favoriteSet.size > 0;
      if (g === "Recently Watched") return recent.length > 0;
      return channels.some((c) => categoryMatches(c, g));
    });
  }, [channels, favoriteSet, recent.length]);

  const filtered = useMemo(() => {
    if (category === "All") return sortedChannels;
    if (category === "Favorites") {
      return sortedChannels.filter((c: Channel) => favoriteSet.has(c.id));
    }
    if (category === "Recently Watched") {
      const liveById = new Map(channels.map((c) => [c.id, c]));
      return recent.map((c) => liveById.get(c.id) || c).filter(Boolean) as Channel[];
    }
    return sortedChannels.filter((c: Channel) => categoryMatches(c, category));
  }, [channels, category, favoriteSet, recent, sortedChannels]);

  const channelNumberById = useMemo(() => {
    const map: Record<string, number> = {};
    sortedChannels.forEach((channel, index) => {
      map[channel.id] = index + 1;
    });
    return map;
  }, [sortedChannels]);

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
    enrichedDesc ||
    "Highlight a program in the guide to see its title, time, and description here. Press OK to watch the highlighted channel.";
  const descriptionKey = `${previewChannel?.id || "none"}:${preview.current?.start || ""}:${preview.current?.title || ""}`;
  const previewLabelText =
    safePreviewMode === "off"
      ? "PREVIEW OFF"
      : safePreviewMode === "delayed"
        ? "DELAYED PREVIEW"
        : "LIVE ACTIVE PREVIEW";
  const previewChannelLabel = previewChannel
    ? formatChannelLabel(previewChannel.name, {
        number: channelNumberById[previewChannel.id],
        showNumber: channelNumbers,
      })
    : "";
  const previewPlayerVisible =
    livePreviewEnabled &&
    !!previewChannel?.url &&
    previewStreamChannelId === previewChannel.id &&
    previewStatus !== "error";

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(category)) {
      setCategory("All");
      setFocusedChannelId(null);
      setPreviewStreamChannelId(null);
    }
  }, [categories, category]);

  useEffect(
    () => () => {
      if (previewFocusTimer.current) clearTimeout(previewFocusTimer.current);
      if (previewMetadataTimer.current) clearTimeout(previewMetadataTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (mobileSafeGuide && drawerMode !== null) setDrawerMode(null);
  }, [drawerMode, mobileSafeGuide]);

  useEffect(() => {
    setPreviewStatus("loading");
  }, [previewChannel?.id]);

  useEffect(() => {
    setEnrichedDesc("");
  }, [previewChannel?.id]);

  // Bulk guide loads omit descriptions; hydrate the focused preview on demand.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = preview.current;
      if (!previewChannel || !current || current.desc || !nativeEpgAvailable) return;
      const startMs = Date.parse(windowStart);
      const endMs = Date.parse(windowEnd);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
      try {
        const channelKey = previewChannel.tvg_id || previewChannel.id;
        const programs = await loadNativeChannelPrograms(channelKey, startMs, endMs);
        if (cancelled) return;
        const match = programs.find(
          (p) => p.start === current.start || p.title === current.title,
        );
        if (match?.desc) setEnrichedDesc(match.desc);
      } catch (e) {
        console.warn("[Guide] description enrich failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewChannel, preview, windowStart, windowEnd]);

  useEffect(() => {
    if (previewFocusTimer.current) clearTimeout(previewFocusTimer.current);
    if (!livePreviewEnabled || !previewChannel?.id || !previewChannel.url) {
      setPreviewStreamChannelId(null);
      return;
    }

    const channelId = previewChannel.id;
    setPreviewStatus("loading");
    previewFocusTimer.current = setTimeout(() => {
      setPreviewStreamChannelId(channelId);
    }, previewDelayMs);

    return () => {
      if (previewFocusTimer.current) clearTimeout(previewFocusTimer.current);
    };
  }, [livePreviewEnabled, previewChannel?.id, previewChannel?.url, previewDelayMs]);

  useTVEventHandler(
    React.useCallback(
      (event) => {
        const eventType = event?.eventType;
        if (mobileSafeGuide || (eventType !== "left" && eventType !== "right")) return;

        const nowMs = Date.now();
        if (nowMs - lastDrawerNavAt.current < 320) return;

        if (eventType === "left") {
          if (drawerMode === "groups") {
            lastDrawerNavAt.current = nowMs;
            setDrawerMode("rail");
            void Haptics.selectionAsync().catch(() => {});
          }
        } else if (drawerMode === "rail") {
          lastDrawerNavAt.current = nowMs;
          setDrawerMode("groups");
          void Haptics.selectionAsync().catch(() => {});
        }
      },
      [drawerMode, mobileSafeGuide],
    ),
  );

  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS === "web") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (mobileSafeGuide) return false;
        if (drawerMode === null) {
          setDrawerMode("groups");
        } else if (drawerMode === "groups") {
          setDrawerMode("rail");
        } else if (drawerMode === "rail") {
          setDrawerMode("groups");
        }
        void Haptics.selectionAsync().catch(() => {});
        return true;
      });
      return () => sub.remove();
    }, [drawerMode, mobileSafeGuide]),
  );

  // Returning from Settings/Search should land on the groups drawer with a
  // stable preferred-focus target, never the skinny rail or a focus-less guide.
  useEffect(() => {
    const becameFocused = isFocused && !wasFocusedRef.current;
    wasFocusedRef.current = isFocused;
    if (!becameFocused || mobileSafeGuide) return;
    if (drawerMode === "rail" || drawerMode === null) {
      setDrawerMode("groups");
      setGuideResetToken((value) => value + 1);
    }
  }, [drawerMode, isFocused, mobileSafeGuide]);

  const focusPreviewChannel = useCallback((c: Channel) => {
    // During a held D-pad scan, every new channel cancels this timer. Metadata,
    // description animation and decoder setup only update once the focus has
    // been stable long enough, so the virtualized guide remains the hot path.
    if (previewMetadataTimer.current) clearTimeout(previewMetadataTimer.current);
    if (previewFocusTimer.current) clearTimeout(previewFocusTimer.current);
    previewMetadataTimer.current = setTimeout(() => {
      setFocusedChannelId(c.id);
      setPreviewStatus("loading");
      if (safePreviewMode === "off") {
        setPreviewStreamChannelId(null);
        return;
      }
      previewFocusTimer.current = setTimeout(() => {
        setPreviewStreamChannelId(c.id);
      }, previewDelayMs);
    }, GUIDE_METADATA_SETTLE_MS);
  }, [previewDelayMs, safePreviewMode]);

  const openChannel = useCallback((c: Channel) => {
    void Haptics.selectionAsync().catch(() => {});
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  }, [addRecent, router]);

  const favoriteChannel = useCallback((c: Channel) => {
    void Haptics.selectionAsync().catch(() => {});
    toggleFavorite(c.id);
  }, [toggleFavorite]);

  const returnToGroups = useCallback(() => {
    setDrawerMode("groups");
    void Haptics.selectionAsync().catch(() => {});
  }, []);

  const goMenu = (route: MenuRoute) => {
    void Haptics.selectionAsync().catch(() => {});
    if (route === "/") {
      setCategory("All");
      setFocusedChannelId(null);
      setPreviewStreamChannelId(null);
      setGuideResetToken((value) => value + 1);
      setDrawerMode(null);
      return;
    }
    // Keep the groups drawer while visiting secondary tabs so Settings changes
    // do not remount the interactive timeline underneath and steal focus.
    if (!mobileSafeGuide) setDrawerMode("groups");
    router.push(route as any);
  };

  const exitApp = () => {
    void Haptics.selectionAsync().catch(() => {});
    if (!mobileSafeGuide) setDrawerMode("groups");
    if (Platform.OS !== "web") {
      BackHandler.exitApp();
    }
  };

  const openGroup = useCallback((nextCategory: string) => {
    setCategory(nextCategory);
    setFocusedChannelId(null);
    setPreviewStreamChannelId(null);
    setGuideResetToken((value) => value + 1);
    setDrawerMode(null);
  }, []);

  const renderGuideGrid = (interactive: boolean) => {
    if (compactGuide) {
      return (
        <View
          style={styles.timelineArea}
          pointerEvents={interactive ? "auto" : "none"}
          focusable={false}
          accessible={false}
        >
          <BoxGrid
            channels={filtered}
            now={now}
            onChannelPress={openChannel}
            onProgramPress={openProgram}
            onChannelFocus={interactive ? focusPreviewChannel : undefined}
            refreshing={refreshing}
            onRefresh={hardRefresh}
            density={guideDensity}
            showChannelNumbers={channelNumbers}
            channelNumberById={channelNumberById}
            showChannelLogos={channelLogos}
            favoriteIds={favoriteSet}
            reminderKeys={reminderKeys}
            onToggleFavorite={toggleFavorite}
            resetToken={interactive ? guideResetToken : 0}
          />
        </View>
      );
    }

    return (
      <FocusGuide style={styles.timelineArea} autoFocus={interactive}>
        <ErrorBoundary>
          <View pointerEvents={interactive ? "auto" : "none"} focusable={false} accessible={false} style={{ flex: 1 }}>
            <TimelineGrid
              channels={filtered}
              windowStart={windowStart}
              windowEnd={windowEnd}
              now={now}
              onChannelPress={openChannel}
              onProgramPress={openProgram}
              onChannelFocus={interactive ? focusPreviewChannel : undefined}
              onChannelLongPress={favoriteChannel}
              refreshing={refreshing}
              onRefresh={hardRefresh}
              density={guideDensity}
              showChannelNumbers={channelNumbers}
              channelNumberById={channelNumberById}
              showChannelLogos={channelLogos}
              favoriteIds={favoriteSet}
              reminderKeys={reminderKeys}
              resetToken={interactive ? guideResetToken : 0}
              active={interactive}
              onLeftBoundary={interactive ? returnToGroups : undefined}
            />
          </View>
        </ErrorBoundary>
      </FocusGuide>
    );
  };

  return (
    <LinearGradient
      colors={["#05070A", "#0B1015", "#05070A"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <View
        style={[
          styles.screen,
          {
            paddingTop: insets.top + tvSafe.top,
            paddingLeft: tvSafe.left + drawerGuideInset,
            paddingRight: tvSafe.right,
            paddingBottom: tvSafe.bottom,
          },
        ]}
      >
        {drawerMode !== null && (
          <View style={styles.drawerGuideHeader}>
            <View>
              <Text style={styles.drawerHeaderLabel}>CHANNEL GROUP</Text>
              <Text style={styles.drawerHeaderValue}>{category}</Text>
            </View>
            <View style={styles.headerSpacer} />
            <Text style={styles.drawerVersion}>RC1</Text>
            <Pressable
              onPress={hardRefresh}
              style={({ focused }: any) => [styles.headerIconButton, focused && styles.goldFocus]}
              testID="drawer-guide-refresh"
            >
              <Ionicons name="refresh" size={23} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setGuideLayout("cinematic")}
              style={({ focused }: any) => [
                styles.viewToggle,
                guideLayout === "cinematic" && styles.viewToggleActive,
                focused && styles.goldFocus,
              ]}
              testID="drawer-layout-list"
            >
              <Ionicons name="list" size={22} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setGuideLayout("compact")}
              style={({ focused }: any) => [
                styles.viewToggle,
                guideLayout === "compact" && styles.viewToggleActive,
                focused && styles.goldFocus,
              ]}
              testID="drawer-layout-grid"
            >
              <Ionicons name="grid" size={19} color="#fff" />
            </Pressable>
          </View>
        )}

        {mobileSafeGuide && drawerMode === null && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mobileGroupTabs}
            style={styles.mobileGroupTabsWrap}
            testID="mobile-group-tabs"
          >
            {categories.map((group) => {
              const activeGroup = group === category;
              return (
                <Pressable
                  key={group}
                  onPress={() => {
                    setCategory(group);
                    setFocusedChannelId(null);
                    setPreviewStreamChannelId(null);
                    setGuideResetToken((value) => value + 1);
                  }}
                  style={({ pressed }) => [
                    styles.mobileGroupTab,
                    activeGroup && styles.mobileGroupTabActive,
                    pressed && styles.mobileGroupTabPressed,
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.mobileGroupTabText, activeGroup && styles.mobileGroupTabTextActive]}>
                    {group === "Recently Watched" ? "Recent" : group}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => router.push("/settings")}
              accessibilityLabel="Settings"
              style={({ pressed }) => [styles.mobileSettingsTab, pressed && styles.mobileGroupTabPressed]}
              testID="mobile-settings-tab"
            >
              <Ionicons name="settings-outline" size={16} color="#fff" />
              <Text style={styles.mobileGroupTabTextActive}>Settings</Text>
            </Pressable>
          </ScrollView>
        )}

        {drawerMode !== null ? null : mobileSafeGuide ? (
          <View style={styles.mobileHero}>
            <View style={styles.mobileHeroText}>
              <Text style={styles.detailsLabel}>MOBILE SAFE GUIDE</Text>
              <Text numberOfLines={1} style={styles.mobileHeroTitle}>
                {preview.current?.title || previewChannel?.name || "CharmIPTV guide"}
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
            <View
              style={styles.livePreviewPanel}
              focusable={false}
              accessible={false}
              pointerEvents="none"
              testID="guide-preview-card"
            >
              <LinearGradient
                colors={["rgba(227,38,46,0.22)", "rgba(68,39,12,0.78)", "rgba(0,0,0,0.94)"]}
                style={StyleSheet.absoluteFill}
              />
              {previewPlayerVisible && (
                <ErrorBoundary
                  fallback={(reset) => (
                    <Pressable style={styles.previewCenter} onPress={reset} focusable={false}>
                      <Text style={styles.previewChannelName}>Preview unavailable — OK in Settings to retry</Text>
                    </Pressable>
                  )}
                >
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
                <Text style={styles.previewLabelText}>{previewLabelText}</Text>
              </View>
              <View style={[styles.previewCenter, previewPlayerVisible && styles.previewCenterOverlay]}>
                {previewChannel ? (
                  <ChannelLogo
                    name={previewChannel.name}
                    logo={previewChannel.logo}
                    disabled={!channelLogos}
                    size={compactGuide || shortScreen ? 32 : 44}
                  />
                ) : (
                  <Ionicons name="tv-outline" size={compactGuide || shortScreen ? 30 : 42} color={GOLD_SOFT} />
                )}
                <Text numberOfLines={1} style={styles.previewChannelName}>
                  {previewChannelLabel || "Select a channel"}
                </Text>
              </View>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            </View>

            <View style={styles.detailsPanel}>
              <View style={styles.detailsHeader}>
                <Text numberOfLines={1} style={styles.detailsLabel}>
                  {previewChannelLabel || "LIVE TV"}
                </Text>
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

        <EpgProgressBar />

        {!guideContentActive ? (
          <View style={styles.center} testID="guide-suspended">
            <Text style={styles.centerText}>Guide paused</Text>
          </View>
        ) : loading && channels.length === 0 ? (
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
            density={guideDensity}
            showChannelNumbers={channelNumbers}
            channelNumberById={channelNumberById}
            showChannelLogos={channelLogos}
            favoriteIds={favoriteSet}
            reminderKeys={reminderKeys}
            onToggleFavorite={toggleFavorite}
            resetToken={guideResetToken}
          />
        ) : (
          // Keep the channel guide visible behind the groups drawer (purple-style
          // always-on guide), but only interactive once a group is chosen.
          renderGuideGrid(drawerMode === null)
        )}
      </View>

      {drawerMode && !mobileSafeGuide && (
        <GuideGroupsDrawer
          mode={drawerMode}
          groups={categories}
          selected={category}
          onClose={() => {
            setGuideResetToken((value) => value + 1);
            setDrawerMode(null);
          }}
          onSelect={openGroup}
          onNavigate={goMenu}
          onExit={exitApp}
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1, gap: 2 },
  headerIconButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    height: 40,
    justifyContent: "center",
    width: 44,
  },
  screenTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 22 },
  versionBadge: {
    backgroundColor: "#A80F17",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  versionBadgeText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6 },
  headerSpacer: { flex: 1 },
  drawerGuideHeader: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.12)",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: 8,
  },
  drawerHeaderLabel: { color: "rgba(255,255,255,0.68)", fontFamily: fonts.medium, fontSize: 10, letterSpacing: 0.8 },
  drawerHeaderValue: { color: "#fff", fontFamily: fonts.bold, fontSize: 14, marginTop: 1 },
  drawerVersion: { color: GOLD, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.5, marginRight: 7 },
  viewToggle: {
    alignItems: "center",
    backgroundColor: "#20242A",
    borderRadius: radius.sm,
    height: 30,
    justifyContent: "center",
    marginLeft: 2,
    width: 34,
  },
  viewToggleActive: { backgroundColor: GOLD },
  drawerGuideFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 36,
    gap: 6,
  },
  drawerGuideFooterCharm: { color: GOLD, fontFamily: fonts.bold, fontSize: 16 },
  drawerGuideFooterText: { color: "#fff", fontFamily: fonts.medium, fontSize: 16 },
  mobileHero: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: PANEL,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  mobileHeroText: { flex: 1, gap: 3 },
  mobileHeroTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 15 },
  mobileHeroActions: { gap: 4, width: 82 },
  mobileHeroButton: {
    minHeight: 31,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: GOLD_DEEP,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
  },
  mobileHeroButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10.5 },
  mobileGroupTabsWrap: { flexGrow: 0, maxHeight: 39, backgroundColor: "rgba(4,6,8,0.96)" },
  mobileGroupTabs: { alignItems: "center", gap: 5, paddingHorizontal: 6, paddingVertical: 4 },
  mobileGroupTab: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderRadius: radius.pill,
    justifyContent: "center",
    minHeight: 29,
    minWidth: 66,
    paddingHorizontal: 12,
  },
  mobileGroupTabActive: { backgroundColor: GOLD_DEEP },
  mobileGroupTabPressed: { opacity: 0.72 },
  mobileGroupTabText: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.medium, fontSize: 11 },
  mobileGroupTabTextActive: { color: "#fff", fontFamily: fonts.bold },
  mobileSettingsTab: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.09)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 29,
    paddingHorizontal: 12,
  },
  previewDetailsRow: { flexDirection: "row", gap: 8, height: 138, alignItems: "stretch" },
  previewDetailsRowCompact: { height: 104 },
  previewDetailsRowShort: { height: 116 },
  livePreviewPanel: {
    width: "32.25%",
    height: "100%",
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: PANEL,
    overflow: "hidden",
    padding: 4,
  },
  previewLabel: {
    alignSelf: "center",
    backgroundColor: "rgba(227,38,46,0.16)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  previewLabelText: { color: GOLD_SOFT, fontFamily: fonts.bold, fontSize: 10 },
  previewCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  previewCenterOverlay: { alignItems: "flex-start", justifyContent: "flex-end" },
  previewChannelName: { color: "#fff", fontFamily: fonts.bold, fontSize: 12, textAlign: "center" },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  liveBadgeText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  detailsPanel: {
    flex: 1,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: PANEL,
    padding: spacing.sm,
    gap: 2,
    overflow: "hidden",
  },
  detailsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailsLabel: { color: GOLD, fontFamily: fonts.bold, fontSize: 10 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
  programTitleCompact: { fontSize: 14 },
  programMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  programMeta: { color: GOLD_SOFT, fontFamily: fonts.medium, fontSize: 10 },
  progressTrack: {
    width: 80,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.20)",
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: GOLD },
  descriptionLabel: { color: GOLD, fontFamily: fonts.semibold, fontSize: 9, marginTop: 1 },
  descriptionViewport: {
    flex: 1,
    minHeight: 30,
    overflow: "hidden",
    borderRadius: radius.sm,
  },
  descriptionViewportCompact: { minHeight: 14 },
  description: { color: "rgba(255,255,255,0.84)", fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 14 },
  timelineArea: {
    flex: 1,
    borderRadius: 0,
    borderWidth: 0,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.32)",
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
