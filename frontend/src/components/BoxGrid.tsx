import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Pressable, useWindowDimensions, RefreshControl } from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radius, spacing, tvColors } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";
import { nowNext, progressPct, fmtTime } from "@/src/utils/time";
import { useStore } from "@/src/store";

const ACCENT = "#A855F7";
const ACCENT_SOFT = "#E9D5FF";

type ChannelCardProps = {
  item: Channel;
  index: number;
  nowDate: Date;
  favorite: boolean;
  showChannelNumbers: boolean;
  channelNumber?: number;
  showChannelLogos: boolean;
  onChannelPress: (c: Channel) => void;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  toggleFavorite: (id: string) => void;
  preferInitialFocus?: boolean;
};

const ChannelCard = memo(function ChannelCard({
  item,
  index,
  nowDate,
  favorite,
  showChannelNumbers,
  channelNumber,
  showChannelLogos,
  onChannelPress,
  onProgramPress,
  onChannelFocus,
  toggleFavorite,
  preferInitialFocus = false,
}: ChannelCardProps) {
  const { current, next } = nowNext(item.programs, nowDate);
  const pct = progressPct(current, nowDate);

  const handleChannelPress = useCallback(() => onChannelPress(item), [item, onChannelPress]);
  const handleCurrentPress = useCallback(() => {
    if (current) onProgramPress(current, item);
  }, [current, item, onProgramPress]);
  const handleNextPress = useCallback(() => {
    if (next) onProgramPress(next, item);
  }, [item, next, onProgramPress]);
  const handleFavorite = useCallback(() => toggleFavorite(item.id), [item.id, toggleFavorite]);
  const handleFocus = useCallback(() => onChannelFocus?.(item), [item, onChannelFocus]);

  return (
    <View style={styles.cell}>
      <Pressable
        focusable
        hasTVPreferredFocus={preferInitialFocus}
        onFocus={handleFocus}
        style={({ focused }: any) => [styles.card, focused && styles.cardFocused]}
        onPress={handleChannelPress}
        testID={`box-channel-${item.id}`}
      >
        <View style={styles.cardTop}>
          <View style={styles.logoNumberRow}>
            {showChannelNumbers && (
              <Text style={styles.channelNumber}>{channelNumber || index + 1}</Text>
            )}
            <ChannelLogo name={item.name} logo={item.logo} disabled={!showChannelLogos} size={40} />
          </View>
          <Pressable focusable={false} hitSlop={8} onPress={handleFavorite} testID={`box-fav-${item.id}`}>
            <Ionicons
              name={favorite ? "heart" : "heart-outline"}
              size={18}
              color={favorite ? ACCENT : colors.onSurfaceTertiary}
            />
          </Pressable>
        </View>

        <Text numberOfLines={1} style={styles.chName}>{item.name}</Text>

        {current ? (
          <Pressable focusable={false} onPress={handleCurrentPress}>
            <Text numberOfLines={2} style={styles.nowTitle}>{current.title}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
          </Pressable>
        ) : (
          <Text style={styles.noNow}>No program info</Text>
        )}

        {next && (
          <Pressable focusable={false} onPress={handleNextPress}>
            <Text numberOfLines={1} style={styles.nextLine}>
              Next: {fmtTime(next.start)} · {next.title}
            </Text>
          </Pressable>
        )}
      </Pressable>
    </View>
  );
});

export function BoxGrid({
  channels,
  now,
  onChannelPress,
  onProgramPress,
  onChannelFocus,
  ListHeaderComponent,
  refreshing,
  onRefresh,
  showChannelNumbers = false,
  channelNumberById,
  showChannelLogos = true,
  resetToken = 0,
}: {
  channels: Channel[];
  now: string;
  onChannelPress: (c: Channel) => void;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  ListHeaderComponent?: React.ReactElement;
  refreshing?: boolean;
  onRefresh?: () => void;
  showChannelNumbers?: boolean;
  channelNumberById?: Record<string, number>;
  showChannelLogos?: boolean;
  resetToken?: number;
}) {
  const { width } = useWindowDimensions();
  const numColumns = width >= 1400 ? 6 : width >= 1150 ? 5 : width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const nowDate = useMemo(() => new Date(now), [now]);
  const { favorites, toggleFavorite } = useStore();
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const listRef = useRef<FlashListRef<Channel>>(null);

  useEffect(() => {
    if (!resetToken) return;
    try {
      listRef.current?.scrollToIndex({ index: 0, animated: true, viewPosition: 0 });
    } catch {}
  }, [resetToken]);

  const renderItem = useCallback(
    ({ item, index }: { item: Channel; index: number }) => (
      <ChannelCard
        item={item}
        index={index}
        nowDate={nowDate}
        favorite={favoriteSet.has(item.id)}
        showChannelNumbers={showChannelNumbers}
        channelNumber={channelNumberById?.[item.id]}
        showChannelLogos={showChannelLogos}
        onChannelPress={onChannelPress}
        onProgramPress={onProgramPress}
        onChannelFocus={onChannelFocus}
        toggleFavorite={toggleFavorite}
        preferInitialFocus={index === 0}
      />
    ),
    [channelNumberById, favoriteSet, nowDate, onChannelFocus, onChannelPress, onProgramPress, showChannelLogos, showChannelNumbers, toggleFavorite],
  );

  return (
    <View style={styles.wrap}>
      <FlashList
        testID="epg-box-grid"
        data={channels}
        ref={listRef}
        numColumns={numColumns}
        keyExtractor={(c) => c.id}
        drawDistance={360}
        contentContainerStyle={{ paddingBottom: 130, paddingHorizontal: spacing.xs, paddingTop: spacing.xs }}
        ListHeaderComponent={ListHeaderComponent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
          ) : undefined
        }
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  cell: { flex: 1, padding: spacing.xs },
  card: {
    flex: 1,
    backgroundColor: tvColors.panel,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: tvColors.line,
    gap: spacing.xs,
    minHeight: 132,
  },
  cardFocused: {
    borderColor: "#fff",
    borderWidth: 3,
    backgroundColor: tvColors.purpleDeep,
    shadowColor: ACCENT,
    shadowOpacity: 0.55,
    shadowRadius: 12,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logoNumberRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1 },
  channelNumber: { color: ACCENT_SOFT, fontFamily: fonts.bold, fontSize: 12, minWidth: 26, textAlign: "right" },
  chName: { color: "rgba(255,255,255,0.82)", fontFamily: fonts.semibold, fontSize: 12 },
  nowTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14, minHeight: 34 },
  noNow: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: ACCENT },
  nextLine: { color: "rgba(233,213,255,0.78)", fontFamily: fonts.regular, fontSize: 11, marginTop: 6 },
});
