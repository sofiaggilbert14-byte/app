import React, { useEffect, useRef } from "react";
import { DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import type { PurpleGuideGroup } from "@/src/components/PurpleTvShell";
import { fonts, radius, tvColors } from "@/src/theme";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { addTvKeyListener, setGuideNavigationActive, setRemoteContext } from "@/src/utils/tvRemote";

export const GUIDE_GROUP_DRAWER_WIDTH = 188;

export function PurpleGuideGroupDrawer({
  open,
  groups,
  onCloseToGuide,
  onOpenMainDrawer,
}: {
  open: boolean;
  groups: PurpleGuideGroup[];
  onCloseToGuide: () => void;
  onOpenMainDrawer: () => void;
}) {
  const refs = useRef(new Map<string, unknown>());
  const activeNameRef = useRef<string | null>(null);
  const closeToGuideRef = useRef(onCloseToGuide);
  const openMainDrawerRef = useRef(onOpenMainDrawer);

  // Keep the latest callbacks/data available to the single open-scoped remote
  // listener without tearing that listener down on every Guide render. Group
  // counts and EPG refreshes can update frequently while this drawer is open;
  // they must never launch another focus-retry sequence under the user's cursor.
  activeNameRef.current = groups.find((item) => item.active)?.name || groups[0]?.name || null;
  closeToGuideRef.current = onCloseToGuide;
  openMainDrawerRef.current = onOpenMainDrawer;

  useEffect(() => {
    if (!open) return;
    // The groups drawer owns horizontal/back remote actions. Up/Down and OK stay
    // with Android's native focus engine inside the drawer, so only one layer
    // responds to a physical key at a time.
    setGuideNavigationActive(false);
    setRemoteContext("guide_groups");
    const off = addTvKeyListener((key) => {
      if (key === "LEFT" || key === "BACK") {
        openMainDrawerRef.current();
        return;
      }
      if (key === "RIGHT") closeToGuideRef.current();
    });

    // Claim focus once per drawer entry. After this, Android owns vertical focus
    // movement until the drawer closes; active-group/count updates cannot yank it.
    const activeName = activeNameRef.current;
    const node = activeName ? refs.current.get(activeName) : null;
    const cancelFocus = requestNativeFocusWithRetry(node, [0, 80, 160, 260]);
    return () => {
      off();
      cancelFocus?.();
      setRemoteContext("guide");
      setGuideNavigationActive(true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const sub = DeviceEventEmitter.addListener("CharmGuideGroupsRequestClose", () => closeToGuideRef.current());
    return () => sub.remove();
  }, [open]);

  if (!open) return null;

  return (
    <View style={styles.overlay} testID="phase9-guide-groups-drawer">
      <FocusGuide style={styles.drawer} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
        <View style={styles.header}>
          <Ionicons name="albums-outline" size={16} color={tvColors.purpleSoft} />
          <Text style={styles.title}>Channel Groups</Text>
        </View>
        <Text style={styles.hint}>Left: main menu · Right: guide</Text>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {groups.map((item) => (
            <Pressable
              key={item.name}
              ref={(node) => {
                if (node) refs.current.set(item.name, node);
                else refs.current.delete(item.name);
              }}
              focusable
              onPress={item.onPress}
              onLongPress={item.onLongPress}
              delayLongPress={420}
              style={({ focused }: any) => [
                styles.row,
                item.active && styles.activeRow,
                item.pinned && styles.pinnedRow,
                focused && styles.focused,
              ]}
              testID={`phase9-group-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Text numberOfLines={1} style={[styles.name, item.active && styles.activeName]}>{item.name}</Text>
              {item.count != null ? <Text style={styles.count}>{item.count}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      </FocusGuide>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: GUIDE_GROUP_DRAWER_WIDTH,
    zIndex: 90,
    backgroundColor: "rgba(12,7,26,0.98)",
    borderRightWidth: 1,
    borderRightColor: tvColors.border,
  },
  drawer: { flex: 1, paddingHorizontal: 10, paddingVertical: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 3 },
  title: { color: tvColors.text, fontFamily: fonts.bold, fontSize: 15 },
  hint: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, marginBottom: 8 },
  list: { gap: 3, paddingBottom: 18 },
  row: {
    minHeight: 34,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "transparent",
  },
  activeRow: { backgroundColor: "rgba(115,70,195,0.23)" },
  pinnedRow: { borderColor: "rgba(168,132,245,0.22)" },
  focused: { borderColor: tvColors.purpleBright, backgroundColor: "rgba(126,84,218,0.36)" },
  name: { flex: 1, color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 11 },
  activeName: { color: "#fff" },
  count: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9, marginLeft: 6 },
});
