import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { api, SourceStatus } from "@/src/api";
import { useStore } from "@/src/store";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { refresh: refreshGuide } = useStore();
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {}
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doRefresh = async () => {
    setBusy(true);
    try {
      const s = await api.refresh();
      setStatus(s);
      await refreshGuide();
    } catch {}
    setBusy(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.brand}>Configuration</Text>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Source Status</Text>
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
          <Pressable style={styles.refreshBtn} onPress={doRefresh} disabled={busy} testID="settings-refresh-btn">
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.refreshText}>Refresh Now</Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Playlist Source</Text>
          <Text style={styles.sub}>Channels & EPG auto-import from your m3u4u source on every refresh.</Text>
          <Text style={styles.urlLabel}>M3U Playlist</Text>
          <Text style={styles.url} numberOfLines={1}>{status?.m3u_url || "—"}</Text>
          <Text style={styles.urlLabel}>XMLTV EPG</Text>
          <Text style={styles.url} numberOfLines={1}>{status?.epg_url || "—"}</Text>
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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
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
  sub: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 14 },
  statValue: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14 },
  errText: { color: colors.error, fontFamily: fonts.regular, fontSize: 12 },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  refreshText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  urlLabel: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 11, marginTop: spacing.sm },
  url: { color: colors.onSurfaceSecondary, fontFamily: fonts.regular, fontSize: 12 },
});
