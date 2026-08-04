import React, { memo, useCallback, useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts, radius } from "@/src/theme";
import { FocusGuide } from "@/src/components/TVFocusGuideView";

type MenuRoute = "/" | "/favorites" | "/search" | "/settings";
type DrawerMode = "groups" | "rail";

const RED = "#E3262E";
const RED_DARK = "#8E1118";
const WHITE = "#F8F8F8";
export const GUIDE_RAIL_WIDTH = 52;

export function guideGroupsWidth(screenWidth: number): number {
  return Math.min(232, Math.max(196, screenWidth * 0.158));
}

function groupLabel(group: string): string {
  if (group === "All") return "All";
  if (group === "Recently Watched") return "Recent";
  return group;
}

function groupIcon(group: string): React.ComponentProps<typeof Ionicons>["name"] {
  if (group === "All") return "grid";
  if (group === "Favorites") return "star";
  if (group === "Recently Watched") return "time";
  if (group === "Movies") return "film";
  if (group === "Sports") return "football";
  if (group === "News") return "newspaper";
  if (group === "Kids") return "happy";
  if (group === "Music") return "musical-notes";
  return "folder";
}

const GroupItem = memo(function GroupItem({
  group,
  active,
  hasPreferredFocus,
  onSelect,
}: {
  group: string;
  active: boolean;
  hasPreferredFocus: boolean;
  onSelect: (group: string) => void;
}) {
  const handlePress = useCallback(() => onSelect(group), [group, onSelect]);
  return (
    <Pressable
      hasTVPreferredFocus={hasPreferredFocus}
      onPress={handlePress}
      style={({ focused }: any) => [
        styles.row,
        active && styles.activeRow,
        focused && styles.focusedRow,
      ]}
      testID={`drawer-group-${group}`}
    >
      <Ionicons
        name={groupIcon(group)}
        color={active ? WHITE : "rgba(255,255,255,0.86)"}
        size={19}
      />
      <Text numberOfLines={1} style={[styles.rowText, active && styles.activeText]}>
        {groupLabel(group)}
      </Text>
    </Pressable>
  );
});

const DrawerAction = memo(function DrawerAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ focused }: any) => [styles.footerRow, focused && styles.focusedRow]}
    >
      <Ionicons name={icon} color={WHITE} size={19} />
      <Text style={styles.footerText}>{label}</Text>
    </Pressable>
  );
});

const RailAction = memo(function RailAction({
  icon,
  label,
  preferred = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  preferred?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      style={({ focused }: any) => [styles.railAction, focused && styles.railActionFocused]}
    >
      <Ionicons name={icon} color={WHITE} size={21} />
      <Text style={styles.railActionText}>{label}</Text>
    </Pressable>
  );
});

export function GuideGroupsDrawer({
  mode,
  groups,
  selected,
  onSelect,
  onClose,
  onNavigate,
  onExit,
}: {
  mode: DrawerMode;
  groups: string[];
  selected: string;
  onSelect: (group: string) => void;
  onClose: () => void;
  onNavigate: (route: MenuRoute) => void;
  onExit: () => void;
}) {
  const { width } = useWindowDimensions();
  const drawerWidth = useMemo(() => guideGroupsWidth(width), [width]);
  const groupsVisible = mode === "groups";
  const selectedIndex = useMemo(() => groups.indexOf(selected), [groups, selected]);

  const openFavorites = useCallback(() => onNavigate("/favorites"), [onNavigate]);
  const openSearch = useCallback(() => onNavigate("/search"), [onNavigate]);
  const openSettings = useCallback(() => onNavigate("/settings"), [onNavigate]);

  return (
    <View
      style={styles.layer}
      accessibilityViewIsModal
      accessibilityLabel={groupsVisible ? "Channel groups" : "Application navigation"}
      testID="guide-navigation-layer"
    >
      <Pressable style={styles.scrim} focusable={false} accessible={false} onPress={onClose} />

      {groupsVisible ? (
        <FocusGuide
          autoFocus
          trapFocusUp
          trapFocusDown
          trapFocusRight
          style={[styles.drawer, { width: drawerWidth }]}
        >
          <View style={styles.brandBlock}>
            <View style={styles.brandLine}>
              <Text style={styles.brandCharm}>CHARM</Text>
              <Text style={styles.brandIptv}> IPTV</Text>
            </View>
            <View style={styles.versionLine}>
              <View style={styles.versionRule} />
              <Text style={styles.versionText}>EXPERIMENTAL v3</Text>
              <View style={styles.versionRule} />
            </View>
          </View>

          <Text style={styles.sectionTitle}>Groups</Text>
          <ScrollView contentContainerStyle={styles.groupList} showsVerticalScrollIndicator={false}>
            {groups.map((group, index) => {
              const active = group === selected;
              return (
                <GroupItem
                  key={group}
                  group={group}
                  active={active}
                  hasPreferredFocus={active || (index === 0 && selectedIndex < 0)}
                  onSelect={onSelect}
                />
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <DrawerAction icon="heart" label="Favorites" onPress={openFavorites} />
            <DrawerAction icon="search" label="Search" onPress={openSearch} />
            <DrawerAction icon="settings" label="Settings" onPress={openSettings} />
            <DrawerAction icon="power" label="Power" onPress={onExit} />
          </View>
        </FocusGuide>
      ) : (
        <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusRight style={styles.rail}>
          <Text style={styles.railLogo}>C</Text>
          <View style={styles.railActions}>
            <RailAction icon="heart" label="Favorites" onPress={openFavorites} />
            <RailAction icon="search" label="Search" onPress={openSearch} />
            <RailAction icon="settings" label="Settings" preferred onPress={openSettings} />
            <RailAction icon="power" label="Power" onPress={onExit} />
          </View>
          <Text style={styles.railHint}>RIGHT</Text>
        </FocusGuide>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.04)" },
  drawer: {
    backgroundColor: "#14181D",
    borderRightColor: "rgba(255,255,255,0.12)",
    borderRightWidth: 1,
    bottom: 0,
    left: 0,
    paddingBottom: 5,
    paddingHorizontal: 6,
    paddingTop: 8,
    position: "absolute",
    top: 0,
  },
  brandBlock: {
    borderBottomColor: "rgba(255,255,255,0.10)",
    borderBottomWidth: 1,
    gap: 2,
    marginBottom: 5,
    paddingHorizontal: 6,
    paddingBottom: 7,
  },
  brandLine: { flexDirection: "row", alignItems: "baseline" },
  brandCharm: { color: RED, fontFamily: fonts.bold, fontSize: 18, letterSpacing: 0.3 },
  brandIptv: { color: WHITE, fontFamily: fonts.medium, fontSize: 14 },
  versionLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  versionRule: { width: 13, height: 1, backgroundColor: RED },
  versionText: { color: RED, fontFamily: fonts.medium, fontSize: 7, letterSpacing: 0.6 },
  sectionTitle: { color: RED, fontFamily: fonts.semibold, fontSize: 10, paddingHorizontal: 6, paddingBottom: 3 },
  groupList: { gap: 1, paddingBottom: 3 },
  row: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: "row",
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 7,
  },
  activeRow: { backgroundColor: RED_DARK },
  focusedRow: { backgroundColor: RED_DARK, borderColor: WHITE },
  rowText: { color: "rgba(255,255,255,0.88)", flex: 1, fontFamily: fonts.medium, fontSize: 11 },
  activeText: { color: WHITE, fontFamily: fonts.bold },
  footer: { borderTopColor: "rgba(255,255,255,0.16)", borderTopWidth: 1, gap: 0, paddingTop: 3 },
  footerRow: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: "row",
    gap: 7,
    minHeight: 31,
    paddingHorizontal: 7,
  },
  footerText: { color: "rgba(255,255,255,0.88)", fontFamily: fonts.medium, fontSize: 10.5 },
  rail: {
    alignItems: "center",
    backgroundColor: "#11151A",
    borderRightColor: "rgba(255,255,255,0.12)",
    borderRightWidth: 1,
    bottom: 0,
    justifyContent: "space-between",
    left: 0,
    paddingBottom: 7,
    paddingTop: 8,
    position: "absolute",
    top: 0,
    width: GUIDE_RAIL_WIDTH,
  },
  railLogo: { color: RED, fontFamily: fonts.bold, fontSize: 22 },
  railActions: { gap: 3 },
  railAction: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    gap: 2,
    justifyContent: "center",
    minHeight: 42,
    width: 44,
  },
  railActionFocused: { backgroundColor: RED_DARK, borderColor: WHITE },
  railActionText: { color: WHITE, fontFamily: fonts.semibold, fontSize: 7 },
  railHint: { color: "rgba(255,255,255,0.44)", fontFamily: fonts.bold, fontSize: 7 },
});
