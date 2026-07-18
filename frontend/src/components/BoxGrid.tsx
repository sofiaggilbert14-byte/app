import React from "react";
import { View, Text, StyleSheet, Pressable, useWindowDimensions, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";
import { nowNext, progressPct, fmtTime } from "@/src/utils/time";
import { useStore } from "@/src/store";

export function BoxGrid({
  channels,
  now,
  onChannelPress,
  onProgramPress,
  ListHeaderComponent,
}: {
  channels: Channel[];
  now: string;
  onChannelPress: (c: Channel) => void;
  onProgramPress: (p: Program, c: Channel) => void;
  ListHeaderComponent?: React.ReactElement;
}) {
  const { width } = useWindowDimensions();
  const numColumns = width >= 700 ? 4 : 2;
  const nowDate = new Date(now);
  const { isFavorite, toggleFavorite } = useStore();

  return (
    <FlatList
      testID="epg-box-grid"
      data={channels}
      key={numColumns}
      numColumns={numColumns}
      keyExtractor={(c) => c.id}
      columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
      contentContainerStyle={{ gap: spacing.md, paddingBottom: 130, paddingTop: spacing.sm }}
      ListHeaderComponent={ListHeaderComponent}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => {
        const { current, next } = nowNext(item.programs, nowDate);
        const pct = progressPct(current, nowDate);
        const fav = isFavorite(item.id);
        return (
          <Pressable
            style={styles.card}
            onPress={() => onChannelPress(item)}
            testID={`box-channel-${item.id}`}
          >
            <View style={styles.cardTop}>
              <ChannelLogo name={item.name} logo={item.logo} size={40} />
              <Pressable
                hitSlop={8}
                onPress={() => toggleFavorite(item.id)}
                testID={`box-fav-${item.id}`}
              >
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
              <Pressable onPress={() => onProgramPress(current, item)}>
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
              <Pressable onPress={() => onProgramPress(next, item)}>
                <Text numberOfLines={1} style={styles.nextLine}>
                  Next: {fmtTime(next.start)} · {next.title}
                </Text>
              </Pressable>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    minHeight: 140,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chName: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 12 },
  nowTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14, minHeight: 36 },
  noNow: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 },
  progressTrack: {
    height: 4,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: colors.brand },
  nextLine: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 11, marginTop: 6 },
});
