import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts, radius, spacing } from "@/src/theme";
import { FocusGuide } from "@/src/components/TVFocusGuideView";

type MenuRoute = "/" | "/favorites" | "/search" | "/settings";
type DrawerMode = "groups" | "rail";

const RED = "#E3262E";
const RED_DARK = "#8E1118";
const WHITE = "#F8F8F8";
export const GUIDE_RAIL_WIDTH = 92;

export function guideGroupsWidth(screenWidth: number): number {
  return Math.min(382, Math.max(320, screenWidth * 0.23));
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
  const drawerWidth = guideGroupsWidth(width);
  const groupsVisible = mode === "groups";

  return (
    <View
      style={styles.layer}
      accessibilityViewIsModal
      accessibilityLabel={groupsVisible ? "Channel groups" : "Application navigation"}
      testID="guide-navigation-layer"
    >
      <Pressable
        style={styles.scrim}
        focusable={false}
        accessible={false}
        onPress={onClose}
      />

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
          <ScrollView
            contentContainerStyle={styles.groupList}
            showsVerticalScrollIndicator={false}
          >
            {groups.map((group, index) => {
              const active = group === selected;
              return (
                <Pressable
                  key={group}
                  hasTVPreferredFocus={active || (index === 0 && !groups.includes(selected))}
                  onPress={() => onSelect(group)}
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
                    size={24}
                  />
                  <Text numberOfLines={1} style={[styles.rowText, active && styles.activeText]}>
                    {groupLabel(group)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <DrawerAction icon="heart" label="Favorites" onPress={() => onNavigate("/favorites")} />
            <DrawerAction icon="search" label="Search" onPress={() => onNavigate("/search")} />
            <DrawerAction icon="settings" label="Settings" onPress={() => onNavigate("/settings")} />
            <DrawerAction icon="power" label="Power" onPress={onExit} />
            <Text style={styles.navigationHint}>LEFT: compact rail   •   OK: open group</Text>
          </View>
        </FocusGuide>
      ) : (
        <FocusGuide
          autoFocus
          trapFocusUp
          trapFocusDown
          trapFocusRight
          style={styles.rail}
        >
          <Text style={styles.railLogo}>C</Text>
          <View style={styles.railActions}>
            <RailAction icon="heart" label="Favorites" onPress={() => onNavigate("/favorites")} />
            <RailAction icon="search" label="Search" onPress={() => onNavigate("/search")} />
            <RailAction icon="settings" label="Settings" preferred onPress={() => onNavigate("/settings")} />
            <RailAction icon="power" label="Power" onPress={onExit} />
          </View>
          <Text style={styles.railHint}>RIGHT</Text>
        </FocusGuide>
      )}
    </View>
  );
}

function DrawerAction({
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
      <Ionicons name={icon} color={WHITE} size={23} />
      <Text style={styles.footerText}>{label}</Text>
    </Pressable>
  );
}

function RailAction({
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
      <Ionicons name={icon} color={WHITE} size={27} />
      <Text style={styles.railActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  drawer: {
    backgroundColor: "#14181D",
    borderRightColor: "rgba(255,255,255,0.12)",
    borderRightWidth: 1,
    bottom: 0,
    left: 0,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    position: "absolute",
    top: 0,
  },
  brandBlock: {
    borderBottomColor: "rgba(255,255,255,0.10)",
    borderBottomWidth: 1,
    gap: 5,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  brandLine: { flexDirection: "row", alignItems: "baseline" },
  brandCharm: { color: RED, fontFamily: fonts.bold, fontSize: 30, letterSpacing: 0.5 },
  brandIptv: { color: WHITE, fontFamily: fonts.medium, fontSize: 24 },
  versionLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  versionRule: { width: 28, height: 2, backgroundColor: RED },
  versionText: { color: RED, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1.2 },
  sectionTitle: {
    color: RED,
    fontFamily: fonts.semibold,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  groupList: { gap: 4, paddingBottom: spacing.sm },
  row: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 3,
    flexDirection: "row",
    gap: spacing.lg,
    minHeight: 55,
    paddingHorizontal: spacing.lg,
  },
  activeRow: {
    backgroundColor: RED_DARK,
  },
  focusedRow: {
    backgroundColor: RED_DARK,
    borderColor: WHITE,
  },
  rowText: {
    color: "rgba(255,255,255,0.88)",
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 17,
  },
  activeText: { color: WHITE, fontFamily: fonts.bold },
  footer: {
    borderTopColor: "rgba(255,255,255,0.16)",
    borderTopWidth: 1,
    gap: 2,
    paddingTop: spacing.sm,
  },
  footerRow: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: "row",
    gap: spacing.lg,
    minHeight: 46,
    paddingHorizontal: spacing.lg,
  },
  footerText: { color: "rgba(255,255,255,0.88)", fontFamily: fonts.medium, fontSize: 16 },
  navigationHint: {
    color: "rgba(255,255,255,0.42)",
    fontFamily: fonts.regular,
    fontSize: 9,
    paddingHorizontal: spacing.lg,
    paddingTop: 5,
  },
  rail: {
    alignItems: "center",
    backgroundColor: "#11151A",
    borderRightColor: "rgba(255,255,255,0.12)",
    borderRightWidth: 1,
    bottom: 0,
    justifyContent: "space-between",
    left: 0,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xl,
    position: "absolute",
    top: 0,
    width: GUIDE_RAIL_WIDTH,
  },
  railLogo: {
    color: RED,
    fontFamily: fonts.bold,
    fontSize: 34,
  },
  railActions: { gap: spacing.sm },
  railAction: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 3,
    gap: 3,
    justifyContent: "center",
    minHeight: 64,
    width: 72,
  },
  railActionFocused: { backgroundColor: RED_DARK, borderColor: WHITE },
  railActionText: { color: WHITE, fontFamily: fonts.semibold, fontSize: 9 },
  railHint: { color: "rgba(255,255,255,0.44)", fontFamily: fonts.bold, fontSize: 9 },
});
