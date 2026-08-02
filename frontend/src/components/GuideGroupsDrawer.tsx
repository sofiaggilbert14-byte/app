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

const GOLD = "#E1B04A";
const GOLD_SOFT = "#F3E0AD";
export const GUIDE_RAIL_WIDTH = 92;

export function guideGroupsWidth(screenWidth: number): number {
  return Math.min(390, Math.max(300, screenWidth * 0.27));
}

function groupLabel(group: string): string {
  if (group === "All") return "All Channels";
  if (group === "Recently Watched") return "Recent Channels";
  return group;
}

function groupIcon(group: string): React.ComponentProps<typeof Ionicons>["name"] {
  if (group === "All") return "tv-outline";
  if (group === "Favorites") return "star";
  if (group === "Recently Watched") return "time";
  if (group === "Movies") return "film-outline";
  if (group === "Sports") return "football-outline";
  if (group === "News") return "newspaper-outline";
  if (group === "Kids") return "happy-outline";
  return "folder-outline";
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
  const groupsWidth = guideGroupsWidth(width);
  const groupsVisible = mode === "groups";

  return (
    <View
      style={styles.layer}
      accessibilityViewIsModal
      accessibilityLabel={groupsVisible ? "Channel groups" : "Application navigation"}
      testID="guide-navigation-layer"
    >
      <Pressable
        style={[styles.scrim, groupsVisible ? styles.groupsScrim : styles.railScrim]}
        focusable={false}
        accessible={false}
        onPress={onClose}
      />

      <FocusGuide
        autoFocus
        trapFocusUp
        trapFocusDown
        trapFocusRight
        style={[styles.navigationShell, { width: GUIDE_RAIL_WIDTH + (groupsVisible ? groupsWidth : 0) }]}
      >
        <View style={styles.rail}>
          <View style={styles.railBrand}>
            <Ionicons name="flame" color={GOLD} size={28} />
          </View>

          <View style={styles.railActions}>
            <RailAction
              icon="settings-outline"
              label="Settings"
              enabled={!groupsVisible}
              preferred={!groupsVisible}
              onPress={() => onNavigate("/settings")}
            />
            <RailAction
              icon="power"
              label="Power"
              enabled={!groupsVisible}
              onPress={onExit}
            />
          </View>
        </View>

        {groupsVisible && (
          <FocusGuide autoFocus trapFocusRight style={[styles.groupsDrawer, { width: groupsWidth }]}>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>CHARM IPTV EXPERIMENTAL</Text>
              <Text style={styles.headingText}>Channel Groups</Text>
              <Text style={styles.navigationHint}>LEFT: rail   •   OK: open guide</Text>
            </View>

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
                      styles.groupRow,
                      active && styles.activeGroupRow,
                      focused && styles.focused,
                    ]}
                    testID={`drawer-group-${group}`}
                  >
                    <Ionicons
                      name={groupIcon(group)}
                      color={active ? GOLD_SOFT : "rgba(255,255,255,0.72)"}
                      size={21}
                    />
                    <Text
                      numberOfLines={1}
                      style={[styles.groupText, active && styles.activeGroupText]}
                    >
                      {groupLabel(group)}
                    </Text>
                    {active && <View style={styles.activeMarker} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </FocusGuide>
        )}
      </FocusGuide>
    </View>
  );
}

function RailAction({
  icon,
  label,
  enabled,
  preferred = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  enabled: boolean;
  preferred?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      focusable={enabled}
      accessible={enabled}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      style={({ focused }: any) => [styles.railAction, focused && styles.railActionFocused]}
    >
      <Ionicons name={icon} color={GOLD_SOFT} size={27} />
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
  },
  groupsScrim: {
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  railScrim: {
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  navigationShell: {
    bottom: 0,
    flexDirection: "row",
    left: 0,
    position: "absolute",
    top: 0,
  },
  rail: {
    alignItems: "center",
    backgroundColor: "#08090B",
    borderRightColor: "rgba(225,176,74,0.30)",
    borderRightWidth: 1,
    justifyContent: "space-between",
    paddingBottom: spacing.xl,
    paddingTop: spacing.xl,
    width: GUIDE_RAIL_WIDTH,
  },
  railBrand: {
    alignItems: "center",
    borderColor: "rgba(225,176,74,0.30)",
    borderRadius: radius.md,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 52,
  },
  railActions: {
    gap: spacing.md,
  },
  railAction: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.md,
    borderWidth: 2,
    gap: 4,
    justifyContent: "center",
    minHeight: 68,
    width: 72,
  },
  railActionFocused: {
    backgroundColor: "rgba(225,176,74,0.18)",
    borderColor: GOLD_SOFT,
  },
  railActionText: {
    color: GOLD_SOFT,
    fontFamily: fonts.semibold,
    fontSize: 10,
  },
  groupsDrawer: {
    backgroundColor: "#15171B",
    borderRightColor: "rgba(225,176,74,0.36)",
    borderRightWidth: 1,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xl,
    shadowColor: "#000",
    shadowOffset: { width: 12, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 28,
  },
  heading: {
    borderBottomColor: "rgba(225,176,74,0.22)",
    borderBottomWidth: 1,
    gap: 4,
    marginBottom: spacing.sm,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  eyebrow: {
    color: GOLD,
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  headingText: {
    color: "#fff",
    fontFamily: fonts.bold,
    fontSize: 25,
  },
  navigationHint: {
    color: "rgba(255,255,255,0.52)",
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  groupList: {
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  groupRow: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  activeGroupRow: {
    backgroundColor: "rgba(124,74,17,0.72)",
  },
  focused: {
    backgroundColor: "rgba(225,176,74,0.20)",
    borderColor: GOLD_SOFT,
  },
  groupText: {
    color: "rgba(255,255,255,0.84)",
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
  },
  activeGroupText: {
    color: GOLD_SOFT,
    fontFamily: fonts.semibold,
  },
  activeMarker: {
    backgroundColor: GOLD,
    borderRadius: 2,
    height: 24,
    width: 3,
  },
});