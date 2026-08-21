import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { PurpleDrawerButton } from "@/src/components/PurpleDrawerButton";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { useChannelCustomize } from "@/src/core/channelCustomize";
import { fonts, radius, tvColors } from "@/src/theme";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { addTvLongPressListener } from "@/src/utils/tvRemote";

const ChannelListRow = memo(function ChannelListRow({
  channel,
  number,
  favorite,
  logos,
  now,
  editMode,
  canMoveUp,
  canMoveDown,
  onPlay,
  onFavorite,
  onMove,
  onFocusChannel,
  preferredFocus,
}: {
  channel: Channel;
  number: number;
  favorite: boolean;
  logos: boolean;
  now: Date;
  editMode: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPlay: (channel: Channel) => void;
  onFavorite: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onFocusChannel: (id: string) => void;
  preferredFocus?: boolean;
}) {
  const programs = useGuidePrograms(channel.id);
  const current = nowNext(programs, now).current;
  const progress = current ? progressPct(current, now) : 0;
  return (
    <View style={styles.rowShell}>
      <Pressable
        hasTVPreferredFocus={preferredFocus}
        onFocus={() => onFocusChannel(channel.id)}
        onPress={() => { if (!editMode) onPlay(channel); }}
        onLongPress={Platform.isTV ? undefined : () => { if (!editMode) onFavorite(channel.id); }}
        delayLongPress={450}
        style={({ focused }: any) => [styles.row, editMode && styles.rowEditing, focused && styles.focused]}
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
      {editMode ? (
        <View style={styles.orderActions}>
          <Pressable
            disabled={!canMoveUp}
            onPress={() => onMove(channel.id, -1)}
            style={({ focused }: any) => [styles.orderButton, !canMoveUp && styles.disabled, focused && styles.focused]}
            testID={`channel-order-up-${channel.id}`}
          >
            <Ionicons name="chevron-up" size={15} color="#fff" />
            <Text style={styles.orderText}>Up</Text>
          </Pressable>
          <Pressable
            disabled={!canMoveDown}
            onPress={() => onMove(channel.id, 1)}
            style={({ focused }: any) => [styles.orderButton, !canMoveDown && styles.disabled, focused && styles.focused]}
            testID={`channel-order-down-${channel.id}`}
          >
            <Ionicons name="chevron-down" size={15} color="#fff" />
            <Text style={styles.orderText}>Down</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

function ChannelsScreenContent() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { channels, favorites, toggleFavorite, addRecent, channelLogos, hardRefresh, loading, refreshing, error, clock24h } = useStore();
  void clock24h;
  const customize = useChannelCustomize();
  // Native source/cache rows are already name-sorted. Reuse the authoritative
  // array instead of cloning/sorting 6k+ channels every Channels-screen render.
  const alphabetical = channels;
  const alphabeticalIds = useMemo(() => channels.map((channel) => channel.id), [channels]);
  const ordered = useMemo(() => {
    if (!customize.customOrder.length) return alphabetical;
    // Build directly instead of channels.map(...)->Map, avoiding a full tuple
    // array while arranging playlists with thousands of channels.
    const byId = new Map<string, Channel>();
    for (const channel of channels) byId.set(channel.id, channel);
    const result: Channel[] = [];
    const seen = new Set<string>();
    for (const id of customize.customOrder) {
      const channel = byId.get(id);
      if (!channel || seen.has(id)) continue;
      seen.add(id);
      result.push(channel);
    }
    for (const channel of alphabetical) {
      if (seen.has(channel.id)) continue;
      seen.add(channel.id);
      result.push(channel);
    }
    return result;
  }, [alphabetical, channels, customize.customOrder]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [now, setNow] = useState(() => new Date());
  const [preferInitialFocus, setPreferInitialFocus] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(null);

  useEffect(() => {
    if (!isFocused) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [isFocused]);

  // Channels is a persistent tab route. Re-arm preferred focus every time it
  // becomes active so returning from Search/player cannot leave focus detached.
  useFocusEffect(
    useCallback(() => {
      setPreferInitialFocus(true);
      const timer = setTimeout(() => setPreferInitialFocus(false), 180);
      return () => clearTimeout(timer);
    }, []),
  );

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    openFullscreenPlayer(router, channel.id);
  }, [addRecent, router]);

  const favorite = useCallback((id: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    toggleFavorite(id);
  }, [toggleFavorite]);

  const noteChannelFocus = useCallback((id: string) => {
    // Initial preferred focus is only an entry bootstrap. Once Android has a
    // real focused row, user D-pad movement owns focus and must never be pulled
    // back by a still-armed hasTVPreferredFocus flag.
    setPreferInitialFocus(false);
    setFocusedChannelId(id);
  }, []);

  useEffect(() => {
    if (!isFocused || editMode || !Platform.isTV) return;
    return addTvLongPressListener((key) => {
      if (key !== "SELECT") return;
      const id = focusedChannelId;
      if (id) favorite(id);
    });
  }, [editMode, favorite, focusedChannelId, isFocused]);

  const toggleEditMode = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    setEditMode((current) => {
      const next = !current;
      if (next) customize.initializeCustomOrder(alphabeticalIds);
      return next;
    });
  }, [alphabeticalIds, customize]);

  const move = useCallback((id: string, direction: -1 | 1) => {
    void Haptics.selectionAsync().catch(() => undefined);
    customize.moveInCustomOrder(id, direction);
  }, [customize]);

  const listExtraData = useMemo(
    () => ({ favorites, editMode, order: customize.customOrder }),
    [customize.customOrder, editMode, favorites],
  );

  const clearOrder = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    customize.clearCustomOrder();
    setEditMode(false);
  }, [customize]);

  return (
    <PurpleTvShell active="/channels">
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PurpleDrawerButton testID="channels-open-drawer" />
            <View>
              <Text style={styles.kicker}>LIVE TV</Text>
              <Text style={styles.title}>{editMode ? "Arrange Guide Channels" : "All Channels"}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.count}>{ordered.length} channels</Text>
            <Pressable
              onPress={toggleEditMode}
              style={({ focused }: any) => [styles.headerAction, editMode && styles.headerActionActive, focused && styles.focused]}
              testID="channels-toggle-order"
            >
              <Ionicons name="swap-vertical-outline" size={15} color="#fff" />
              <Text style={styles.headerActionText}>{editMode ? "Done" : "Arrange"}</Text>
            </Pressable>
            {customize.customOrder.length ? (
              <Pressable
                onPress={clearOrder}
                style={({ focused }: any) => [styles.headerAction, focused && styles.focused]}
                testID="channels-reset-order"
              >
                <Ionicons name="refresh-outline" size={15} color="#fff" />
                <Text style={styles.headerActionText}>Reset</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.replace("/search" as any)}
              style={({ focused }: any) => [styles.searchHit, focused && styles.focused]}
              testID="channels-open-search"
            >
              <Ionicons name="search-outline" size={16} color={tvColors.textMuted} />
            </Pressable>
          </View>
        </View>
        {editMode ? (
          <Text style={styles.editHint}>Move through the full virtualized channel list and use Up/Down to set the order used by the Guide. Only visible rows are mounted, even with thousands of channels.</Text>
        ) : null}
        {ordered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No channels loaded</Text>
            <Text style={styles.emptyMessage}>
              {error || "Reload your playlist or open Search once channels are available."}
            </Text>
            <Pressable
              hasTVPreferredFocus={preferInitialFocus}
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
            data={ordered}
            keyExtractor={(item) => item.id}
            extraData={listExtraData}
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
                logos={isFocused && channelLogos}
                now={now}
                editMode={editMode}
                canMoveUp={index > 0}
                canMoveDown={index < ordered.length - 1}
                onPlay={play}
                onFavorite={favorite}
                onMove={move}
                onFocusChannel={noteChannelFocus}
                preferredFocus={preferInitialFocus && index === 0}
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
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  count: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  headerAction: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  headerActionActive: { backgroundColor: tvColors.purple },
  headerActionText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8 },
  searchHit: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  editHint: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8, lineHeight: 11, paddingVertical: 6 },
  empty: { flex: 1, alignItems: "flex-start", justifyContent: "center", gap: 8, paddingHorizontal: 4 },
  emptyTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 14 },
  emptyMessage: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 10, maxWidth: 420 },
  retryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, borderRadius: 6, backgroundColor: tvColors.purple, borderWidth: 2, borderColor: "transparent", marginTop: 6 },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  list: { paddingTop: 7, paddingBottom: 20 },
  rowShell: { flexDirection: "row", alignItems: "stretch", gap: 6, marginBottom: 1 },
  row: { flex: 1, minWidth: 0, minHeight: 54, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 2, borderColor: "transparent", borderBottomColor: tvColors.line, paddingHorizontal: 7, borderRadius: radius.sm },
  rowEditing: { backgroundColor: "rgba(124,58,237,0.08)" },
  orderActions: { width: 130, flexDirection: "row", gap: 5 },
  orderButton: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  orderText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 7.5 },
  disabled: { opacity: 0.35 },
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

export default function ChannelsScreen() {
  return (
    <FocusedTabMount>
      <ChannelsScreenContent />
    </FocusedTabMount>
  );
}
