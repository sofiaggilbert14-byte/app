import React, { useRef } from "react";
import { View, Text, StyleSheet, Pressable, useWindowDimensions, RefreshControl, Platform } from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";
import { nowNext, progressPct, fmtTime } from "@/src/utils/time";
import { useStore } from "@/src/store";
import { AZRail } from "./AZRail";

const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";

export function BoxGrid({
  channels,
  now,
  onChannelPress,
  onProgramPress,
  onChannelFocus,
  ListHeaderComponent,
  refreshing,
  onRefresh,
}: {
  channels: Channel[];
  now: string;
  onChannelPress: (c: Channel) => void;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  ListHeaderComponent?: React.ReactElement;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { width } = useWindowDimensions();
  // Adapt column count to the screen ratio — phones 2, tablets/TVs up to 5.
  const numColumns = width >= 1400 ? 6 : width >= 1150 ? 5 : width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const showAZRail = Platform.OS === "web" || Platform.isTV;
  const nowDate = new Date(now);
  const { isFavorite, toggleFavorite } = useStore();
  const listRef = useRef<FlashListRef<Channel>>(null);

  return (
    <View style={styles.wrap}>
    <FlashList
      testID="epg-box-grid"
      data={channels}
      ref={listRef}
      numColumns={numColumns}
      keyExtractor={(c) => c.id}
      drawDistance={600}
      contentContainerStyle={{ paddingBottom: 130, paddingHorizontal: spacing.xs, paddingTop: spacing.xs }}
      ListHeaderComponent={ListHeaderComponent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
        ) : undefined
      }
      renderItem={({ item, index }) => {
        const { current, next } = nowNext(item.programs, nowDate);
        const pct = progressPct(current, nowDate);
        const fav = isFavorite(item.id);
        return (
          <View style={styles.cell}>
            <Pressable
              focusable
              onFocus={() => onChannelFocus?.(item)}
              style={({ focused }: any) => [styles.card, focused && styles.cardFocused]}
              onPress={() => onChannelPress(item)}
              testID={`box-channel-${item.id}`}
            >
              <View style={styles.cardTop}>
                <ChannelLogo name={item.name} logo={item.logo} size={40} />
                <Pressable focusable={false} hitSlop={8} onPress={() => toggleFavorite(item.id)} testID={`box-fav-${item.id}`}>
                  <Ionicons
                    name={fav ? "star" : "star-outline"}
                    size={18}
                    color={fav ? colors.warning : colors.onSurfaceTertiary}
                  />
                </Pressable>
              </View>
              <Text numberOfLines={1} style={styles.chName}>
                {item.name}
              </Text>
              {current ? (
                <Pressable focusable={false} onPress={() => onProgramPress(current, item)}>
                  <Text numberOfLines={2} style={styles.nowTitle}>
                    {current.title}
                  </Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                </Pressable>
              ) : (
                <Text style={styles.noNow}>No program info</Text>
              )}
              {next && (
                <Pressable focusable={false} onPress={() => onProgramPress(next, item)}>
                  <Text numberOfLines={1} style={styles.nextLine}>
                    Next: {fmtTime(next.start)} · {next.title}
                  </Text>
                </Pressable>
              )}
            </Pressable>
          </View>
        );
      }}
    />
      {showAZRail && (
        <AZRail
          channels={channels}
          onSelect={(i) => {
            try {
              listRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0 });
            } catch {}
          }}
        />
      )}
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
