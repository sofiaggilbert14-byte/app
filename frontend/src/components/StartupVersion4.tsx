import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useStore } from "@/src/store";
import { tvColors } from "@/src/theme";

/** Startup V4 reflects provider state only; there is deliberately no fake timer. */
export function StartupVersion4() {
  const { channels, loading, refreshing, windowStart, windowEnd } = useStore();
  const milestones = useMemo(() => {
    const databaseReady = Number.isFinite(Date.parse(windowStart)) && Number.isFinite(Date.parse(windowEnd));
    const playlistReady = channels.length > 0;
    const epgReady = !loading;
    return [
      { label: "Opening local cache", ready: true },
      { label: "Checking guide database", ready: databaseReady },
      { label: "Loading M3U channels", ready: playlistReady },
      { label: refreshing ? "Refreshing EPG" : "Preparing EPG", ready: epgReady },
    ];
  }, [channels.length, loading, refreshing, windowEnd, windowStart]);

  if (!loading) return null;
  const complete = milestones.filter(item => item.ready).length;
  return (
    <View style={styles.overlay} testID="startup-version-4">
      <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
      <Text style={styles.title}>Charm IPTV</Text>
      <Text style={styles.version}>STARTUP V4 · {complete}/{milestones.length}</Text>
      <View style={styles.track}><View style={[styles.progress, { width: `${complete / milestones.length * 100}%` }]} /></View>
      {milestones.map(item => (
        <View key={item.label} style={styles.row}>
          <Text style={[styles.dot, item.ready && styles.done]}>{item.ready ? "●" : "○"}</Text>
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
  markText: { color: "#fff", fontSize: 30, fontWeight: "800" },
  title: { color: "#fff", fontSize: 22, fontWeight: "700" },
  version: { color: tvColors.purpleSoft, fontSize: 9, letterSpacing: 1.4, marginBottom: 6 },
  track: { width: 240, height: 3, borderRadius: 2, backgroundColor: "#242438", overflow: "hidden", marginBottom: 6 },
  progress: { height: "100%", backgroundColor: tvColors.purpleBright },
  row: { width: 240, flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { color: "#6b6b7c", fontSize: 10 },
  done: { color: tvColors.purpleBright },
  label: { color: "#c9c9d5", fontSize: 10 },
});
