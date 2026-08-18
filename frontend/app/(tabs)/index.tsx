import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { useStore } from "@/src/store";
import { Channel } from "@/src/api";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { fonts, radius, tvColors } from "@/src/theme";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";

function channelSort(a: Channel, b: Channel) {
  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
}

function RecentChannelCard({
  channel,
  now,
  isFocused,
  channelLogos,
  channelNumbers,
  channelNumber,
  onPlay,
}: {
  channel: Channel;
  now: Date;
  isFocused: boolean;
  channelLogos: boolean;
  channelNumbers: boolean;
  channelNumber?: number;
  onPlay: (channel: Channel) => void;
}) {
  const programs = useGuidePrograms(channel.id);
  const current = nowNext(programs.length ? programs : channel.programs, now).current;
  return (
    <Pressable
      onPress={() => onPlay(channel)}
      style={({ focused }: any) => [styles.channelCard, focused && styles.focused]}
      testID={`home-recent-${channel.id}`}
    >
      <View style={styles.channelCardArt}>
        <LinearGradient
          colors={["rgba(124,58,237,0.40)", "rgba(16,16,30,0.96)"]}
          style={StyleSheet.absoluteFill}
        />
        <ChannelLogo name={channel.name} logo={channel.logo} disabled={!isFocused || !channelLogos} size={46} />
      </View>
      <Text numberOfLines={1} style={styles.channelName}>
        {channelNumbers ? `${channelNumber || ""}  ` : ""}{channel.name}
      </Text>
      <Text numberOfLines={1} style={styles.channelProgram}>{current?.title || "Guide information loading…"}</Text>
    </Pressable>
  );
}

export default function LiveTvHomeScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const {
    channels,
    recent,
    lastChannelId,
    channelById,
    addRecent,
    channelLogos,
    channelNumbers,
    hardRefresh,
    patchProgramsForChannelIds,
    loading,
    refreshing,
    error,
    clock24h,
  } = useStore();
  void clock24h;
  const [now, setNow] = useState(() => new Date());
  const [preferInitialFocus, setPreferInitialFocus] = useState(true);

  useEffect(() => {
    if (!isFocused) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [isFocused]);

  useFocusEffect(
    useCallback(() => {
      setPreferInitialFocus(true);
      const timer = setTimeout(() => setPreferInitialFocus(false), 700);
      return () => clearTimeout(timer);
    }, []),
  );

  const channelNumberById = useMemo(() => {
    const result: Record<string, number> = {};
    const sorted = channels.slice();
    sorted.sort(channelSort);
    for (let index = 0; index < sorted.length; index++) result[sorted[index].id] = index + 1;
    return result;
  }, [channels]);

  const heroChannel = useMemo(() => {
    const last = lastChannelId ? channelById(lastChannelId) : null;
    return last || recent[0] || channels[0] || null;
  }, [channelById, channels, lastChannelId, recent]);

  const recentLive = useMemo(() => {
    if (recent.length) return recent.slice(0, 6);
    return channels.slice(0, 6);
  }, [channels, recent]);

  const heroPrograms = useGuidePrograms(heroChannel?.id);
  const heroProgram = useMemo(
    () => (heroChannel ? nowNext(heroPrograms.length ? heroPrograms : heroChannel.programs, now).current : undefined),
    [heroChannel, heroPrograms, now],
  );
  const heroProgress = heroProgram ? progressPct(heroProgram, now) : 0;

  useEffect(() => {
    if (!isFocused || !channels.length) return;
    const idSet = new Set<string>();
    if (heroChannel?.id) idSet.add(heroChannel.id);
    for (const channel of recentLive) if (channel.id) idSet.add(channel.id);
    const ids = Array.from(idSet);
    if (!ids.length) return;
    void patchProgramsForChannelIds(ids, heroChannel?.id ? [heroChannel.id] : ids.slice(0, 1));
  }, [channels.length, heroChannel?.id, isFocused, patchProgramsForChannelIds, recentLive]);

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      addRecent(channel);
      openFullscreenPlayer(router, channel.id);
    },
    [addRecent, router],
  );

  return (
    <PurpleTvShell active="/">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.pageTitle}>CharmIPTV</Text>
            <Text style={styles.eyebrow}>LIVE TELEVISION</Text>
          </View>
          <View style={styles.topRight}>
            <Pressable
              onPress={() => router.replace("/search" as any)}
              style={({ focused }: any) => [styles.searchHit, focused && styles.focused]}
              testID="home-open-search"
            >
              <Ionicons name="search-outline" size={16} color={tvColors.textMuted} />
            </Pressable>
            <Text style={styles.clock}>{fmtTime(now.toISOString())}</Text>
            <View style={styles.statusDot} />
          </View>
        </View>

        <View style={styles.hero}>
          <LinearGradient
            colors={["rgba(124,58,237,0.18)", "rgba(12,10,27,0.80)", "#090914"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroCopy}>
            <Text style={styles.heroLabel}>LAST WATCHED · ON NOW</Text>
            <Text numberOfLines={1} style={styles.heroTitle}>
              {heroChannel?.name || "Choose a channel"}
            </Text>
            <View style={styles.heroMetaRow}>
              <View style={styles.livePill}><Text style={styles.livePillText}>LIVE</Text></View>
              <Text style={styles.heroMeta}>
                {heroProgram
                  ? `${fmtTime(heroProgram.start)}${heroProgram.stop ? ` - ${fmtTime(heroProgram.stop)}` : ""}`
                  : "Loading current programme…"}
              </Text>
            </View>
            <Text numberOfLines={2} style={styles.heroProgram}>
              {heroProgram?.title || "Guide information loading…"}
            </Text>
            <Text numberOfLines={3} style={styles.heroDescription}>
              {heroProgram?.desc || "Select the last-watched channel to resume live TV."}
            </Text>
            <View style={styles.heroProgressTrack}>
              <View style={[styles.heroProgressFill, { width: `${heroProgress}%` }]} />
            </View>
            {heroChannel ? (
              <Pressable
                hasTVPreferredFocus={preferInitialFocus}
                onPress={() => play(heroChannel)}
                style={({ focused }: any) => [styles.primaryButton, focused && styles.focused]}
                testID="home-continue-watching"
              >
                <Ionicons name="play" size={15} color="#fff" />
                <Text style={styles.primaryButtonText}>Watch Last Channel</Text>
              </Pressable>
            ) : (
              <Pressable
                hasTVPreferredFocus={preferInitialFocus}
                onPress={() => void hardRefresh()}
                disabled={loading || refreshing}
                style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
                testID="home-reload-guide"
              >
                <Ionicons name="refresh-outline" size={14} color="#fff" />
                <Text style={styles.secondaryButtonText}>
                  {refreshing || loading ? "Loading…" : error ? "Retry guide load" : "Load channels"}
                </Text>
              </Pressable>
            )}
          </View>

          <Pressable
            disabled={!heroChannel}
            onPress={() => heroChannel && play(heroChannel)}
            style={({ focused }: any) => [styles.heroArtwork, focused && styles.heroArtworkFocused]}
            testID="home-last-channel-logo"
          >
            <View style={styles.heroGlow} />
            {heroChannel ? (
              <ChannelLogo name={heroChannel.name} logo={heroChannel.logo} disabled={!isFocused || !channelLogos} size={118} />
            ) : (
              <Ionicons name="tv-outline" size={72} color={tvColors.purpleSoft} />
            )}
            <Text numberOfLines={1} style={styles.heroArtName}>{heroChannel?.name || "CHARM IPTV"}</Text>
            {heroProgram?.title ? <Text numberOfLines={1} style={styles.heroArtNow}>{heroProgram.title}</Text> : null}
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recently Watched Channels</Text>
          <Text style={styles.sectionHint}>Currently airing on channels you watched</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
          {recentLive.map((channel) => (
            <RecentChannelCard
              key={channel.id}
              channel={channel}
              now={now}
              isFocused={isFocused}
              channelLogos={channelLogos}
              channelNumbers={channelNumbers}
              channelNumber={channelNumberById[channel.id]}
              onPlay={play}
            />
          ))}
        </ScrollView>
      </ScrollView>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 26, gap: 12 },
  topbar: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 1.2, marginTop: 2 },
  pageTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 28 },
  topRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  clock: { color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: tvColors.purpleBright },
  hero: { minHeight: 224, flexDirection: "row", borderRadius: radius.md, borderWidth: 1, borderColor: tvColors.line, overflow: "hidden" },
  heroCopy: { flex: 1.1, padding: 18, justifyContent: "center", alignItems: "flex-start" },
  heroLabel: { color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 0.9 },
  heroTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 22, marginTop: 4, maxWidth: "95%" },
  heroMetaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  livePill: { backgroundColor: tvColors.purple, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  livePillText: { color: "#fff", fontFamily: fonts.bold, fontSize: 7 },
  heroMeta: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 10 },
  heroProgram: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, marginTop: 6, maxWidth: "94%" },
  heroDescription: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9.5, lineHeight: 13, marginTop: 4, maxWidth: "94%" },
  heroProgressTrack: { width: "70%", height: 3, backgroundColor: "rgba(255,255,255,0.12)", marginTop: 8, borderRadius: 2, overflow: "hidden" },
  heroProgressFill: { height: 3, backgroundColor: tvColors.purpleBright },
  primaryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, borderRadius: 6, backgroundColor: tvColors.purple, borderWidth: 2, borderColor: "transparent", marginTop: 11 },
  primaryButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  secondaryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, borderRadius: 6, backgroundColor: tvColors.panelRaised, borderWidth: 2, borderColor: "transparent", marginTop: 8 },
  secondaryButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  searchHit: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  heroArtwork: { flex: 0.9, alignItems: "center", justifyContent: "center", gap: 7, overflow: "hidden", borderWidth: 2, borderColor: "transparent", margin: 8, borderRadius: radius.sm },
  heroArtworkFocused: { borderColor: "#fff", backgroundColor: "rgba(124,58,237,0.16)" },
  heroGlow: { position: "absolute", width: 205, height: 205, borderRadius: 103, backgroundColor: "rgba(124,58,237,0.18)" },
  heroArtName: { color: "#fff", fontFamily: fonts.bold, fontSize: 12, maxWidth: "84%" },
  heroArtNow: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 9, maxWidth: "84%" },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 2 },
  sectionTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  sectionHint: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5 },
  recentRow: { gap: 9, paddingBottom: 2 },
  channelCard: { width: 150, minHeight: 116, backgroundColor: tvColors.panel, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", padding: 7 },
  channelCardArt: { height: 64, borderRadius: 5, overflow: "hidden", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  channelName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9.5 },
  channelProgram: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8.5, marginTop: 2 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});