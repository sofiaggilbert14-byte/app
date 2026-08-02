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
import { colors, fonts, radius, spacing } from "@/src/theme";
import { FocusGuide } from "@/src/components/TVFocusGuideView";

type MenuRoute = "/" | "/favorites" | "/search" | "/settings";

const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";

export function GuideGroupsDrawer({
  groups,
  selected,
  onSelect,
  onClose,
  onNavigate,
  onExit,
}: {
  groups: string[];
  selected: string;
  onSelect: (group: string) => void;
  onClose: () => void;
  onNavigate: (route: MenuRoute) => void;
  onExit: () => void;
}) {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(380, Math.max(300, width * 0.34));

  return (
    <View
      style={styles.layer}
      accessibilityViewIsModal
      accessibilityLabel="Channel groups and navigation"
      testID="guide-groups-drawer"
    >
      <Pressable
        style={styles.scrim}
        focusable={false}
        accessible={false}
        onPress={onClose}
      />
      <FocusGuide
        autoFocus
        trapFocusLeft
        trapFocusRight
        style={[styles.drawer, { width: drawerWidth }]}
      >
        <View style={styles.headingRow}>
          <View>
            <Text style={styles.eyebrow}>CHARM IPTV EXPERIMENTAL</Text>
            <Text style={styles.heading}>Groups</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ focused }: any) => [styles.closeButton, focused && styles.focused]}
            accessibilityLabel="Close groups"
          >
            <Ionicons name="close" color="#fff" size={24} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.groupList} showsVerticalScrollIndicator={false}>
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
                  focused && styles.focused,
                ]}
                testID={`drawer-group-${group}`}
              >
                <Ionicons
                  name={
                    group === "Favorites"
                      ? "star"
                      : group === "All"
                        ? "apps"
                        : group === "Recently Watched"
                          ? "time"
                          : "folder-outline"
                  }
                  color={active ? GOLD_SOFT : "rgba(255,255,255,0.68)"}
                  size={20}
                />
                <Text numberOfLines={1} style={[styles.rowText, active && styles.activeRowText]}>
                  {group}
                </Text>
                {active && <View style={styles.activeMarker} />}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.destinations}>
          <DrawerDestination icon="grid" label="TV Guide" onPress={() => onNavigate("/")} />
          <DrawerDestination icon="star-outline" label="Favorites" onPress={() => onNavigate("/favorites")} />
          <DrawerDestination icon="search" label="Search" onPress={() => onNavigate("/search")} />
          <DrawerDestination icon="settings-outline" label="Settings" onPress={() => onNavigate("/settings")} />
          <DrawerDestination icon="power" label="Exit App" onPress={onExit} />
        </View>
      </FocusGuide>
    </View>
  );
}

function DrawerDestination({
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
      style={({ focused }: any) => [styles.destination, focused && styles.focused]}
    >
      <Ionicons name={icon} color={GOLD_SOFT} size={19} />
      <Text style={styles.destinationText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    flexDirection: "row",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.66)",
  },
  drawer: {
    backgroundColor: "#0C0804",
    borderRightColor: "rgba(246,183,60,0.42)",
    borderRightWidth: 1,
    paddingBottom: spacing.lg,
    paddingTop: spacing.lg,
    shadowColor: "#000",
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
  },
  headingRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  eyebrow: {
    color: GOLD,
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  heading: { color: "#fff", fontFamily: fonts.bold, fontSize: 26 },
  closeButton: {
    alignItems: "center",
    borderColor: "rgba(255,227,163,0.22)",
    borderRadius: radius.md,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  groupList: { gap: 3, paddingHorizontal: spacing.sm },
  row: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  activeRow: { backgroundColor: "rgba(124,74,17,0.72)" },
  focused: { borderColor: GOLD_SOFT, backgroundColor: "rgba(246,183,60,0.18)" },
  rowText: { color: "rgba(255,255,255,0.82)", flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  activeRowText: { color: GOLD_SOFT, fontFamily: fonts.semibold },
  activeMarker: { backgroundColor: GOLD, borderRadius: 2, height: 24, width: 3 },
  destinations: {
    borderTopColor: "rgba(246,183,60,0.24)",
    borderTopWidth: 1,
    gap: 3,
    marginHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  destination: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  destinationText: { color: colors.onSurfaceSecondary, fontFamily: fonts.medium, fontSize: 14 },
});
