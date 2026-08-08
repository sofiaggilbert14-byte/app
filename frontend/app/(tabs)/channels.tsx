import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";

function byName(a: Channel, b: Channel) {
  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
}

const ChannelListRow = memo(function ChannelListRow({
  channel,
  number,
  favorite,
  logos,
  now,
  onPlay,
  onFavorite,
}: {
  channel: Channel;
  number: number;
  favorite: boolean;
  logos: boolean;
  now: Date;
  onPlay: (channel: Channel) => void;
  onFavorite: (id: string) => void;
}) {
  const current = nowNext(channel.programs, now).current;
  const progress = current ? progressPct(current, now) : 0;
  return (
    <Pressable
      onPress={() => onPlay(channel)}
      onLongPress={() => onFavorite(channel.id)}
      delayLongPress={450}
      style={({ focused }: any) => [styles.row, focused && styles.focused]}
      testID={`purple-channel-${channel.id}`}
    >
      <Text style={styles.number}>{number}</Text>
      <ChannelLogo name={channel.name} logo={channel.logo} disabled={!logos} size={31} />
      <View style={styles.nameBlock}>
        <Text numberOfLines={1} style={styles.channelName}>{channel.name}</Text>
        <Text numberOfLines={1} style={styles.group}>{channel.group || "Live TV"}</Text>
      </View>
      <View style={styles.programBlock}>
        <Text numberOfLines={1} style={styles.program}>{current?.title || "Live channel"}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
      </View>
      <Text style={styles.time}>
        {current ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}` : "LIVE"}
      </Text>
      <View style={styles.heart} pointerEvents="none">
        <Ionicons name={favorite ? "heart" : "heart-outline"} size={17} color={favorite ? tvColors.purpleBright : tvColors.textMuted} />
      </View>
    </Pressable>
  );
});

export default function ChannelsScreen() {
  const router = useRouter();
  const { channels, favorites, toggleFavorite, addRecent, channelLogos, hardRefresh, loading, refreshing, error, clock24h } = useStore();
  void clock24h;
  const sorted = useMemo(() => [...channels].sort(byName), [channels]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    openFullscreenPlayer(router, channel.id);
  }, [addRecent, router]);

  const favorite = useCallback((id: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    toggleFavorite(id);
  }, [toggleFavorite]);

  return (
    <PurpleTvShell active="/channels">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>LIVE TV</Text>
            <Text style={styles.title}>All Channels</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.count}>{sorted.length} channels</Text>
            <Pressable
              onPress={() => router.replace("/search" as any)}
              style={({ focused }: any) => [styles.searchHit, focused && styles.focused]}
              testID="channels-open-search"
            >
              <Ionicons name="search-outline" size={16} color={tvColors.textMuted} />
            </Pressable>
          </View>
        </View>
        {sorted.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No channels loaded</Text>
            <Text style={styles.emptyMessage}>
              {error || "Reload your playlist or open Search once channels are available."}
            </Text>
            <Pressable
              onPress={() => void hardRefresh()}
              disabled={loading || refreshing}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="channels-retry-load"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing || loading ? "Loading…" : "Retry load"}</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id}
            extraData={favorites}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            renderItem={({ item, index }) => (
              <ChannelListRow
                channel={item}
                number={index + 1}
                favorite={favoriteSet.has(item.id)}
                logos={channelLogos}
                now={now}
                onPlay={play}
                onFavorite={favorite}
              />
            )}
          />
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line, paddingBottom: 8 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  count: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  searchHit: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  empty: { flex: 1, alignItems: "flex-start", justifyContent: "center", gap: 8, paddingHorizontal: 4 },
  emptyTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 14 },
  emptyMessage: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 10, maxWidth: 420 },
  retryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, borderRadius: 6, backgroundColor: tvColors.purple, borderWidth: 2, borderColor: "transparent", marginTop: 6 },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  list: { paddingTop: 7, paddingBottom: 20 },
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 2, borderColor: "transparent", borderBottomColor: tvColors.line, paddingHorizontal: 7, borderRadius: radius.sm },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  number: { width: 24, color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 9.5, textAlign: "right" },
  nameBlock: { width: 138, minWidth: 0 },
  channelName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  group: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, marginTop: 2 },
  programBlock: { flex: 1, minWidth: 0, paddingHorizontal: 5 },
  program: { color: "rgba(255,255,255,0.90)", fontFamily: fonts.medium, fontSize: 9.5 },
  progressTrack: { height: 2, backgroundColor: "rgba(255,255,255,0.10)", borderRadius: 1, marginTop: 7, overflow: "hidden" },
  progressFill: { height: 2, backgroundColor: tvColors.purpleBright },
  time: { width: 102, color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, textAlign: "right" },
  heart: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
});
