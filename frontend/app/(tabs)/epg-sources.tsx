import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { useStore } from "@/src/store";
import { refreshSource, sourceDiagnostics, sourceStatus, subscribeSource, type SourceDiagnostics } from "@/src/source";
import type { SourceStatus } from "@/src/api";
import { fonts, radius, tvColors } from "@/src/theme";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";

export default function EpgSourcesScreen() {
  const router = useRouter();
  const { refresh } = useStore();
  const [status, setStatus] = useState<SourceStatus>(() => sourceStatus());
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  useTvBackHandler(
    useCallback(() => {
      router.replace("/settings" as any);
      return true;
    }, [router]),
  );

  const load = useCallback(() => {
    setStatus(sourceStatus());
    void sourceDiagnostics().then(setDiagnostics).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    return subscribeSource(load);
  }, [load]);

  const refreshAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      setStatus(await refreshSource(true));
      await refresh(true);
      load();
    } finally {
      setBusy(false);
    }
  }, [busy, load, refresh]);

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>GUIDE CONFIGURATION</Text>
            <Text style={styles.title}>EPG Sources</Text>
          </View>
          <Pressable onPress={() => router.replace("/settings" as any)} style={({ focused }: any) => [styles.back, focused && styles.focused]}>
            <Ionicons name="arrow-back" size={14} color="#fff" />
            <Text style={styles.backText}>Settings</Text>
          </Pressable>
        </View>

        <View style={styles.sourceList}>
          <SourceRow
            title="Primary XMLTV Guide"
            subtitle="Managed by CharmIPTV Â· locked source"
            enabled
            status={status.error ? "Guide error â€” see health" : "Active"}
          />
          <SourceRow
            title="Playlist Channel Map"
            subtitle="Managed by CharmIPTV Â· locked source"
            enabled
            status={`${status.channel_count || 0} channels`}
          />
          <SourceRow
            title="Native EPG Cache"
            subtitle="Complete local-file XMLTV ingest (Android) Â· no JS parser on TV"
            enabled
            status={status.error ? "Unavailable" : `${diagnostics?.programs || 0} cached programs`}
          />
          <SourceRow
            title="Automatic Refresh"
            subtitle="Background source refresh and last-good cache protection"
            enabled
            status={diagnostics?.nextAutoRefresh ? `Next ${dayjs(diagnostics.nextAutoRefresh).format("h:mm A")}` : "Scheduled"}
          />
        </View>

        <View style={styles.health}>
          <Text style={styles.healthTitle}>Source Health</Text>
          <Info label="Channels with EPG" value={String(status.channels_with_epg || 0)} />
          <Info
            label="Match quality"
            value={
              diagnostics?.matchQuality
                ? `${diagnostics.matchQuality.matched} matched Â· ${diagnostics.matchQuality.ambiguous} ambiguous Â· ${diagnostics.matchQuality.unmatched} unmatched`
                : "â€”"
            }
          />
          <Info label="Refresh in progress" value={diagnostics?.refreshInFlight ? "Yes" : "No"} />
          <Info label="Last refresh" value={status.last_refresh ? dayjs(status.last_refresh).format("MMM D, h:mm A") : "Not yet"} />
          <Info
            label="Playlist age"
            value={
              diagnostics?.playlistRefreshedAt
                ? dayjs(diagnostics.playlistRefreshedAt).format("MMM D, h:mm A")
                : "â€”"
            }
          />
          <Info
            label="EPG age"
            value={
              diagnostics?.guideRefreshedAt
                ? dayjs(diagnostics.guideRefreshedAt).format("MMM D, h:mm A")
                : "â€”"
            }
          />
          <Info label="Cache age" value={diagnostics?.cacheAgeMinutes != null ? `${diagnostics.cacheAgeMinutes} min` : "â€”"} />
          {diagnostics?.epgError || status.error ? (
            <Text style={styles.error} testID="epg-sources-error">
              {diagnostics?.epgError || status.error}
            </Text>
          ) : null}
        </View>

        <Pressable disabled={busy} onPress={refreshAll} style={({ focused }: any) => [styles.refresh, busy && styles.disabled, focused && styles.focused]}>
          <Ionicons name="refresh" size={14} color="#fff" />
          <Text style={styles.refreshText}>{busy ? "Refreshingâ€¦" : "Refresh Sources Now"}</Text>
        </Pressable>
      </View>
    </PurpleTvShell>
  );
}

function SourceRow({ title, subtitle, enabled, status }: { title: string; subtitle: string; enabled: boolean; status: string }) {
  return (
    <View style={styles.sourceRow}>
      <View style={styles.sourceIcon}><Ionicons name="server-outline" size={16} color={tvColors.purpleSoft} /></View>
      <View style={styles.sourceCopy}>
        <Text style={styles.sourceTitle}>{title}</Text>
        <Text style={styles.sourceSub}>{subtitle}</Text>
      </View>
      <Text style={styles.sourceStatus}>{status}</Text>
      <View style={[styles.toggle, enabled && styles.toggleOn]}><View style={[styles.knob, enabled && styles.knobOn]} /></View>
      <Ionicons name="lock-closed" size={12} color={tvColors.textMuted} />
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14 },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  back: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  sourceList: { marginTop: 14, gap: 6 },
  sourceRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 11, backgroundColor: tvColors.panel, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.sm },
  sourceIcon: { width: 30, height: 30, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  sourceCopy: { flex: 1, minWidth: 0 },
  sourceTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9.5 },
  sourceSub: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, marginTop: 2 },
  sourceStatus: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 7.5, width: 120, textAlign: "right" },
  toggle: { width: 34, height: 19, borderRadius: 10, backgroundColor: "#343145", padding: 2 },
  toggleOn: { backgroundColor: tvColors.purple },
  knob: { width: 15, height: 15, borderRadius: 8, backgroundColor: "#817D91" },
  knobOn: { alignSelf: "flex-end", backgroundColor: "#fff" },
  health: { marginTop: 10, padding: 11, backgroundColor: tvColors.panelRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line },
  healthTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10.5, marginBottom: 5 },
  infoRow: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  infoLabel: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  infoValue: { color: "#fff", fontFamily: fonts.medium, fontSize: 8 },
  error: { color: "#FCA5A5", fontFamily: fonts.regular, fontSize: 7.5, marginTop: 6 },
  refresh: { alignSelf: "center", minWidth: 250, minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12, backgroundColor: tvColors.purple, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  refreshText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  disabled: { opacity: 0.55 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
