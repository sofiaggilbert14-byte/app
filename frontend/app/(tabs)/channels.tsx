import React, { memo, useCallback, useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";

function byName(a: Channel, b: Channel) {
  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
}

const ChannelListRow = memo(function ChannelListRow({
  channel,
  number,
  favorite,
  logos,
  onPlay,
  onFavorite,
}: {
  channel: Channel;
  number: number;
  favorite: boolean;
  logos: boolean;
  onPlay: (channel: Channel) => void;
  onFavorite: (id: string) => void;
}) {
  const now = new Date();
  const current = nowNext(channel.programs, now).current;
  const progress = current ? progressPct(current, now) : 0;
  return (
    <Pressable
      onPress={() => onPlay(channel)}
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
      <Pressable
        focusable={false}
        hitSlop={8}
        onPress={() => onFavorite(channel.id)}
        style={styles.heart}
      >
        <Ionicons name={favorite ? "heart" : "heart-outline"} size={17} color={favorite ? tvColors.purpleBright : tvColors.textMuted} />
      </Pressable>
    </Pressable>
  );
});

export default function ChannelsScreen() {
  const router = useRouter();
  const { channels, favorites, toggleFavorite, addRecent, channelLogos } = useStore();
  const sorted = useMemo(() => [...channels].sort(byName), [channels]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    router.push({ pathname: "/player", params: { channelId: channel.id } });
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
            <Ionicons name="search-outline" size={16} color={tvColors.textMuted} />
          </View>
        </View>
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <ChannelListRow
              channel={item}
              number={index + 1}
              favorite={favoriteSet.has(item.id)}
              logos={channelLogos}
              onPlay={play}
              onFavorite={favorite}
            />
          )}
        />
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
