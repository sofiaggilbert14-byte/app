import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, fonts, radius } from "@/src/theme";
import { Channel } from "@/src/api";

const LETTERS = [
  "#",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
];

function letterOf(name: string) {
  const c = (name || "").trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

/**
 * A-Z fast-scroll rail. Maps each present starting letter to the first channel
 * index that begins with it, then jumps the list there. Focusable so it works
 * with a TV remote's D-pad, and tappable/touch-friendly on phones & pointer mode.
 */
export function AZRail({
  channels,
  onSelect,
}: {
  channels: Channel[];
  onSelect: (index: number) => void;
}) {
  const map = useMemo(() => {
    const m: Record<string, number> = {};
    channels.forEach((c, i) => {
      const l = letterOf(c.name);
      if (m[l] === undefined) m[l] = i;
    });
    return m;
  }, [channels]);

  const active = LETTERS.filter((l) => map[l] !== undefined);
  // Nothing meaningful to jump between.
  if (active.length < 3) return null;

  return (
    <View style={styles.rail} pointerEvents="box-none" testID="az-rail">
      <View style={styles.railInner}>
        {active.map((l) => (
          <Pressable
            key={l}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(map[l]);
            }}
            hitSlop={4}
            style={({ focused }: any) => [styles.item, focused && styles.itemFocused]}
            testID={`az-${l}`}
          >
            <Text style={styles.letter}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: "absolute",
    right: 2,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 20,
  },
  railInner: {
    backgroundColor: "rgba(26,26,32,0.82)",
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  item: {
    width: 22,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  itemFocused: {
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: "#fff",
  },
  letter: {
    color: colors.onSurfaceTertiary,
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 13,
  },
});
