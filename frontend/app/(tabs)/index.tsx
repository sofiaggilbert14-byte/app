import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { Channel } from "@/src/api";
import { TimelineGrid } from "@/src/components/TimelineGrid";
import { BoxGrid } from "@/src/components/BoxGrid";

export default function GuideScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    channels,
    windowStart,
    windowEnd,
    loading,
    refreshing,
    error,
    refresh,
    hardRefresh,
    addRecent,
    openProgram,
    favorites,
  } = useStore();
  const now = new Date().toISOString();

  const [mode, setMode] = useState<"timeline" | "box">("timeline");
  const [group, setGroup] = useState<string>("All");

  const groups = useMemo(() => {
    const set = new Set<string>();
    channels.forEach((c: Channel) => c.group && set.add(c.group));
    return ["All", "Favorites", ...Array.from(set).sort()];
  }, [channels]);

  const filtered = useMemo(() => {
    if (group === "All") return channels;
    if (group === "Favorites") return channels.filter((c: Channel) => favorites.includes(c.id));
    return channels.filter((c: Channel) => c.group === group);
  }, [channels, group, favorites]);

  const openChannel = (c: Channel) => {
    Haptics.selectionAsync();
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Charm IPTV</Text>
          <Text style={styles.title}>TV Guide</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={({ focused }: any) => [styles.iconBtn, focused && styles.focusRing]} onPress={() => refresh()} testID="guide-refresh-btn">
            <Ionicons name="refresh" size={18} color={colors.onSurface} />
          </Pressable>
          <View style={styles.toggle}>
            <Pressable
              onPress={() => setMode("timeline")}
              style={({ focused }: any) => [styles.toggleBtn, mode === "timeline" && styles.toggleActive, focused && styles.focusRing]}
              testID="mode-timeline-btn"
            >
              <Ionicons
                name="list"
                size={16}
                color={mode === "timeline" ? "#fff" : colors.onSurfaceTertiary}
              />
            </Pressable>
            <Pressable
              onPress={() => setMode("box")}
              style={({ focused }: any) => [styles.toggleBtn, mode === "box" && styles.toggleActive, focused && styles.focusRing]}
              testID="mode-box-btn"
            >
              <Ionicons
                name="grid"
                size={16}
                color={mode === "box" ? "#fff" : colors.onSurfaceTertiary}
              />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.chipRowWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {groups.map((g) => (
            <Pressable
              key={g}
              onPress={() => setGroup(g)}
              style={({ focused }: any) => [styles.chip, group === g && styles.chipActive, focused && styles.chipFocused]}
              testID={`chip-${g}`}
            >
              <Text style={[styles.chipText, group === g && styles.chipTextActive]}>{g}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading && channels.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} size="large" />
          <Text style={styles.centerText}>Loading channels & guide…</Text>
        </View>
      ) : error && channels.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.centerText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => refresh()} testID="guide-retry-btn">
            <Text style={styles.retryText}>Reload Guide</Text>
          </Pressable>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="tv-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.centerText}>No channels here yet</Text>
        </View>
      ) : mode === "timeline" ? (
        <TimelineGrid
          channels={filtered}
          windowStart={windowStart}
          windowEnd={windowEnd}
          now={now}
          onChannelPress={openChannel}
          onProgramPress={openProgram}
          refreshing={refreshing}
          onRefresh={hardRefresh}
        />
      ) : (
        <BoxGrid
          channels={filtered}
          now={now}
          onChannelPress={openChannel}
          onProgramPress={openProgram}
          refreshing={refreshing}
          onRefresh={hardRefresh}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  brand: { color: colors.brandSecondary, fontFamily: fonts.semibold, fontSize: 12 },
  title: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 28 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggle: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleBtn: { width: 38, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  toggleActive: { backgroundColor: colors.brand },
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" },
  chip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brand },
  chipFocused: { borderColor: "#fff", borderWidth: 2 },
  focusRing: { borderColor: "#fff", borderWidth: 2 },
  chipText: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 13 },
  chipTextActive: { color: colors.onBrandTertiary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  centerText: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 14, textAlign: "center" },
  retryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  retryText: { color: "#fff", fontFamily: fonts.semibold },
});
