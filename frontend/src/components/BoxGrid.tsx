import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Pressable, useWindowDimensions, RefreshControl } from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import type { GuideDensity } from "@/src/store";
import { ChannelLogo } from "./ChannelLogo";
import { nowNext, progressPct, fmtTime, reminderKey } from "@/src/utils/time";

const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";
const REMINDER_BELL = "#FACC15";

function densityMetrics(density: GuideDensity) {
  if (density === "large") {
    return { padding: spacing.lg, minHeight: 156, logoSize: 48, starSize: 20, titleSize: 15, nameSize: 13 };
  }
  if (density === "compact") {
    return { padding: spacing.sm, minHeight: 112, logoSize: 32, starSize: 16, titleSize: 12.5, nameSize: 11 };
  }
  return { padding: spacing.md, minHeight: 132, logoSize: 40, starSize: 18, titleSize: 14, nameSize: 12 };
}

type ChannelCardProps = {
  item: Channel;
  index: number;
  nowDate: Date;
  favorite: boolean;
  showChannelNumbers: boolean;
  channelNumber?: number;
  showChannelLogos: boolean;
  density: GuideDensity;
  hasReminder: boolean;
  onChannelPress: (c: Channel) => void;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  toggleFavorite: (id: string) => void;
};

const ChannelCard = memo(function ChannelCard({
  item,
  index,
  nowDate,
  favorite,
  showChannelNumbers,
  channelNumber,
  showChannelLogos,
  density,
  hasReminder,
  onChannelPress,
  onProgramPress,
  onChannelFocus,
  toggleFavorite,
}: ChannelCardProps) {
  const { current, next } = nowNext(item.programs, nowDate);
  const pct = progressPct(current, nowDate);
  const metrics = densityMetrics(density);

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
        onFocus={handleFocus}
        style={({ focused }: any) => [
          styles.card,
          { padding: metrics.padding, minHeight: metrics.minHeight },
          focused && styles.cardFocused,
        ]}
        onPress={handleChannelPress}
        testID={`box-channel-${item.id}`}
      >
        <View style={styles.cardTop}>
          <View style={styles.logoNumberRow}>
            {showChannelNumbers && (
              <Text style={styles.channelNumber}>{channelNumber || index + 1}</Text>
            )}
            <ChannelLogo
              name={item.name}
              logo={item.logo}
              disabled={!showChannelLogos}
              size={metrics.logoSize}
              favorite={favorite}
            />
          </View>
          <View style={styles.cardBadges} pointerEvents="box-none">
            {hasReminder ? <Ionicons name="notifications" size={16} color={REMINDER_BELL} /> : null}
            <Pressable focusable={false} hitSlop={8} onPress={handleFavorite} testID={`box-fav-${item.id}`}>
              <Ionicons
                name={favorite ? "star" : "star-outline"}
                size={metrics.starSize}
                color={favorite ? colors.warning : colors.onSurfaceTertiary}
              />
            </Pressable>
          </View>
        </View>

        <Text numberOfLines={1} style={[styles.chName, { fontSize: metrics.nameSize }]}>{item.name}</Text>

        {current ? (
          <Pressable focusable={false} onPress={handleCurrentPress}>
            <Text numberOfLines={2} style={[styles.nowTitle, { fontSize: metrics.titleSize }]}>{current.title}</Text>
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
  density = "normal",
  favoriteIds,
  reminderKeys,
  onToggleFavorite,
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
  density?: GuideDensity;
  favoriteIds: ReadonlySet<string> | string[];
  reminderKeys?: ReadonlySet<string>;
  onToggleFavorite: (id: string) => void;
  resetToken?: number;
}) {
  const { width } = useWindowDimensions();
  const numColumns = width >= 1400 ? 6 : width >= 1150 ? 5 : width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const nowDate = useMemo(() => new Date(now), [now]);
  const favoriteSet = useMemo(() => {
    return favoriteIds instanceof Set ? favoriteIds : new Set(favoriteIds);
  }, [favoriteIds]);
  const listRef = useRef<FlashListRef<Channel>>(null);

  useEffect(() => {
    if (!resetToken) return;
    try {
      listRef.current?.scrollToIndex({ index: 0, animated: true, viewPosition: 0 });
    } catch (e) {
      console.warn("[BoxGrid] reset scroll failed", e);
    }
  }, [resetToken]);

  const renderItem = useCallback(
    ({ item, index }: { item: Channel; index: number }) => {
      const reminded = !!item.programs?.some((program) =>
        reminderKeys?.has(reminderKey(item.id, program.start)),
      );
      return (
        <ChannelCard
          item={item}
          index={index}
          nowDate={nowDate}
          favorite={favoriteSet.has(item.id)}
          showChannelNumbers={showChannelNumbers}
          channelNumber={channelNumberById?.[item.id]}
          showChannelLogos={showChannelLogos}
          density={density}
          hasReminder={reminded}
          onChannelPress={onChannelPress}
          onProgramPress={onProgramPress}
          onChannelFocus={onChannelFocus}
          toggleFavorite={onToggleFavorite}
        />
      );
    },
    [
      channelNumberById,
      density,
      favoriteSet,
      nowDate,
      onChannelFocus,
      onChannelPress,
      onProgramPress,
      onToggleFavorite,
      reminderKeys,
      showChannelLogos,
      showChannelNumbers,
    ],
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
    backgroundColor: "rgba(35, 25, 18, 0.88)",
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255, 227, 163, 0.13)",
    gap: spacing.xs,
    minHeight: 132,
  },
  cardFocused: {
    borderColor: GOLD_SOFT,
    borderWidth: 3,
    backgroundColor: "rgba(92, 53, 15, 0.72)",
    shadowColor: GOLD,
    shadowOpacity: 0.65,
    shadowRadius: 14,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardBadges: { flexDirection: "row", alignItems: "center", gap: 6 },
  logoNumberRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1 },
  channelNumber: { color: GOLD_SOFT, fontFamily: fonts.bold, fontSize: 12, minWidth: 26, textAlign: "right" },
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
  progressFill: { height: 4, backgroundColor: GOLD },
  nextLine: { color: "rgba(255,227,163,0.72)", fontFamily: fonts.regular, fontSize: 11, marginTop: 6 },
});
