import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
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
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { nowNext, fmtTime } from "@/src/utils/time";
import dayjs from "dayjs";

function byChannelName(a: Channel, b: Channel): number {
  return (a.name || "").localeCompare(b.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

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
    selectedDate,
    setSelectedDate,
    lastChannelId,
  } = useStore();
  const now = new Date().toISOString();

  const isTV = Platform.isTV;
  const [mode, setMode] = useState<"timeline" | "box">(isTV ? "timeline" : "box");
  const [group, setGroup] = useState<string>("All");

  const groups = useMemo(() => {
    const set = new Set<string>();
    channels.forEach((c: Channel) => c.group && set.add(c.group));
    return ["All", "Favorites", ...Array.from(set).sort()];
  }, [channels]);

  const filtered = useMemo(() => {
    const list =
      group === "All"
        ? channels
        : group === "Favorites"
          ? channels.filter((c: Channel) => favorites.includes(c.id))
          : channels.filter((c: Channel) => c.group === group);
    return [...list].sort(byChannelName);
  }, [channels, group, favorites]);

  const previewChannel = useMemo(() => {
    const last = lastChannelId ? channels.find((c) => c.id === lastChannelId) : null;
    return last || filtered.find((c) => c.programs?.length) || filtered[0] || null;
  }, [channels, filtered, lastChannelId]);

  const preview = useMemo(
    () => (previewChannel ? nowNext(previewChannel.programs, new Date(now)) : { current: null, next: null }),
    [previewChannel, now],
  );

  const openChannel = (c: Channel) => {
    void Haptics.selectionAsync().catch(() => {});
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerActions}>
          <Pressable style={({ focused }: any) => [styles.iconBtn, focused && styles.focusRing]} onPress={() => hardRefresh()} testID="guide-refresh-btn">
            <Ionicons name="refresh" size={18} color={colors.onSurface} />
          </Pressable>
          <Pressable
            style={({ focused }: any) => [styles.nowBtn, focused && styles.focusRing]}
            onPress={() => setSelectedDate(dayjs().format("YYYY-MM-DD"))}
            testID="guide-jump-now-btn"
          >
            <Ionicons name="time-outline" size={17} color={colors.onSurface} />
            <Text style={styles.nowBtnText}>Now</Text>
          </Pressable>
          <Pressable
            style={({ focused }: any) => [styles.nowBtn, focused && styles.focusRing]}
            onPress={() => setSelectedDate(dayjs(selectedDate).subtract(1, "day").format("YYYY-MM-DD"))}
            testID="guide-prev-day-btn"
          >
            <Ionicons name="play-back" size={16} color={colors.onSurface} />
            <Text style={styles.nowBtnText}>Prev Day</Text>
          </Pressable>
          <Pressable
            style={({ focused }: any) => [styles.nowBtn, focused && styles.focusRing]}
            onPress={() => setSelectedDate(dayjs(selectedDate).add(1, "day").format("YYYY-MM-DD"))}
            testID="guide-next-day-btn"
          >
            <Ionicons name="play-forward" size={16} color={colors.onSurface} />
            <Text style={styles.nowBtnText}>Next Day</Text>
          </Pressable>
          {lastChannelId && (
            <Pressable
              style={({ focused }: any) => [styles.nowBtn, focused && styles.focusRing]}
              onPress={() => {
                const last = channels.find((c) => c.id === lastChannelId);
                if (last) openChannel(last);
              }}
              testID="guide-resume-channel-btn"
            >
              <Ionicons name="play" size={16} color={colors.brandSecondary} />
              <Text style={styles.nowBtnText}>Resume</Text>
            </Pressable>
          )}
          {isTV ? (
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
          ) : null}
        </View>
        {previewChannel && (
          <Pressable
            style={({ focused }: any) => [styles.previewCard, focused && styles.focusRing]}
            onPress={() => openChannel(previewChannel)}
            testID="guide-preview-card"
          >
            <ChannelLogo name={previewChannel.name} logo={previewChannel.logo} size={42} />
            <View style={styles.previewTextWrap}>
              <Text style={styles.previewKicker}>Live preview</Text>
              <Text numberOfLines={1} style={styles.previewChannel}>
                {previewChannel.name}
              </Text>
              <Text numberOfLines={1} style={styles.previewNow}>
                {preview.current ? `Now: ${preview.current.title}` : "No current program info"}
              </Text>
              {preview.next && (
                <Text numberOfLines={1} style={styles.previewNext}>
                  Next {fmtTime(preview.next.start)}: {preview.next.title}
                </Text>
              )}
            </View>
            <Ionicons name="play-circle" size={28} color={colors.brandSecondary} />
          </Pressable>
        )}
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

      <EpgProgressBar />

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
      ) : (
        // Focus trap: keeps the D-pad inside the guide grid (incl. the A-Z rail)
        // so it can't accidentally jump out of the virtualized list to the tabs.
        <FocusGuide style={styles.gridArea} autoFocus trapFocusLeft trapFocusRight>
          {mode === "timeline" ? (
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
        </FocusGuide>
      )}

      <View style={[styles.footerTitles, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Text style={styles.footerBrand}>Charm IPTV</Text>
        <Text style={styles.footerTitle}>TV Guide</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  gridArea: { flex: 1 },
  header: {
    flexDirection: "column",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  brand: { color: colors.brandSecondary, fontFamily: fonts.semibold, fontSize: 12 },
  title: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 28 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  headerTitles: { marginTop: spacing.xs },
  previewCard: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#14141A",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewTextWrap: { flex: 1, minWidth: 0 },
  previewKicker: {
    color: colors.brandSecondary,
    fontFamily: fonts.semibold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  previewChannel: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 15, marginTop: 1 },
  previewNow: { color: colors.onSurfaceSecondary, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  previewNext: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 11, marginTop: 1 },
  footerTitles: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 6,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerBrand: { color: colors.brandSecondary, fontFamily: fonts.semibold, fontSize: 12 },
  footerTitle: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 18 },
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
  nowBtn: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nowBtnText: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 12 },
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
