import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
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
import { useTvCalibration } from "@/src/tvCalibration";

/** One-shot: first shell mount prefers the Live TV sidebar item at cold start. */
let bootSidebarFocusPending = true;

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

const NAV: NavItem[] = [
  { route: "/", label: "Live TV", icon: "tv-outline" },
  { route: "/guide", label: "TV Guide", icon: "calendar-outline" },
  { route: "/favorites", label: "Favorites", icon: "heart-outline" },
  { route: "/reminders", label: "Reminders", icon: "notifications-outline" },
  { route: "/channels", label: "Channels", icon: "list-outline" },
  { route: "/movies", label: "Movies", icon: "film-outline" },
  { route: "/series", label: "Series", icon: "albums-outline" },
  { route: "/catchup", label: "Catch Up", icon: "time-outline" },
  { route: "/search", label: "Search", icon: "search-outline" },
  { route: "/settings", label: "Settings", icon: "settings-outline" },
];

export const PURPLE_SIDEBAR_WIDTH = 156;
export const PURPLE_DRAWER_ANIMATION_MS = 180;

type DrawerContextValue = {
  drawerOpen: boolean;
  drawerProgress: Animated.Value;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function PurpleTvDrawerProvider({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const drawerProgress = useRef(new Animated.Value(1)).current;
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
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
    () => ({ drawerOpen, drawerProgress, openDrawer, closeDrawer }),
    [closeDrawer, drawerOpen, drawerProgress, openDrawer],
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

export function PurpleTvShell({
  active,
  children,
  headerRight,
  contentStyle,
  watchingChannelId,
}: {
  active: Route;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  contentStyle?: any;
  watchingChannelId?: string | null;
}) {
  const router = useRouter();
  const { drawerOpen, drawerProgress, openDrawer, closeDrawer } = usePurpleTvDrawer();
  const { width, height } = useWindowDimensions();
  const { deviceLayoutMode, activeProgram } = useStore();
  const { calibration } = useTvCalibration();
  const edges = useMemo(() => {
    const safe = getTvSafeInsets(width, height, deviceLayoutMode);
    return combineTvEdgeInsets(safe, calibration);
  }, [calibration, deviceLayoutMode, height, width]);
  const [bootSidebarFocus] = useState(() => {
    if (!bootSidebarFocusPending) return false;
    bootSidebarFocusPending = false;
    return true;
  });
  const bootFocusConsumed = useRef(false);
  const navRefs = useRef(new Map<Route, unknown>());
  const drawerFocusCancelRef = useRef<(() => void) | null>(null);
  const isWatching = !!watchingChannelId;
  // Mount-once content autoFocus so child preferred-focus can stick after first paint.
  const [contentAutoFocus, setContentAutoFocus] = useState(
    () => !drawerOpen && !bootSidebarFocus,
  );
  const [drawerAutoFocus, setDrawerAutoFocus] = useState(drawerOpen);
  useEffect(() => {
    if (!contentAutoFocus) return;
    const timer = setTimeout(() => setContentAutoFocus(false), 700);
    return () => clearTimeout(timer);
  }, [contentAutoFocus]);

  useEffect(() => {
    drawerFocusCancelRef.current?.();
    drawerFocusCancelRef.current = null;
    if (!drawerOpen) {
      setDrawerAutoFocus(false);
      // Guide owns mount-once preferred focus — never pulse content autoFocus there
      // (it fights logo/program stickiness after Back → drawer → close).
      if (active !== "/guide") setContentAutoFocus(true);
      return;
    }

    setContentAutoFocus(false);
    setDrawerAutoFocus(true);
    const clearPreferred = setTimeout(() => setDrawerAutoFocus(false), 700);
    const cancelFocus = requestNativeFocusWithRetry(
      navRefs.current.get(active),
      [0, PURPLE_DRAWER_ANIMATION_MS, 280, 420, 650],
    );
    drawerFocusCancelRef.current = cancelFocus;
    return () => {
      clearTimeout(clearPreferred);
      cancelFocus?.();
      if (drawerFocusCancelRef.current === cancelFocus) drawerFocusCancelRef.current = null;
    };
  }, [active, drawerOpen]);

  const reopenArmedAtRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
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
    }, [activeProgram, closeDrawer, drawerOpen, openDrawer]),
  );

  const navigate = useCallback(
    (route: Route) => {
      void Haptics.selectionAsync().catch(() => undefined);
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
      {drawerOpen ? <Animated.View
        pointerEvents="auto"
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
          <View style={styles.nav}>
            {NAV.map((item) => {
              const selected = item.route === active;
              const preferBootLiveTv = bootSidebarFocus && !bootFocusConsumed.current && item.route === "/";
              const showWatching = item.route === "/" && isWatching;
              return (
                <Pressable
                  key={item.route}
                  ref={(node) => {
                    if (node) navRefs.current.set(item.route, node);
                    else navRefs.current.delete(item.route);
                  }}
                  focusable
                  hasTVPreferredFocus={preferBootLiveTv || (drawerAutoFocus && selected)}
                  onFocus={() => {
                    drawerFocusCancelRef.current?.();
                    drawerFocusCancelRef.current = null;
                    if (preferBootLiveTv) bootFocusConsumed.current = true;
                  }}
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
          <View style={styles.sidebarFooter}>
            <Pressable
              focusable
              onPress={promptHoldToExit}
              onLongPress={exit}
              delayLongPress={650}
              onFocus={() => {
                drawerFocusCancelRef.current?.();
                drawerFocusCancelRef.current = null;
                if (active === "/guide") reclaimGuideBottomFocusIfArmed();
              }}
              style={({ focused }: any) => [styles.power, focused && styles.navRowFocused]}
              testID="purple-nav-power"
            >
              <Ionicons name="power-outline" size={14} color={tvColors.textMuted} />
              <Text numberOfLines={1} style={styles.powerText}>
                {exitHint ? "Hold Exit" : "Exit"}
              </Text>
            </Pressable>
          </View>
        </FocusGuide>
      </Animated.View> : null}

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
  content: { flex: 1, backgroundColor: tvColors.canvas },
  headerRight: {
    position: "absolute",
    top: 10,
    right: spacing.lg,
  },
});
