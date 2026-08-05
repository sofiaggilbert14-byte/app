import React, { useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { fonts, radius, spacing } from "@/src/theme";
import {
  TV_CALIBRATION_MAX_OFFSET,
  TV_CALIBRATION_MIN_OFFSET,
  TvCalibration,
  useTvCalibration,
} from "@/src/tvCalibration";

const STEP = 4;
const MIN_ADJUST_INTERVAL_MS = 90;
const RED = "#E3262E";

type Side = keyof TvCalibration;

const SIDES: { side: Side; label: string; hint: string }[] = [
  { side: "left", label: "Left edge", hint: "Minus stretches left outward. Plus moves the left edge inward." },
  { side: "right", label: "Right edge", hint: "Minus stretches right outward. Plus moves the right edge inward." },
  { side: "top", label: "Top edge", hint: "Minus stretches upward. Plus moves the top edge downward." },
  { side: "bottom", label: "Bottom edge", hint: "Minus stretches downward. Plus moves the bottom edge upward." },
];

function valueLabel(value: number): string {
  if (value < 0) return `${Math.abs(value)} px OUT`;
  if (value > 0) return `${value} px IN`;
  return "FULL";
}

export function TvCalibrationControls() {
  const { draftCalibration, setSide, save, reset, discard, hasChanges } = useTvCalibration();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const lastAdjustAt = useRef(0);

  if (!Platform.isTV) {
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>TV screen fit</Text>
        <Text style={styles.hint}>Manual screen-fit calibration is available on Android TV / Fire TV.</Text>
      </View>
    );
  }

  const adjust = (side: Side, delta: number) => {
    const now = Date.now();
    if (now - lastAdjustAt.current < MIN_ADJUST_INTERVAL_MS) return;
    lastAdjustAt.current = now;
    setSaved(false);
    void Haptics.selectionAsync().catch(() => {});
    const next = Math.max(
      TV_CALIBRATION_MIN_OFFSET,
      Math.min(TV_CALIBRATION_MAX_OFFSET, draftCalibration[side] + delta),
    );
    setSide(side, next);
  };

  const applyChanges = async () => {
    if (!hasChanges || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save();
      setSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>TV screen fit / overscan</Text>
          <Text style={styles.hint}>
            Default is full screen. Use minus to stretch an edge farther outward or plus to move an edge inward. Reset returns all four edges to the normal full-screen frame.
          </Text>
        </View>
        <Pressable
          onPress={() => {
            if (savingRef.current) return;
            setSaved(false);
            void Haptics.selectionAsync().catch(() => {});
            reset();
          }}
          style={({ focused }: any) => [styles.resetButton, focused && styles.focused]}
          testID="settings-tv-calibration-reset"
        >
          <Ionicons name="expand-outline" size={17} color="#fff" />
          <Text style={styles.resetText}>Reset Full</Text>
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
            <Text style={styles.value}>{valueLabel(draftCalibration[side])}</Text>
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

      <View style={styles.actions}>
        <Pressable
          disabled={!hasChanges || saving}
          onPress={() => {
            if (savingRef.current) return;
            setSaved(false);
            discard();
            void Haptics.selectionAsync().catch(() => {});
          }}
          style={({ focused }: any) => [
            styles.secondaryButton,
            (!hasChanges || saving) && styles.disabled,
            focused && styles.focused,
          ]}
          testID="settings-tv-calibration-discard"
        >
          <Text style={styles.secondaryText}>Discard</Text>
        </Pressable>
        <Pressable
          disabled={!hasChanges || saving}
          onPress={() => void applyChanges()}
          style={({ focused }: any) => [
            styles.saveButton,
            (!hasChanges || saving) && styles.disabled,
            focused && styles.focused,
          ]}
          testID="settings-tv-calibration-save"
        >
          <Ionicons name={saved ? "checkmark-circle" : "save-outline"} size={18} color="#fff" />
          <Text style={styles.saveText}>{saving ? "Saving…" : saved ? "Applied" : "Save & Apply"}</Text>
        </Pressable>
      </View>
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
  value: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10, minWidth: 68, textAlign: "center" },
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
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  secondaryButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 14,
  },
  secondaryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  saveButton: {
    alignItems: "center",
    backgroundColor: RED,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 36,
    minWidth: 126,
    paddingHorizontal: 14,
  },
  saveText: { color: "#fff", fontFamily: fonts.bold, fontSize: 11 },
  disabled: { opacity: 0.45 },
  focused: { borderColor: "#fff", borderWidth: 2 },
});
