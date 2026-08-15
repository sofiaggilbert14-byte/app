import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { combineTvEdgeInsets, getTvSafeInsets } from "@/src/utils/tvLayout";
import { reclaimGuideBottomFocusIfArmed } from "@/src/utils/tvGuideFocusLock";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { useStore } from "@/src/store";
import { evaluateDrawerBack } from "@/src/core/drawerNavigationPolicy";
import { isGuideSurfing } from "@/src/utils/guideSurfGate";
import { useTvCalibration } from "@/src/tvCalibration";

type Route =
  | "/"
  | "/guide"
  | "/channels"
  | "/movies"
  | "/series"
  | "/catchup"
  | "/favorites"
  | "/reminders"
  | "/search"
  | "/settings";

type NavItem = {
  route: Route;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

type FooterAction = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
};

export type PurpleContextAction = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  testID?: string;
};

export type PurpleGuideGroup = {
  name: string;
  count?: number;
  active?: boolean;
  pinned?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

export type PurpleRecentChannel = {
  id: string;
  name: string;
  logo?: string | null;
};

/** Drawer nav items — My Reminders sits directly under Favorites. */
const NAV: NavItem[] = [
  { route: "/", label: "Live TV", icon: "tv-outline" },
  { route: "/guide", label: "TV Guide", icon: "calendar-outline" },
  { route: "/favorites", label: "Favorites", icon: "heart-outline" },
  { route: "/reminders", label: "My Reminders", icon: "notifications-outline" },
  { route: "/channels", label: "Channels", icon: "list-outline" },
  { route: "/movies", label: "Movies", icon: "film-outline" },
  { route: "/series", label: "Series", icon: "albums-outline" },
  { route: "/catchup", label: "Catch Up", icon: "time-outline" },
  { route: "/search", label: "Search", icon: "search-outline" },
  { route: "/settings", label: "Settings", icon: "settings-outline" },
];

export const PURPLE_SIDEBAR_WIDTH = 156;
export const PURPLE_DRAWER_ANIMATION_MS = 180;

export type OpenDrawerOptions = {
  /** Focus the first drawer row (Live TV) instead of the active route. */
  focusTop?: boolean;
};

type DrawerContextValue = {
  drawerOpen: boolean;
  drawerProgress: Animated.Value;
  openDrawer: (options?: OpenDrawerOptions) => void;
  closeDrawer: () => void;
  /** True when the next drawer-open focus pass should land on the top row. */
  focusDrawerTop: boolean;
  consumeFocusDrawerTop: () => void;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function PurpleTvDrawerProvider({ children }: { children: React.ReactNode }) {
  // Always boot closed — content is full-bleed; Guide can open the drawer with one Back.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusDrawerTop, setFocusDrawerTop] = useState(false);
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const openDrawer = useCallback((options?: OpenDrawerOptions) => {
    // Rapid D-pad surf must never yank the sidebar open under the guide.
    if (isGuideSurfing()) return;
    setFocusDrawerTop(!!options?.focusTop);
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => {
    setFocusDrawerTop(false);
    setDrawerOpen(false);
  }, []);
  const consumeFocusDrawerTop = useCallback(() => setFocusDrawerTop(false), []);
  useEffect(() => {
    const animation = Animated.timing(drawerProgress, {
      toValue: drawerOpen ? 1 : 0,
      duration: PURPLE_DRAWER_ANIMATION_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [drawerOpen, drawerProgress]);
  const value = useMemo(
    () => ({
      drawerOpen,
      drawerProgress,
      openDrawer,
      closeDrawer,
      focusDrawerTop,
      consumeFocusDrawerTop,
    }),
    [closeDrawer, consumeFocusDrawerTop, drawerOpen, drawerProgress, focusDrawerTop, openDrawer],
  );
  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function usePurpleTvDrawer(): DrawerContextValue {
  const value = useContext(DrawerContext);
  if (!value) throw new Error("usePurpleTvDrawer must be used inside PurpleTvDrawerProvider");
  return value;
}

function SmallBrand() {
  return (
    <View style={styles.brand} pointerEvents="none">
      <View style={styles.brandMark}>
        <Ionicons name="sparkles" size={13} color={tvColors.purpleSoft} />
      </View>
      <View>
        <Text style={styles.brandTop}>CHARM</Text>
        <Text style={styles.brandBottom}>IPTV</Text>
      </View>
    </View>
  );
}

function WatchingDot({ testID }: { testID?: string }) {
  return <View style={styles.watchingDot} testID={testID} />;
}

function RecentLetterAvatar({ name }: { name: string }) {
  const letter = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <View style={styles.recentAvatar}>
      <Text style={styles.recentAvatarText}>{letter}</Text>
    </View>
  );
}

export function PurpleTvShell({
  active,
  children,
  headerRight,
  contentStyle,
  footerAction,
  contextActions,
  guideGroups,
  watchingChannelId,
  recentChannels,
  onRecentPress,
}: {
  active: Route;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  contentStyle?: any;
  footerAction?: FooterAction;
  contextActions?: PurpleContextAction[];
  guideGroups?: PurpleGuideGroup[];
  watchingChannelId?: string | null;
  recentChannels?: PurpleRecentChannel[];
  onRecentPress?: (channelId: string) => void;
}) {
  const router = useRouter();
  const {
    drawerOpen,
    drawerProgress,
    openDrawer,
    closeDrawer,
    focusDrawerTop,
    consumeFocusDrawerTop,
  } = usePurpleTvDrawer();
  const { width, height } = useWindowDimensions();
  const { deviceLayoutMode, activeProgram } = useStore();
  const { calibration } = useTvCalibration();
  const edges = useMemo(() => {
    const safe = getTvSafeInsets(width, height, deviceLayoutMode);
    return combineTvEdgeInsets(safe, calibration);
  }, [calibration, deviceLayoutMode, height, width]);
  const navRefs = useRef(new Map<Route, unknown>());
  const guideGroupRefs = useRef(new Map<string, unknown>());
  const isWatching = !!watchingChannelId;
  const recentStrip = useMemo(
    () => (recentChannels ?? []).slice(0, 5),
    [recentChannels],
  );
  // Drawer boots closed — pulse content autoFocus once so guide/home can claim first focus.
  const [contentAutoFocus, setContentAutoFocus] = useState(() => !drawerOpen);
  const [drawerAutoFocus, setDrawerAutoFocus] = useState(drawerOpen);
  const [drawerPreferredRoute, setDrawerPreferredRoute] = useState<Route | null>(
    drawerOpen ? active : null,
  );
  useEffect(() => {
    if (!contentAutoFocus) return;
    const timer = setTimeout(() => setContentAutoFocus(false), 700);
    return () => clearTimeout(timer);
  }, [contentAutoFocus]);

  useEffect(() => {
    if (!drawerOpen) {
      setDrawerAutoFocus(false);
      setDrawerPreferredRoute(null);
      // Guide owns post-drawer reclaim via its nonce and mounted grid. A second
      // Shell retry with no channel id races that path and yanks the wrong row.
      if (active !== "/guide") {
        setContentAutoFocus(true);
      }
      return;
    }

    setContentAutoFocus(false);
    const preferredGuideGroup =
      !focusDrawerTop && active === "/guide" ? guideGroups?.find((item) => item.active) : undefined;
    const preferredRoute: Route | null = preferredGuideGroup
      ? null
      : focusDrawerTop
        ? NAV[0].route
        : active;
    if (focusDrawerTop) consumeFocusDrawerTop();
    setDrawerPreferredRoute(preferredRoute);
    setDrawerAutoFocus(true);
    const clearPreferred = setTimeout(() => {
      setDrawerAutoFocus(false);
      setDrawerPreferredRoute(null);
    }, 700);
    const preferredNode = preferredGuideGroup
      ? guideGroupRefs.current.get(preferredGuideGroup.name)
      : preferredRoute
        ? navRefs.current.get(preferredRoute)
        : null;
    const cancelFocus = requestNativeFocusWithRetry(
      preferredNode,
      [0, PURPLE_DRAWER_ANIMATION_MS, 280, 420, 650],
    );
    return () => {
      clearTimeout(clearPreferred);
      cancelFocus?.();
    };
  }, [active, activeProgram, consumeFocusDrawerTop, drawerOpen, focusDrawerTop, guideGroups]);

  const reopenArmedAtRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        // Guide owns a TiViMate-style single-Back drawer transition. Keep the
        // generic double-Back policy for other full-bleed tabs only.
        if (active === "/guide" && !drawerOpen && !activeProgram) {
          reopenArmedAtRef.current = 0;
          openDrawer();
          return true;
        }
        const decision = evaluateDrawerBack({
          drawerOpen,
          blockingOverlayOpen: !!activeProgram,
          reopenArmedAt: reopenArmedAtRef.current,
        });
        if (decision === "pass-through") {
          reopenArmedAtRef.current = 0;
          return false;
        }
        if (decision === "arm-reopen") {
          // First Back only arms — never opens. Guide may also consume Back first
          // to step left in the timeline before this listener runs.
          reopenArmedAtRef.current = Date.now();
          return true;
        }
        if (decision === "open-drawer") {
          reopenArmedAtRef.current = 0;
          openDrawer();
          return true;
        }
        if (decision === "close-drawer") {
          reopenArmedAtRef.current = 0;
          closeDrawer();
          return true;
        }
        return true;
      });
      return () => sub.remove();
    }, [active, activeProgram, closeDrawer, drawerOpen, openDrawer]),
  );

  const navigate = useCallback(
    (route: Route) => {
      void Haptics.selectionAsync().catch(() => undefined);
      // Never focus content beneath a still-open drawer. A newly mounted Guide
      // claims its own initial focus; an already-mounted Guide uses its nonce.
      closeDrawer();
      if (route !== active) router.replace(route as any);
    },
    [active, closeDrawer, router],
  );

  const exit = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (Platform.OS !== "web") BackHandler.exitApp();
  }, []);

  const [exitHint, setExitHint] = useState(false);
  const exitHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptHoldToExit = useCallback(() => {
    setExitHint(true);
    if (exitHintTimer.current) clearTimeout(exitHintTimer.current);
    exitHintTimer.current = setTimeout(() => setExitHint(false), 1600);
  }, []);
  useEffect(
    () => () => {
      if (exitHintTimer.current) clearTimeout(exitHintTimer.current);
    },
    [],
  );

  // Fully off-screen when closed — never leave a half-drawer visible on large TVs.
  const drawerTranslateX = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-PURPLE_SIDEBAR_WIDTH, 0],
  });

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: edges.padding.top,
          paddingBottom: edges.padding.bottom,
          paddingLeft: edges.padding.left,
          paddingRight: edges.padding.right,
          marginTop: edges.margin.top,
          marginBottom: edges.margin.bottom,
          marginLeft: edges.margin.left,
          marginRight: edges.margin.right,
        },
      ]}
    >
      {/* Absolute overlay drawer — slides completely past the left edge when closed. */}
      <Animated.View
        pointerEvents={drawerOpen ? "auto" : "none"}
        style={[styles.sidebarOverlay, { transform: [{ translateX: drawerTranslateX }] }]}
      >
        <FocusGuide
          style={styles.sidebar}
          trapFocusUp
          trapFocusDown
          trapFocusLeft
          trapFocusRight
        >
          <SmallBrand />
          {contextActions && contextActions.length > 0 ? (
            <View style={styles.contextActions}>
              {contextActions.map((action) => (
                <Pressable
                  key={action.label}
                  focusable={drawerOpen}
                  onPress={action.onPress}
                  style={({ focused }: any) => [
                    styles.contextActionRow,
                    focused && styles.navRowFocused,
                  ]}
                  testID={action.testID}
                >
                  <Ionicons name={action.icon} size={13} color={tvColors.purpleSoft} />
                  <Text numberOfLines={1} style={styles.contextActionText}>
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {active === "/guide" && guideGroups?.length ? (
            <View style={styles.guideGroupSection}>
              <Text style={styles.guideGroupLabel}>Groups</Text>
              <ScrollView
                style={styles.guideGroupList}
                contentContainerStyle={styles.guideGroupListContent}
                showsVerticalScrollIndicator={false}
              >
                {guideGroups.map((item) => (
                  <Pressable
                    key={item.name}
                    ref={(node) => {
                      if (node) guideGroupRefs.current.set(item.name, node);
                      else guideGroupRefs.current.delete(item.name);
                    }}
                    focusable={drawerOpen}
                    hasTVPreferredFocus={drawerAutoFocus && drawerPreferredRoute === null && !!item.active}
                    onPress={item.onPress}
                    onLongPress={item.onLongPress}
                    delayLongPress={420}
                    style={({ focused }: any) => [
                      styles.guideGroupRow,
                      item.active && styles.guideGroupRowActive,
                      item.pinned && styles.guideGroupRowPinned,
                      focused && styles.navRowFocused,
                    ]}
                    testID={`purple-guide-group-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Text numberOfLines={1} style={[styles.guideGroupText, item.active && styles.guideGroupTextActive]}>
                      {item.name}
                    </Text>
                    {item.count ? <Text style={styles.guideGroupCount}>{item.count}</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          {recentStrip.length > 0 ? (
            <View style={styles.recentStrip}>
              <Text style={styles.recentLabel}>Recent</Text>
              <View style={styles.recentRow}>
                {recentStrip.map((channel) => (
                  <Pressable
                    key={channel.id}
                    focusable={drawerOpen}
                    onPress={() => onRecentPress?.(channel.id)}
                    style={({ focused }: any) => [
                      styles.recentChip,
                      focused && styles.navRowFocused,
                    ]}
                    testID={`purple-recent-${channel.id}`}
                  >
                    <RecentLetterAvatar name={channel.name} />
                    <Text numberOfLines={1} style={styles.recentName}>
                      {channel.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <View style={styles.nav}>
            {NAV.map((item) => {
              const selected = item.route === active;
              const showWatching = item.route === "/" && isWatching;
              return (
                <Pressable
                  key={item.route}
                  ref={(node) => {
                    if (node) navRefs.current.set(item.route, node);
                    else navRefs.current.delete(item.route);
                  }}
                  focusable={drawerOpen}
                  hasTVPreferredFocus={drawerAutoFocus && drawerPreferredRoute === item.route}
                  onPress={() => navigate(item.route)}
                  style={({ focused }: any) => [
                    styles.navRow,
                    selected && styles.navRowSelected,
                    selected && styles.navRowActiveMark,
                    focused && styles.navRowFocused,
                  ]}
                  testID={`purple-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <View style={styles.navIconWrap}>
                    <Ionicons
                      name={selected ? (item.icon.replace("-outline", "") as any) : item.icon}
                      size={15}
                      color={selected ? "#fff" : tvColors.textMuted}
                    />
                    {showWatching ? <WatchingDot testID="purple-nav-live-watching" /> : null}
                  </View>
                  <Text numberOfLines={1} style={[styles.navText, selected && styles.navTextSelected]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.sidebarFooter, footerAction && styles.sidebarFooterRow]}>
            {footerAction ? (
              <Pressable
                focusable={drawerOpen}
                disabled={footerAction.disabled}
                onPress={footerAction.onPress}
                onFocus={() => {
                  if (active === "/guide") reclaimGuideBottomFocusIfArmed();
                }}
                style={({ focused }: any) => [
                  styles.footerCompact,
                  footerAction.disabled && styles.footerDisabled,
                  focused && styles.navRowFocused,
                ]}
                testID={footerAction.testID}
              >
                <Ionicons name={footerAction.icon} size={13} color={tvColors.textMuted} />
                <Text numberOfLines={1} style={styles.footerCompactText}>{footerAction.label}</Text>
              </Pressable>
            ) : null}
            <Pressable
              focusable={drawerOpen}
              onPress={promptHoldToExit}
              onLongPress={exit}
              delayLongPress={650}
              onFocus={() => {
                if (active === "/guide") reclaimGuideBottomFocusIfArmed();
              }}
              style={({ focused }: any) => [footerAction ? styles.footerCompact : styles.power, focused && styles.navRowFocused]}
              testID="purple-nav-power"
            >
              <Ionicons name="power-outline" size={14} color={tvColors.textMuted} />
              <Text numberOfLines={1} style={footerAction ? styles.footerCompactText : styles.powerText}>
                {exitHint ? "Hold Exit" : "Exit"}
              </Text>
            </Pressable>
          </View>
        </FocusGuide>
      </Animated.View>

      {/* Layout spacer only while the full drawer is open — closed state is full-bleed. */}
      {drawerOpen ? <View style={styles.sidebarSpacer} /> : null}

      <FocusGuide
        style={[styles.content, contentStyle]}
        // Do not remount on every route (key churn steals focus). Guide owns its own
        // mount-once preferred focus; other screens get a short autoFocus pulse only.
        autoFocus={contentAutoFocus}
      >
        {children}
      </FocusGuide>
      {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: tvColors.canvas,
    overflow: "hidden",
  },
  sidebarOverlay: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: PURPLE_SIDEBAR_WIDTH,
    zIndex: 20,
  },
  sidebarSpacer: {
    width: PURPLE_SIDEBAR_WIDTH,
    height: "100%",
  },
  sidebar: {
    width: PURPLE_SIDEBAR_WIDTH,
    height: "100%",
    backgroundColor: "#0A0916",
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 8,
  },
  brand: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
    marginBottom: 8,
  },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: tvColors.lineStrong,
    backgroundColor: tvColors.purpleDeep,
  },
  brandTop: {
    color: "#fff",
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  brandBottom: {
    color: tvColors.purpleSoft,
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 1.4,
  },
  contextActions: {
    gap: 2,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: tvColors.line,
  },
  contextActionRow: {
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 9,
  },
  contextActionText: {
    color: tvColors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 10,
    flex: 1,
  },
  guideGroupSection: {
    maxHeight: "38%",
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: tvColors.line,
  },
  guideGroupLabel: {
    color: tvColors.textMuted,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: 0.6,
    paddingHorizontal: 6,
    paddingBottom: 4,
    textTransform: "uppercase",
  },
  guideGroupList: { maxHeight: 190 },
  guideGroupListContent: { gap: 2 },
  guideGroupRow: {
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
  },
  guideGroupRowActive: { backgroundColor: tvColors.purple },
  guideGroupRowPinned: { borderLeftColor: tvColors.purpleBright },
  guideGroupText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10, flex: 1 },
  guideGroupTextActive: { color: "#fff", fontFamily: fonts.semibold },
  guideGroupCount: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  recentStrip: {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: tvColors.line,
    gap: 4,
  },
  recentLabel: {
    color: tvColors.textMuted,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: 0.6,
    paddingHorizontal: 6,
    textTransform: "uppercase",
  },
  recentRow: {
    gap: 2,
  },
  recentChip: {
    minHeight: 28,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 7,
  },
  recentAvatar: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tvColors.purpleDeep,
    borderWidth: 1,
    borderColor: tvColors.lineStrong,
  },
  recentAvatarText: {
    color: "#fff",
    fontFamily: fonts.bold,
    fontSize: 9,
  },
  recentName: {
    color: tvColors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 9.5,
    flex: 1,
  },
  nav: { flex: 1, gap: 2 },
  navRow: {
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 9,
  },
  navRowSelected: {
    backgroundColor: tvColors.purple,
  },
  navRowActiveMark: {
    borderLeftWidth: 3,
    borderLeftColor: tvColors.purpleBright,
    paddingLeft: 6,
  },
  navRowFocused: {
    borderColor: "#fff",
    backgroundColor: tvColors.purpleDeep,
  },
  navIconWrap: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  watchingDot: {
    position: "absolute",
    top: -1,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tvColors.purpleBright,
  },
  navText: {
    color: tvColors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 10.5,
  },
  navTextSelected: { color: "#fff", fontFamily: fonts.semibold },
  sidebarFooter: { borderTopWidth: 1, borderTopColor: tvColors.line, paddingTop: 6 },
  sidebarFooterRow: { flexDirection: "row", gap: 4 },
  power: {
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 9,
  },
  powerText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9.5 },
  footerCompact: {
    flex: 1,
    minWidth: 0,
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
  },
  footerCompactText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  footerDisabled: { opacity: 0.5 },
  content: { flex: 1, backgroundColor: tvColors.canvas },
  headerRight: {
    position: "absolute",
    top: 10,
    right: spacing.lg,
  },
});
