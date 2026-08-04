import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { TimelineGrid } from "@/src/components/TimelineGrid";
import { BoxGrid } from "@/src/components/BoxGrid";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, StreamStatus } from "@/src/components/StreamPlayer";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";

const BASE_GROUPS = ["All", "Favorites", "Recently Watched", "Sports", "News", "Movies", "Kids", "Music"];

function byName(a: Channel, b: Channel) {
  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
}

function matches(channel: Channel, group: string) {
  const value = `${channel.group || ""} ${channel.name || ""}`.toLowerCase();
  if (group === "Sports") return /sport|nfl|nba|mlb|nhl|ufc|espn/.test(value);
  if (group === "News") return /news|weather|cnn|fox|msnbc|bbc|cnbc/.test(value);
  if (group === "Movies") return /movie|cinema|film|vod/.test(value);
  if (group === "Kids") return /kid|family|cartoon|nick|disney/.test(value);
  if (group === "Music") return /music|mtv|vh1|radio|hits/.test(value);
  return channel.group === group;
}

export default function PurpleGuideScreen() {
  const router = useRouter();
  const {
    channels,
    windowStart,
    windowEnd,
    loading,
    refreshing,
    error,
    hardRefresh,
    addRecent,
    openProgram,
    favorites,
    recent,
    lastChannelId,
    toggleFavorite,
    guideLayout,
    guideDensity,
    safePreviewMode,
    channelNumbers,
    channelLogos,
  } = useStore();

  const [now, setNow] = useState(() => new Date().toISOString());
  const [group, setGroup] = useState("All");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [resetToken, setResetToken] = useState(0);
  const metadataTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (metadataTimer.current) clearTimeout(metadataTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    [],
  );

  const groups = useMemo(() => {
    const known = new Set(BASE_GROUPS);
    const extras = Array.from(new Set(channels.map((c) => c.group).filter(Boolean) as string[]))
      .filter((item) => !known.has(item))
      .slice(0, 8);
    return [...BASE_GROUPS, ...extras].filter((item) => {
      if (item === "All") return true;
      if (item === "Favorites") return favorites.length > 0;
      if (item === "Recently Watched") return recent.length > 0;
      return channels.some((channel) => matches(channel, item));
    });
  }, [channels, favorites.length, recent.length]);

  const filtered = useMemo(() => {
    let list: Channel[];
    if (group === "All") list = channels;
    else if (group === "Favorites") list = channels.filter((c) => favorites.includes(c.id));
    else if (group === "Recently Watched") {
      list = recent.map((item) => channels.find((c) => c.id === item.id) || item).filter(Boolean) as Channel[];
    } else list = channels.filter((c) => matches(c, group));
    return [...list].sort(byName);
  }, [channels, favorites, group, recent]);

  const channelNumberById = useMemo(() => {
    const result: Record<string, number> = {};
    [...channels].sort(byName).forEach((channel, index) => {
      result[channel.id] = index + 1;
    });
    return result;
  }, [channels]);

  const previewChannel = useMemo(() => {
    const focused = focusedId ? filtered.find((c) => c.id === focusedId) : null;
    if (focused) return focused;
    const last = lastChannelId ? filtered.find((c) => c.id === lastChannelId) : null;
    return last || filtered.find((c) => c.programs?.length) || filtered[0] || null;
  }, [filtered, focusedId, lastChannelId]);

  const current = useMemo(
    () => (previewChannel ? nowNext(previewChannel.programs, new Date(now)).current : undefined),
    [now, previewChannel],
  );
  const progress = current ? progressPct(current, new Date(now)) : 0;
  const previewVisible =
    safePreviewMode !== "off" &&
    !!previewChannel?.url &&
    previewId === previewChannel.id &&
    previewStatus !== "error";

  const previewDelay = safePreviewMode === "delayed" ? 1200 : 700;

  useEffect(() => {
    if (!previewChannel?.id || !previewChannel.url || safePreviewMode === "off") {
      setPreviewId(null);
      return;
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    const id = previewChannel.id;
    previewTimer.current = setTimeout(() => setPreviewId(id), previewDelay);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [previewChannel?.id, previewChannel?.url, previewDelay, safePreviewMode]);

  const onFocusChannel = useCallback(
    (channel: Channel) => {
      if (metadataTimer.current) clearTimeout(metadataTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
      metadataTimer.current = setTimeout(() => {
        setFocusedId(channel.id);
        setPreviewStatus("loading");
        if (safePreviewMode === "off") {
          setPreviewId(null);
          return;
        }
        previewTimer.current = setTimeout(() => setPreviewId(channel.id), previewDelay);
      }, 90);
    },
    [previewDelay, safePreviewMode],
  );

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      addRecent(channel);
      router.push({ pathname: "/player", params: { channelId: channel.id } });
    },
    [addRecent, router],
  );

  const chooseGroup = useCallback((next: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setGroup(next);
    setFocusedId(null);
    setPreviewId(null);
    setResetToken((value) => value + 1);
  }, []);

  return (
    <PurpleTvShell active="/guide">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>TV GUIDE</Text>
            <Text style={styles.title}>{group === "All" ? "All Channels" : group}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupRow}>
            {groups.map((item) => (
              <Pressable
                key={item}
                onPress={() => chooseGroup(item)}
                style={({ focused }: any) => [
                  styles.groupChip,
                  group === item && styles.groupChipActive,
                  focused && styles.focused,
                ]}
              >
                <Text style={[styles.groupText, group === item && styles.groupTextActive]}>
                  {item === "Recently Watched" ? "Recent" : item}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={hardRefresh} style={({ focused }: any) => [styles.refresh, focused && styles.focused]}>
            <Ionicons name="refresh" size={15} color="#fff" />
          </Pressable>
        </View>

        <EpgProgressBar />

        {loading && channels.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={tvColors.purpleBright} size="large" />
            <Text style={styles.centerText}>Loading channels and guide…</Text>
          </View>
        ) : error && channels.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={32} color={tvColors.purpleSoft} />
            <Text style={styles.centerText}>{error}</Text>
          </View>
        ) : (
          <View style={styles.body}>
            <FocusGuide style={styles.gridPanel} autoFocus trapFocusUp trapFocusDown>
              {guideLayout === "compact" ? (
                <BoxGrid
                  channels={filtered}
                  now={now}
                  onChannelPress={play}
                  onProgramPress={openProgram}
                  onChannelFocus={onFocusChannel}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={channelLogos}
                  resetToken={resetToken}
                />
              ) : (
                <TimelineGrid
                  channels={filtered}
                  windowStart={windowStart}
                  windowEnd={windowEnd}
                  now={now}
                  onChannelPress={play}
                  onProgramPress={openProgram}
                  onChannelFocus={onFocusChannel}
                  onChannelLongPress={(channel) => toggleFavorite(channel.id)}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  density={guideDensity}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={channelLogos}
                  resetToken={resetToken}
                  active
                />
              )}
            </FocusGuide>

            <View style={styles.detailsPanel}>
              <View style={styles.preview} pointerEvents="none">
                {previewVisible && previewChannel ? (
                  <ErrorBoundary fallback={() => null}>
                    <StreamPlayer
                      key={`purple-guide-preview-${previewChannel.id}`}
                      uri={previewChannel.url}
                      onStatus={setPreviewStatus}
                      style={StyleSheet.absoluteFill}
                    />
                  </ErrorBoundary>
                ) : (
                  <View style={styles.previewFallback}>
                    {previewChannel ? (
                      <ChannelLogo name={previewChannel.name} logo={previewChannel.logo} disabled={!channelLogos} size={64} />
                    ) : (
                      <Ionicons name="tv-outline" size={44} color={tvColors.purpleSoft} />
                    )}
                  </View>
                )}
                <View style={styles.liveTag}><Text style={styles.liveTagText}>LIVE PREVIEW</Text></View>
              </View>

              <View style={styles.detailsCopy}>
                <Text numberOfLines={1} style={styles.channelName}>
                  {previewChannel
                    ? `${channelNumbers ? `${channelNumberById[previewChannel.id] || ""}  ` : ""}${previewChannel.name}`
                    : "Select a channel"}
                </Text>
                <Text numberOfLines={2} style={styles.programTitle}>{current?.title || "No program information"}</Text>
                <Text style={styles.timeText}>
                  {current
                    ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}`
                    : "Guide information will appear here"}
                </Text>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
                <Text style={styles.descLabel}>ABOUT</Text>
                <Text numberOfLines={6} style={styles.description}>
                  {current?.desc || "Move through the guide to preview a channel and read its current program description."}
                </Text>
                <View style={styles.actions}>
                  <Pressable
                    disabled={!previewChannel}
                    onPress={() => previewChannel && play(previewChannel)}
                    style={({ focused }: any) => [styles.watchButton, focused && styles.focused]}
                  >
                    <Ionicons name="play" size={14} color="#fff" />
                    <Text style={styles.watchText}>Watch Now</Text>
                  </Pressable>
                  <Pressable
                    disabled={!previewChannel}
                    onPress={() => previewChannel && toggleFavorite(previewChannel.id)}
                    style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
                  >
                    <Ionicons
                      name={previewChannel && favorites.includes(previewChannel.id) ? "heart" : "heart-outline"}
                      size={14}
                      color={tvColors.purpleSoft}
                    />
                    <Text style={styles.secondaryText}>Favorite</Text>
                  </Pressable>
                </View>
                {current?.stop ? (
                  <Text style={styles.remaining}>{Math.max(0, dayjs(current.stop).diff(dayjs(), "minute"))} min remaining</Text>
                ) : null}
              </View>
            </View>
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 12, gap: 5 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 17, marginTop: 1, minWidth: 120 },
  groupRow: { gap: 5, alignItems: "center", paddingHorizontal: 4 },
  groupChip: { minHeight: 28, paddingHorizontal: 10, justifyContent: "center", borderRadius: 6, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  groupChipActive: { backgroundColor: tvColors.purple },
  groupText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  groupTextActive: { color: "#fff", fontFamily: fonts.semibold },
  refresh: { width: 34, height: 30, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  body: { flex: 1, flexDirection: "row", gap: 8, minHeight: 0 },
  gridPanel: { flex: 1.9, minWidth: 0, overflow: "hidden", backgroundColor: tvColors.canvasRaised, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.sm },
  detailsPanel: { flex: 0.78, minWidth: 228, maxWidth: 340, backgroundColor: tvColors.panel, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line, overflow: "hidden" },
  preview: { height: "42%", minHeight: 128, backgroundColor: "#05050B", overflow: "hidden" },
  previewFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  liveTag: { position: "absolute", left: 8, bottom: 8, backgroundColor: "rgba(124,58,237,0.92)", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  liveTagText: { color: "#fff", fontFamily: fonts.bold, fontSize: 7 },
  detailsCopy: { flex: 1, padding: 11 },
  channelName: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 9 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 16, lineHeight: 19, marginTop: 4 },
  timeText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5, marginTop: 4 },
  progressTrack: { height: 3, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 2, overflow: "hidden", marginTop: 7 },
  progressFill: { height: 3, backgroundColor: tvColors.purpleBright },
  descLabel: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 0.8, marginTop: 9 },
  description: { color: "rgba(255,255,255,0.82)", fontFamily: fonts.regular, fontSize: 9.5, lineHeight: 13.5, marginTop: 3 },
  actions: { flexDirection: "row", gap: 6, marginTop: 10 },
  watchButton: { flex: 1, minHeight: 31, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: tvColors.purple, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  watchText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8.5 },
  secondaryButton: { flex: 1, minHeight: 31, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: tvColors.panelRaised, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  secondaryText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  remaining: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, marginTop: 6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  centerText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 11 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
