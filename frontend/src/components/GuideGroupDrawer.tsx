import React, { useEffect, useMemo, useRef } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import type { PurpleGuideGroup } from "@/src/components/PurpleTvShell";
import { claimRemoteOwner } from "@/src/core/remoteOwnership";
import { addTvKeyListener, setGuideNavigationActive } from "@/src/utils/tvRemote";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { fonts, radius, tvColors } from "@/src/theme";

export const GUIDE_GROUP_DRAWER_WIDTH = 214;

type Props = {
  open: boolean;
  groups: PurpleGuideGroup[];
  onOpenMainDrawer: () => void;
  onCloseToGuide: () => void;
};

export function GuideGroupDrawer({ open, groups, onOpenMainDrawer, onCloseToGuide }: Props) {
  const refs = useRef(new Map<string, unknown>());
  const activeName = useMemo(() => groups.find((group) => group.active)?.name || groups[0]?.name || "", [groups]);

  useEffect(() => {
    if (!open) return;
    const releaseOwner = claimRemoteOwner("GROUP_DRAWER");
    setGuideNavigationActive(false);
    const remoteSub = addTvKeyListener((key) => {
      if (key === "LEFT") onOpenMainDrawer();
      else if (key === "RIGHT") onCloseToGuide();
    });
    const backSub = BackHandler.addEventListener("hardwareBackPress", () => {
      onOpenMainDrawer();
      return true;
    });
    const cancelFocus = requestNativeFocusWithRetry(refs.current.get(activeName), [0, 80, 180, 320]);
    return () => {
      remoteSub();
      backSub.remove();
      cancelFocus?.();
      releaseOwner();
    };
  }, [activeName, onCloseToGuide, onOpenMainDrawer, open]);

  if (!open) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto" testID="guide-groups-drawer">
      <FocusGuide style={styles.drawer} autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
        <View style={styles.header}>
          <Ionicons name="albums-outline" size={15} color={tvColors.purpleSoft} />
          <Text style={styles.title}>Channel Groups</Text>
        </View>
        <Text style={styles.hint}>Left: Main Menu   Right: Guide</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {groups.map((group) => (
            <Pressable
              key={group.name}
              ref={(node) => {
                if (node) refs.current.set(group.name, node);
                else refs.current.delete(group.name);
              }}
              focusable
              hasTVPreferredFocus={group.name === activeName}
              onPress={group.onPress}
              onLongPress={group.onLongPress}
              delayLongPress={420}
              style={({ focused }: any) => [
                styles.row,
                group.active && styles.rowActive,
                group.pinned && styles.rowPinned,
                focused && styles.rowFocused,
              ]}
              testID={`guide-groups-drawer-${group.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Text numberOfLines={1} style={[styles.name, group.active && styles.nameActive]}>{group.name}</Text>
              {group.count ? <Text style={styles.count}>{group.count}</Text> : null}
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
    zIndex: 30,
    backgroundColor: "#0A0916",
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
  },
  drawer: { flex: 1, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 10 },
  header: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 5 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 12 },
  hint: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 7.5, paddingHorizontal: 5, marginBottom: 8 },
  list: { flex: 1 },
  listContent: { gap: 3, paddingBottom: 10 },
  row: {
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  rowActive: { backgroundColor: tvColors.purpleDeep },
  rowPinned: { borderColor: tvColors.lineStrong },
  rowFocused: { borderColor: tvColors.purpleSoft, backgroundColor: tvColors.panelRaised },
  name: { flex: 1, color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9 },
  nameActive: { color: "#fff", fontFamily: fonts.semibold },
  count: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
});
