import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import type { SourceStatus } from "@/src/api";
import { useStore } from "@/src/store";
import {
  sourceStatus,
  refreshSource,
  subscribeSource,
  sourceDiagnostics,
  clearGuideCache,
  type SourceDiagnostics,
} from "@/src/source";

export default function SettingsScreen() {
  const { refresh: refreshGuide, hardRefresh, refreshing, pointerMode, setPointerMode } = useStore();
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostics | null>(null);

  const loadStatus = useCallback(() => {
    setStatus(sourceStatus());
    sourceDiagnostics().then(setDiagnostics).catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus();
    // Keep stats fresh as the staged parse emits (channels first, then EPG).
    return subscribeSource(loadStatus);
  }, [loadStatus]);

  const doRefresh = async () => {
    setBusy(true);
    Haptics.selectionAsync();
    try {
      const s = await refreshSource();
      setStatus(s);
      await refreshGuide(true);
    } catch {}
    setBusy(false);
  };

  const onPullRefresh = async () => {
    await hardRefresh();
    loadStatus();
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: spacing.md }]}>
        <Text style={styles.brand}>Configuration</Text>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={colors.brand} colors={[colors.brand]} />
        }
      >
        {/* Playlist refresher */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Playlist & EPG</Text>
          {!status ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
          ) : (
            <>
              <Stat label="Channels loaded" value={String(status.channel_count)} />
              <Stat label="Channels with EPG" value={String(status.channels_with_epg)} />
              <Stat
                label="Last refreshed"
                value={status.last_refresh ? dayjs(status.last_refresh).format("MMM D, h:mm A") : "—"}
              />
              {status.error ? <Text style={styles.errText}>Error: {status.error}</Text> : null}
            </>
          )}
          <Pressable style={({ focused }: any) => [styles.primaryBtn, focused && styles.focusRing]} onPress={doRefresh} disabled={busy} testID="settings-refresh-btn">
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.primaryText}>Refresh Playlist Now</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.hint}>
            Channels & guide are fetched and parsed directly on your device — no server required. Pull down to refresh
            anywhere on this screen.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Phoenix Diagnostics</Text>
          <Stat label="Build" value="2.0.0-beta.1" />
          <Stat label="Data mode" value={diagnostics?.mode || "—"} />
          <Stat label="Cached programs" value={String(diagnostics?.programs || 0)} />
          <Stat
            label="Guide cache"
            value={diagnostics ? `${(diagnostics.cacheBytes / 1024 / 1024).toFixed(1)} MB` : "—"}
          />
          <Stat
            label="Cache age"
            value={diagnostics?.cacheAgeMinutes == null ? "—" : `${diagnostics.cacheAgeMinutes} min`}
          />
          <Pressable
            style={({ focused }: any) => [styles.secondaryBtn, focused && styles.focusRing]}
            onPress={async () => {
              await clearGuideCache();
              loadStatus();
            }}
            testID="settings-clear-guide-cache-btn"
          >
            <Ionicons name="trash-outline" size={16} color={colors.onSurface} />
            <Text style={styles.secondaryText}>Clear Guide Cache</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={styles.cardTitle}>Pointer (mouse) mode</Text>
              <Text style={styles.sub}>
                For Android TV / Fire TV boxes where the D-pad focus isn’t reliable. Turns the remote’s
                arrow keys into an on-screen mouse pointer — move with the D-pad and press OK/Select to
                click whatever the pointer is on. Only works on an installed Android TV build.
              </Text>
            </View>
            <Switch
              value={pointerMode}
              onValueChange={setPointerMode}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
              thumbColor="#fff"
              testID="settings-pointer-toggle"
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>About Reminders</Text>
          <Text style={styles.sub}>
            Set reminders from the guide to get a local notification before a program starts, with a tap-to-switch
            action. Scheduled notifications only fire on an installed Android/iOS build — not in the Expo Go preview.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  brand: { color: colors.brandSecondary, fontFamily: fonts.semibold, fontSize: 12 },
  title: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 28 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 16 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sub: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 11, textAlign: "center" },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 14 },
  statValue: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14 },
  errText: { color: colors.error, fontFamily: fonts.medium, fontSize: 12 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  primaryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  secondaryText: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14 },
  focusRing: { borderWidth: 2, borderColor: "#fff" },
});
