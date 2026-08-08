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

const FavoriteRow = memo(function FavoriteRow({
  channel,
  number,
  logos,
  now,
  inFolder,
  folderMode,
  onPlay,
  onLongPress,
}: {
  channel: Channel;
  number: number;
  logos: boolean;
  now: Date;
  inFolder: boolean;
  folderMode: boolean;
  onPlay: (channel: Channel) => void;
  onLongPress: (id: string) => void;
}) {
  const current = nowNext(channel.programs, now).current;
  const progress = current ? progressPct(current, now) : 0;
  return (
    <Pressable
      onPress={() => onPlay(channel)}
      onLongPress={() => onLongPress(channel.id)}
      delayLongPress={450}
      style={({ focused }: any) => [styles.row, focused && styles.focused]}
    >
      <Text style={styles.number}>{number}</Text>
      <ChannelLogo name={channel.name} logo={channel.logo} disabled={!logos} size={30} />
      <Text numberOfLines={1} style={styles.name}>{channel.name}</Text>
      <View style={styles.programBlock}>
        <Text numberOfLines={1} style={styles.program}>{current?.title || "Live channel"}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
      </View>
      <Text style={styles.time}>{current ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}` : "LIVE"}</Text>
      <View style={styles.heart} pointerEvents="none">
        {folderMode ? (
          <Ionicons
            name={inFolder ? "checkmark-circle" : "ellipse-outline"}
            size={17}
            color={inFolder ? tvColors.purpleBright : tvColors.textMuted}
          />
        ) : (
          <Ionicons name="heart" size={17} color={tvColors.purpleBright} />
        )}
      </View>
    </Pressable>
  );
});

export default function FavoritesScreen() {
  const router = useRouter();
  const {
    channels,
    favorites,
    toggleFavorite,
    addRecent,
    channelLogos,
    favoriteFolders,
    addFavoriteFolder,
    toggleFavoriteFolderChannel,
    removeFavoriteFolder,
  } = useStore();
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [folderId, setFolderId] = useState<string | "all">("all");
  const folderMode = folderId !== "all";
  const folderMemberSet = useMemo(() => {
    if (!folderMode) return null;
    const folder = favoriteFolders.find((f) => f.id === folderId);
    return new Set(folder?.channelIds || []);
  }, [favoriteFolders, folderId, folderMode]);

  // Always list all favorites so a selected folder can assign members (long-press).
  // When browsing a folder, members sort first.
  const items = useMemo(() => {
    const all = [...channels].filter((c) => favoriteSet.has(c.id)).sort(byName);
    if (!folderMemberSet) return all;
    return [...all].sort((a, b) => {
      const aIn = folderMemberSet.has(a.id) ? 0 : 1;
      const bIn = folderMemberSet.has(b.id) ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return byName(a, b);
    });
  }, [channels, favoriteSet, folderMemberSet]);
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

  const onLongPress = useCallback((id: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (folderMode) toggleFavoriteFolderChannel(folderId, id);
    else toggleFavorite(id);
  }, [folderId, folderMode, toggleFavorite, toggleFavoriteFolderChannel]);

  return (
    <PurpleTvShell active="/favorites">
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>MY CHANNELS</Text>
            <View style={styles.titleRow}>
              <Text style={styles.title}>All Favorites</Text>
              <Text numberOfLines={2} style={styles.addHint}>
                {folderMode
                  ? "Long-press a channel to add or remove it from this folder. Press plays."
                  : "Long-press removes a favorite. Select a folder, then long-press to assign."}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.count}>
              {folderMode && folderMemberSet
                ? `${folderMemberSet.size} in folder · ${items.length} favorites`
                : `${items.length} favorites`}
            </Text>
            <Ionicons name="search-outline" size={15} color={tvColors.textMuted} />
          </View>
        </View>

        <View style={styles.folderRow}>
          <Pressable onPress={() => setFolderId("all")} style={({ focused }: any) => [styles.folderChip, folderId === "all" && styles.folderActive, focused && styles.focused]}>
            <Text style={styles.folderText}>All</Text>
          </Pressable>
          {favoriteFolders.map((folder) => (
            <Pressable
              key={folder.id}
              onPress={() => setFolderId(folder.id)}
              onLongPress={() => {
                if (folderId === folder.id) setFolderId("all");
                removeFavoriteFolder(folder.id);
              }}
              style={({ focused }: any) => [styles.folderChip, folderId === folder.id && styles.folderActive, focused && styles.focused]}
            >
              <Text style={styles.folderText}>{folder.name}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              const created = addFavoriteFolder(`Folder ${favoriteFolders.length + 1}`);
              if (created) setFolderId(created.id);
            }}
            style={({ focused }: any) => [styles.folderChip, focused && styles.focused]}
          >
            <Text style={styles.folderText}>+ Folder</Text>
          </Pressable>
        </View>

        {items.length ? (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews={false}
            contentContainerStyle={styles.list}
            renderItem={({ item, index }) => (
              <FavoriteRow
                channel={item}
                number={index + 1}
                logos={channelLogos}
                now={now}
                folderMode={folderMode}
                inFolder={!!folderMemberSet?.has(item.id)}
                onPlay={play}
                onLongPress={onLongPress}
              />
            )}
          />
        ) : (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="heart-outline" size={28} color={tvColors.purpleSoft} /></View>
            <Text style={styles.emptyTitle}>No favorites yet</Text>
            <Text style={styles.emptyText}>Long-press a channel in the guide or Channels list to add one.</Text>
            <Pressable onPress={() => router.replace("/guide" as any)} style={({ focused }: any) => [styles.guideButton, focused && styles.focused]}>
              <Text style={styles.guideText}>Open TV Guide</Text>
            </Pressable>
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14 },
  header: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line, gap: 14 },
  headerCopy: { flex: 1, minWidth: 0 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  addHint: { flex: 1, maxWidth: 360, color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, lineHeight: 10.5, marginTop: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  count: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  folderRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 10, paddingBottom: 4 },
  folderChip: { minHeight: 28, justifyContent: "center", paddingHorizontal: 12, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  folderActive: { borderColor: tvColors.purpleBright, backgroundColor: tvColors.purpleDeep },
  folderText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  list: { paddingTop: 7, paddingBottom: 20 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 7, borderWidth: 2, borderColor: "transparent", borderBottomColor: tvColors.line, borderRadius: radius.sm },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  number: { width: 22, color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 9, textAlign: "right" },
  name: { width: 135, color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  programBlock: { flex: 1, minWidth: 0 },
  program: { color: "rgba(255,255,255,0.9)", fontFamily: fonts.medium, fontSize: 9.5 },
  track: { height: 2, backgroundColor: "rgba(255,255,255,0.10)", borderRadius: 1, overflow: "hidden", marginTop: 7 },
  fill: { height: 2, backgroundColor: tvColors.purpleBright },
  time: { width: 104, color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, textAlign: "right" },
  heart: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  emptyTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  emptyText: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, textAlign: "center" },
  guideButton: { minHeight: 32, justifyContent: "center", paddingHorizontal: 14, borderRadius: 5, backgroundColor: tvColors.purple, borderWidth: 2, borderColor: "transparent", marginTop: 4 },
  guideText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
});
