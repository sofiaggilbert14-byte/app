import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { subscribeProgress, type EpgProgress } from "@/src/source";
import { useStore } from "@/src/store";
import { fonts, tvColors } from "@/src/theme";

const INITIAL: EpgProgress = { phase: "idle", ratio: 0, etaSeconds: null, message: null };

/** Real-event startup gate: never sleeps and never waits for a complete XMLTV import. */
export function StartupVersion4() {
  const { channels, loading, windowStart, windowEnd } = useStore();
  const [epg, setEpg] = useState(INITIAL);
  useEffect(() => subscribeProgress(setEpg), []);
  const databaseReady = Number.isFinite(Date.parse(windowStart)) && Number.isFinite(Date.parse(windowEnd));
  const channelsReady = channels.length > 0;
  const epgStarted = epg.phase !== "idle" && epg.phase !== "channels";
  const freshCacheReady = channelsReady && databaseReady && !loading;
  const mayEnter = channelsReady && databaseReady && (epgStarted || freshCacheReady);
  const milestones = useMemo(() => [
    { label: "Opening local cache", ready: databaseReady || channelsReady },
    { label: "Checking guide database", ready: databaseReady },
    { label: `Loading M3U channels${channelsReady ? ` · ${channels.length}` : ""}`, ready: channelsReady },
    { label: epgStarted ? `EPG ${epg.phase}` : freshCacheReady ? "EPG cache is fresh" : "Starting EPG", ready: epgStarted || freshCacheReady },
  ], [channels.length, channelsReady, databaseReady, epg.phase, epgStarted, freshCacheReady]);
  if (mayEnter) return null;
  return (
    <View style={styles.overlay} testID="startup-version-4">
      <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
      <Text style={styles.title}>Charm IPTV</Text>
      <Text style={styles.version}>STARTUP · VERSION 4</Text>
      <View style={styles.dots} accessibilityLabel="Startup milestones">
        {milestones.map((item) => <View key={item.label} style={[styles.dot, item.ready && styles.dotReady]} />)}
      </View>
      {milestones.map((item) => (
        <View key={item.label} style={styles.row}>
          <Text style={[styles.state, item.ready && styles.stateReady]}>{item.ready ? "●" : "○"}</Text>
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
      <ActivityIndicator color={tvColors.purpleBright} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, backgroundColor: "#070711", alignItems: "center", justifyContent: "center", gap: 8 },
  mark: { width: 54, height: 54, borderRadius: 14, backgroundColor: tvColors.purple, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  markText: { color: "#fff", fontFamily: fonts.bold, fontSize: 30 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 22 },
  version: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.4 },
  dots: { width: 240, flexDirection: "row", gap: 8, justifyContent: "center", marginVertical: 5 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: "#686078", backgroundColor: "transparent" },
  dotReady: { borderColor: tvColors.purpleBright, backgroundColor: tvColors.purpleBright },
  row: { width: 240, flexDirection: "row", alignItems: "center", gap: 8 },
  state: { color: "#686078", fontSize: 10 }, stateReady: { color: tvColors.purpleBright },
  label: { color: "#c9c9d5", fontFamily: fonts.medium, fontSize: 10 },
});
