import React, { useCallback, useMemo } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { getTvSafeInsets } from "@/src/utils/tvLayout";

type Route =
  | "/"
  | "/guide"
  | "/channels"
  | "/movies"
  | "/series"
  | "/catchup"
  | "/favorites"
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
  { route: "/channels", label: "Channels", icon: "list-outline" },
  { route: "/movies", label: "Movies", icon: "film-outline" },
  { route: "/series", label: "Series", icon: "albums-outline" },
  { route: "/catchup", label: "Catch Up", icon: "time-outline" },
  { route: "/favorites", label: "Favorites", icon: "heart-outline" },
  { route: "/search", label: "Search", icon: "search-outline" },
  { route: "/settings", label: "Settings", icon: "settings-outline" },
];

export const PURPLE_SIDEBAR_WIDTH = 156;

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

export function PurpleTvShell({
  active,
  children,
  headerRight,
  contentStyle,
}: {
  active: Route;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  contentStyle?: any;
}) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const safe = useMemo(() => getTvSafeInsets(width, height), [width, height]);

  const navigate = useCallback(
    (route: Route) => {
      if (route === active) return;
      void Haptics.selectionAsync().catch(() => undefined);
      router.replace(route as any);
    },
    [active, router],
  );

  const exit = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (Platform.OS !== "web") BackHandler.exitApp();
  }, []);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: safe.top,
          paddingBottom: safe.bottom,
          paddingLeft: safe.left,
          paddingRight: safe.right,
        },
      ]}
    >
      <View style={styles.sidebar}>
        <SmallBrand />
        <View style={styles.nav}>
          {NAV.map((item, index) => {
            const selected = item.route === active;
            return (
              <Pressable
                key={item.route}
                hasTVPreferredFocus={selected || (active === "/" && index === 0)}
                onPress={() => navigate(item.route)}
                style={({ focused }: any) => [
                  styles.navRow,
                  selected && styles.navRowSelected,
                  focused && styles.navRowFocused,
                ]}
                testID={`purple-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Ionicons
                  name={selected ? (item.icon.replace("-outline", "") as any) : item.icon}
                  size={15}
                  color={selected ? "#fff" : tvColors.textMuted}
                />
                <Text numberOfLines={1} style={[styles.navText, selected && styles.navTextSelected]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.sidebarFooter}>
          <Pressable
            onPress={exit}
            style={({ focused }: any) => [styles.power, focused && styles.navRowFocused]}
            testID="purple-nav-power"
          >
            <Ionicons name="power-outline" size={14} color={tvColors.textMuted} />
            <Text style={styles.powerText}>Exit</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.content, contentStyle]}>{children}</View>
      {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: tvColors.canvas,
  },
  sidebar: {
    width: PURPLE_SIDEBAR_WIDTH,
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
  navRowFocused: {
    borderColor: "#fff",
    backgroundColor: tvColors.purpleDeep,
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
