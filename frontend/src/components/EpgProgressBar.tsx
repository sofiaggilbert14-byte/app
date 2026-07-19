import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";

function fmtEta(s: number | null): string {
  if (s == null || !isFinite(s) || s <= 0) return "";
  const sec = Math.max(1, Math.round(s));
  if (sec < 60) return `~${sec}s left`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `~${m}m ${r.toString().padStart(2, "0")}s left`;
}

/**
 * Thin status bar under the guide header showing live EPG download → parse
 * progress with an ETA. Auto-hides once the guide is ready.
 */
export function EpgProgressBar() {
  const { epgProgress } = useStore();
  const { phase, ratio, etaSeconds } = epgProgress;
  const w = useRef(new Animated.Value(0)).current;

  const visible =
    phase === "channels" || phase === "downloading" || phase === "parsing" || phase === "error";

  useEffect(() => {
    Animated.timing(w, {
      toValue: Math.max(0.03, Math.min(1, ratio)),
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [ratio, w]);

  if (!visible) return null;

  const isErr = phase === "error";
  const label = isErr
    ? "Guide unavailable — showing channels only"
    : phase === "parsing"
      ? "Building TV guide…"
      : "Downloading TV guide…";
  const pct = isErr ? "" : `${Math.round(Math.min(1, ratio) * 100)}%`;
  const eta = isErr ? "" : fmtEta(etaSeconds);

  return (
    <View style={styles.wrap} testID="epg-progress-bar">
      <View style={styles.row}>
        <Text style={[styles.label, isErr && styles.err]} numberOfLines={1}>
          {label}
        </Text>
        {!isErr && (
          <Text style={styles.meta}>
            {pct}
            {eta ? `  ·  ${eta}` : ""}
          </Text>
        )}
      </View>
      {!isErr && (
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              { width: w.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.medium,
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  err: { color: colors.onSurfaceTertiary },
  meta: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 11 },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.brand },
});
