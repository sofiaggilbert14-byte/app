import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { fonts, radius, spacing } from "@/src/theme";
import { TV_CALIBRATION_MAX_INSET, TvCalibration, useTvCalibration } from "@/src/tvCalibration";

const STEP = 4;
const RED = "#E3262E";

type Side = keyof TvCalibration;

const SIDES: { side: Side; label: string; hint: string }[] = [
  { side: "left", label: "Left edge", hint: "Move the app inward from the left side." },
  { side: "right", label: "Right edge", hint: "Move the app inward from the right side." },
  { side: "top", label: "Top edge", hint: "Move the app downward from the top." },
  { side: "bottom", label: "Bottom edge", hint: "Move the app upward from the bottom." },
];

export function TvCalibrationControls() {
  const { calibration, setSide, reset } = useTvCalibration();

  if (!Platform.isTV) {
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>TV screen fit</Text>
        <Text style={styles.hint}>Manual overscan calibration is available on Android TV / Fire TV.</Text>
      </View>
    );
  }

  const adjust = (side: Side, delta: number) => {
    void Haptics.selectionAsync().catch(() => {});
    setSide(side, Math.max(0, Math.min(TV_CALIBRATION_MAX_INSET, calibration[side] + delta)));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>TV screen fit / overscan</Text>
          <Text style={styles.hint}>
            If menus or text are cut off by the TV bezel, increase the affected edge until the whole app fits on screen.
          </Text>
        </View>
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync().catch(() => {});
            reset();
          }}
          style={({ focused }: any) => [styles.resetButton, focused && styles.focused]}
          testID="settings-tv-calibration-reset"
        >
          <Ionicons name="refresh" size={17} color="#fff" />
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      </View>

      {SIDES.map(({ side, label, hint }) => (
        <View key={side} style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.hint}>{hint}</Text>
          </View>
          <View style={styles.adjuster}>
            <Pressable
              onPress={() => adjust(side, -STEP)}
              style={({ focused }: any) => [styles.adjustButton, focused && styles.focused]}
              testID={`settings-tv-calibration-${side}-minus`}
            >
              <Ionicons name="remove" size={20} color="#fff" />
            </Pressable>
            <Text style={styles.value}>{calibration[side]} px</Text>
            <Pressable
              onPress={() => adjust(side, STEP)}
              style={({ focused }: any) => [styles.adjustButton, focused && styles.focused]}
              testID={`settings-tv-calibration-${side}-plus`}
            >
              <Ionicons name="add" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 5, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)" },
  note: { gap: 4, paddingVertical: 6 },
  noteTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  headingRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  title: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12.5 },
  hint: { color: "rgba(255,255,255,0.66)", fontFamily: fonts.regular, fontSize: 10, lineHeight: 13 },
  row: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderRadius: radius.sm,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  copy: { flex: 1, paddingRight: spacing.sm },
  label: { color: "#fff", fontFamily: fonts.medium, fontSize: 11.5 },
  adjuster: { alignItems: "center", flexDirection: "row", gap: 6 },
  adjustButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 36,
  },
  value: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11, minWidth: 44, textAlign: "center" },
  resetButton: {
    alignItems: "center",
    backgroundColor: "rgba(227,38,46,0.20)",
    borderColor: RED,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 10,
  },
  resetText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  focused: { borderColor: "#fff", borderWidth: 2 },
});
