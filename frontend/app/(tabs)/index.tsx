import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { useStore } from "@/src/store";
import { Channel } from "@/src/api";
import { fonts, radius, tvColors } from "@/src/theme";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { useTvBackToGuide } from "@/src/hooks/use-tv-back-to-guide";

function channelSort(a: Channel, b: Channel) {
  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
}

export default function LiveTvHomeScreen() {
  useTvBackToGuide();
  const router = useRouter();
  const {
    channels,
    recent,
    lastChannelId,
    channelById,
    addRecent,
    channelLogos,
    channelNumbers,
    hardRefresh,
    loading,
    refreshing,
    error,
  } = useStore();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const channelNumberById = useMemo(() => {
    const result: Record<string, number> = {};
    [...channels].sort(channelSort).forEach((channel, index) => {
      result[channel.id] = index + 1;
    });
    return result;
  }, [channels]);

  const heroChannel = useMemo(() => {
    const last = lastChannelId ? channelById(lastChannelId) : null;
    return last || recent.map((item) => channelById(item.id) || item).find(Boolean) || channels[0] || null;
  }, [channelById, channels, lastChannelId, recent]);

  const heroProgram = useMemo(
    () => (heroChannel ? nowNext(heroChannel.programs, now).current : undefined),
    [heroChannel, now],
  );
  const heroProgress = heroProgram ? progressPct(heroProgram, now) : 0;

  const recentLive = useMemo(() => {
    const seen = new Set<string>();
    const list: Channel[] = [];
    for (const item of recent) {
      const live = channelById(item.id) || item;
      if (!live || seen.has(live.id)) continue;
      seen.add(live.id);
      list.push(live);
      if (list.length >= 6) break;
    }
    if (!list.length) {
      for (const channel of channels.slice(0, 6)) list.push(channel);
    }
    return list;
  }, [channelById, channels, recent]);

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      addRecent(channel);
      router.push({ pathname: "/player", params: { channelId: channel.id } });
    },
    [addRecent, router],
  );

  return (
    <PurpleTvShell active="/">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.eyebrow}>LIVE TELEVISION</Text>
            <Text style={styles.pageTitle}>Home</Text>
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
            <Text style={styles.heroLabel}>CURRENTLY WATCHING</Text>
            <Text numberOfLines={1} style={styles.heroTitle}>
              {heroChannel?.name || "Choose a channel"}
            </Text>
            <View style={styles.heroMetaRow}>
              <View style={styles.livePill}><Text style={styles.livePillText}>LIVE</Text></View>
              <Text style={styles.heroMeta}>
                {heroProgram
                  ? `${fmtTime(heroProgram.start)}${heroProgram.stop ? ` - ${fmtTime(heroProgram.stop)}` : ""}`
                  : "Live TV"}
              </Text>
            </View>
            <Text numberOfLines={1} style={styles.heroProgram}>
              {heroProgram?.title || "Ready to watch"}
            </Text>
            <View style={styles.heroProgressTrack}>
              <View style={[styles.heroProgressFill, { width: `${heroProgress}%` }]} />
            </View>
            {heroChannel ? (
              <Pressable
                onPress={() => play(heroChannel)}
                style={({ focused }: any) => [styles.primaryButton, focused && styles.focused]}
                testID="home-continue-watching"
              >
                <Ionicons name="play" size={15} color="#fff" />
                <Text style={styles.primaryButtonText}>Continue Watching</Text>
              </Pressable>
            ) : (
              <Pressable
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

          <View style={styles.heroArtwork}>
            <View style={styles.heroGlow} />
            {heroChannel ? (
              <ChannelLogo name={heroChannel.name} logo={heroChannel.logo} disabled={!channelLogos} size={92} />
            ) : (
              <Ionicons name="tv-outline" size={72} color={tvColors.purpleSoft} />
            )}
            <Text numberOfLines={1} style={styles.heroArtName}>{heroChannel?.name || "CHARM IPTV"}</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recently Watched Channels</Text>
          <Text style={styles.sectionHint}>Pick up where you left off</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
          {recentLive.map((channel) => {
            const current = nowNext(channel.programs, now).current;
            return (
              <Pressable
                key={channel.id}
                onPress={() => play(channel)}
                style={({ focused }: any) => [styles.channelCard, focused && styles.focused]}
                testID={`home-recent-${channel.id}`}
              >
                <View style={styles.channelCardArt}>
                  <LinearGradient
                    colors={["rgba(124,58,237,0.40)", "rgba(16,16,30,0.96)"]}
                    style={StyleSheet.absoluteFill}
                  />
                  <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={46} />
                </View>
                <Text numberOfLines={1} style={styles.channelName}>
                  {channelNumbers ? `${channelNumberById[channel.id] || ""}  ` : ""}{channel.name}
                </Text>
                <Text numberOfLines={1} style={styles.channelProgram}>{current?.title || "Live channel"}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </ScrollView>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 26, gap: 12 },
  topbar: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 1.2 },
  pageTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 20, marginTop: 1 },
  topRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  clock: { color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: tvColors.purpleBright },
  hero: { minHeight: 198, flexDirection: "row", borderRadius: radius.md, borderWidth: 1, borderColor: tvColors.line, overflow: "hidden" },
  heroCopy: { flex: 1.1, padding: 18, justifyContent: "center", alignItems: "flex-start" },
  heroLabel: { color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 0.9 },
  heroTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 25, marginTop: 4, maxWidth: "95%" },
  heroMetaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  livePill: { backgroundColor: tvColors.purple, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  livePillText: { color: "#fff", fontFamily: fonts.bold, fontSize: 7 },
  heroMeta: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 10 },
  heroProgram: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 11, marginTop: 5, maxWidth: "90%" },
  heroProgressTrack: { width: "70%", height: 3, backgroundColor: "rgba(255,255,255,0.12)", marginTop: 8, borderRadius: 2, overflow: "hidden" },
  heroProgressFill: { height: 3, backgroundColor: tvColors.purpleBright },
  primaryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, borderRadius: 6, backgroundColor: tvColors.purple, borderWidth: 2, borderColor: "transparent", marginTop: 11 },
  primaryButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  secondaryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, borderRadius: 6, backgroundColor: tvColors.panelRaised, borderWidth: 2, borderColor: "transparent", marginTop: 8 },
  secondaryButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  searchHit: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  heroArtwork: { flex: 0.9, alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" },
  heroGlow: { position: "absolute", width: 190, height: 190, borderRadius: 95, backgroundColor: "rgba(124,58,237,0.18)" },
  heroArtName: { color: "#fff", fontFamily: fonts.bold, fontSize: 12, maxWidth: "82%" },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 2 },
  sectionTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  sectionHint: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5 },
  recentRow: { gap: 9, paddingBottom: 2 },
  channelCard: { width: 138, minHeight: 112, backgroundColor: tvColors.panel, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", padding: 7 },
  channelCardArt: { height: 64, borderRadius: 5, overflow: "hidden", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  channelName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9.5 },
  channelProgram: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, marginTop: 2 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});