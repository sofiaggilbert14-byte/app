import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { fonts, radius, tvColors } from "@/src/theme";

/** Consistent, explicit Drawer entry for full-bleed TV pages. */
export function PurpleDrawerButton({ testID }: { testID: string }) {
  const { openDrawer } = usePurpleTvDrawer();
  const open = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    openDrawer({ focusTop: true });
  }, [openDrawer]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Drawer"
      onPress={open}
      style={({ focused }: any) => [styles.button, focused && styles.focused]}
      testID={testID}
    >
      <Ionicons name="menu-outline" size={14} color="#fff" />
      <Text style={styles.text}>Drawer</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panel,
  },
  focused: {
    borderColor: "#fff",
    backgroundColor: tvColors.purpleDeep,
  },
  text: {
    color: "#fff",
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
});
