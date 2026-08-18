import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { fonts, radius, tvColors } from "@/src/theme";
import { addTvKeyListener, setRemoteContext } from "@/src/utils/tvRemote";

/** Consistent, explicit Drawer entry for full-bleed TV pages. */
export function PurpleDrawerButton({ testID }: { testID: string }) {
  const { openDrawer } = usePurpleTvDrawer();
  const [focused, setFocused] = useState(false);
  const open = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    openDrawer({ focusTop: true });
  }, [openDrawer]);

  // Android TV focus can fall off the React tree when Left is pressed from the
  // left-most control. While this explicit edge control owns focus, consume the
  // native LEFT event as a deterministic drawer handoff instead of allowing the
  // platform focus engine to search for a non-existent neighbour.
  useEffect(() => {
    if (!focused) return;
    // Declare this edge explicitly to the Activity-level router. Default TV
    // pages do not mirror raw D-pad events into JS; the native router owns the
    // LEFT boundary and emits exactly one semantic handoff while this control
    // is focused.
    setRemoteContext("drawer_edge");
    const off = addTvKeyListener((key) => {
      if (key === "LEFT") open();
    });
    return () => {
      off();
      setRemoteContext("default");
    };
  }, [focused, open]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Drawer"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={open}
      style={({ focused: isFocused }: any) => [styles.button, isFocused && styles.focused]}
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
