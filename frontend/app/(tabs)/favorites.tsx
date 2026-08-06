import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { Channel } from "@/src/api";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { nowNext, progressPct } from "@/src/utils/time";
import { useTvBackToGuide } from "@/src/hooks/use-tv-back-to-guide";
import { getTvSafeInsets } from "@/src/utils/tvLayout";

const FAVORITE_GAP = spacing.sm;

function byChannelName(a: Channel, b: Channel): number {
  return (a.name || "").localeCompare(b.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function ChannelRow({
  channel,
  onPress,
  channelNumber,
  showChannelLogos = true,
  favorite = false,
}: {
  channel: Channel;
  onPress: () => void;
  channelNumber?: number;
  showChannelLogos?: boolean;
  favorite?: boolean;
}) {
  const { current } = nowNext(channel.programs, new Date());
  return (
    <Pressable
      style={({ focused }: any) => [styles.row, focused && styles.rowFocused]}
      onPress={onPress}
      testID={`fav-row-${channel.id}`}
    >
      {channelNumber ? <Text style={styles.channelNumber}>{channelNumber}</Text> : null}
      <ChannelLogo
        name={channel.name}
        logo={channel.logo}
        disabled={!showChannelLogos}
        size={44}
        favorite={favorite}
      />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={styles.rowName}>{channel.name}</Text>
        <Text numberOfLines={1} style={styles.rowSub}>
          {current ? current.title : "No program info"}
        </Text>
      </View>
    </Pressable>
  );
}

function FavoriteChannelBlock({
  channel,
  width,
  onPress,
  onUnfavorite,
  channelNumber,
  showChannelLogos,
}: {
  channel: Channel;
  width: number;
  onPress: () => void;
  onUnfavorite: () => void;
  channelNumber?: number;
  showChannelLogos: boolean;
}) {
  const now = new Date();
  const { current } = nowNext(channel.programs, now);
  const pct = progressPct(current, now);

  return (
    <Pressable
      focusable
      onPress={onPress}
      onLongPress={onUnfavorite}
      style={({ focused }: any) => [
        styles.favoriteBlock,
        { width },
        focused && styles.favoriteBlockFocused,
      ]}
      testID={`favorite-block-${channel.id}`}
    >
      <View style={styles.favoriteBlockTop}>
        <View style={styles.favoriteLogoRow}>
          {channelNumber ? <Text style={styles.favoriteNumber}>{channelNumber}</Text> : null}
          <ChannelLogo
            name={channel.name}
            logo={channel.logo}
            disabled={!showChannelLogos}
            size={38}
            favorite
          />
        </View>
        <Ionicons name="star" size={17} color={colors.warning} />
      </View>

      <Text numberOfLines={1} style={styles.favoriteName}>{channel.name}</Text>
      <Text numberOfLines={2} style={styles.favoriteProgram}>
        {current?.title || "No program info"}
      </Text>
      <View style={styles.favoriteProgressTrack}>
        <View style={[styles.favoriteProgressFill, { width: `${pct}%` }]} />
      </View>
      <Text numberOfLines={1} style={styles.favoriteHint}>OK to watch · Hold to unpin</Text>
    </Pressable>
  );
}

export default function FavoritesScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const tvSafe = getTvSafeInsets(width, height);
  const {
    channels,
    favorites,
    toggleFavorite,
    recent,
    reminders,
    removeReminder,
    addRecent,
    channelById,
    lastChannelId,
    channelNumbers,
    channelLogos,
  } = useStore();
  useTvBackToGuide();

  const favoriteSet = React.useMemo(() => new Set(favorites), [favorites]);
  const favChannels = channels.filter((c) => favoriteSet.has(c.id)).sort(byChannelName);
  const channelNumberById: Record<string, number> = {};
  [...channels].sort(byChannelName).forEach((channel, index) => {
    channelNumberById[channel.id] = index + 1;
  });

  const favoriteColumns = width >= 900 ? 6 : width >= 600 ? 3 : 2;
  const favoriteAvailableWidth = Math.max(
    320,
    width - tvSafe.left - tvSafe.right - spacing.lg * 2,
  );
  const favoriteBlockWidth = Math.max(
    118,
    (favoriteAvailableWidth - FAVORITE_GAP * (favoriteColumns - 1)) / favoriteColumns,
  );

  const lastChannel = lastChannelId ? channelById(lastChannelId) : null;
  const play = (c: Channel) => {
    void Haptics.selectionAsync().catch(() => {});
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };
  const upcoming = [...reminders].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: spacing.md + tvSafe.top,
          paddingLeft: tvSafe.left,
          paddingRight: tvSafe.right,
          paddingBottom: tvSafe.bottom,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.brand}>My Stuff</Text>
        <Text style={styles.title}>Favorites</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        {lastChannel && (
          <>
            <Text style={styles.section}>Continue Watching</Text>
            <Pressable
              style={({ focused }: any) => [styles.continueCard, focused && styles.rowFocused]}
              onPress={() => play(lastChannel)}
              testID="favorites-continue-watching"
            >
              <ChannelLogo
                name={lastChannel.name}
                logo={lastChannel.logo}
                disabled={!channelLogos}
                size={58}
                favorite={favoriteSet.has(lastChannel.id)}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.continueLabel}>Last channel</Text>
                <Text numberOfLines={1} style={styles.continueName}>
                  {channelNumbers ? `${channelNumberById[lastChannel.id] || ""} · ` : ""}{lastChannel.name}
                </Text>
                <Text numberOfLines={1} style={styles.rowSub}>
                  {nowNext(lastChannel.programs, new Date()).current?.title || "Tap to resume playback"}
                </Text>
              </View>
              <Ionicons name="play-circle" size={34} color={colors.brandSecondary} />
            </Pressable>
          </>
        )}

        <Text style={styles.section}>Favorite Channels</Text>
        {favChannels.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="star-outline" size={34} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyText}>Pin your favorite channels here</Text>
          </View>
        ) : (
          <View style={styles.favoriteGrid}>
            {favChannels.map((channel) => (
              <FavoriteChannelBlock
                key={channel.id}
                channel={channel}
                width={favoriteBlockWidth}
                onPress={() => play(channel)}
                onUnfavorite={() => toggleFavorite(channel.id)}
                channelNumber={channelNumbers ? channelNumberById[channel.id] : undefined}
                showChannelLogos={channelLogos}
              />
            ))}
          </View>
        )}

        <Text style={styles.section}>Reminders</Text>
        {upcoming.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-outline" size={34} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyText}>Set reminders from the guide to get alerts</Text>
          </View>
        ) : (
          upcoming.map((r) => (
            <View key={r.key} style={styles.reminderRow} testID={`reminder-${r.key}`}>
              <View style={styles.bell}>
                <Ionicons name="notifications" size={18} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.rowName}>{r.programTitle}</Text>
                <Text style={styles.rowSub}>
                  {r.channelName} · {dayjs(r.start).format("ddd h:mm A")}
                </Text>
              </View>
              <Pressable
                style={styles.switchBtn}
                onPress={() => {
                  const c = channelById(r.channelId);
                  if (c) play(c);
                }}
                testID={`reminder-switch-${r.key}`}
              >
                <Ionicons name="play" size={14} color="#fff" />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => removeReminder(r.key)} testID={`reminder-remove-${r.key}`}>
                <Ionicons name="trash-outline" size={18} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>
          ))
        )}

        <Text style={styles.section}>Recently Watched</Text>
        {recent.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={34} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyText}>Channels you watch will show up here</Text>
          </View>
        ) : (
          recent.map((c) => {
            const live = channelById(c.id) || c;
            return (
              <ChannelRow
                key={c.id}
                channel={live}
                onPress={() => play(live)}
                channelNumber={channelNumbers ? channelNumberById[live.id] : undefined}
                showChannelLogos={channelLogos}
                favorite={favoriteSet.has(live.id)}
              />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  brand: { color: colors.brandSecondary, fontFamily: fonts.semibold, fontSize: 12 },
  title: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 28 },
  section: {
    color: colors.onSurface,
    fontFamily: fonts.display,
    fontSize: 18,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  continueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: "#14141A",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  continueLabel: {
    color: colors.brandSecondary,
    fontFamily: fonts.semibold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  continueName: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 },
  favoriteGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: FAVORITE_GAP,
    paddingHorizontal: spacing.lg,
    alignItems: "stretch",
  },
  favoriteBlock: {
    minHeight: 132,
    backgroundColor: "rgba(35, 25, 18, 0.88)",
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255, 227, 163, 0.13)",
    gap: spacing.xs,
  },
  favoriteBlockFocused: {
    borderColor: "#fff",
    borderWidth: 3,
    backgroundColor: "rgba(126,22,28,0.72)",
  },
  favoriteBlockTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  favoriteLogoRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1 },
  favoriteNumber: {
    minWidth: 24,
    color: "#fff",
    fontFamily: fonts.bold,
    fontSize: 11,
    textAlign: "right",
  },
  favoriteName: { color: "rgba(255,255,255,0.86)", fontFamily: fonts.semibold, fontSize: 11.5 },
  favoriteProgram: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 12.5, minHeight: 32 },
  favoriteProgressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  favoriteProgressFill: { height: 4, backgroundColor: colors.brand },
  favoriteHint: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 8.5, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowName: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14 },
  channelNumber: { color: colors.brandSecondary, fontFamily: fonts.bold, fontSize: 13, minWidth: 34, textAlign: "right" },
  rowSub: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  rowFocused: { borderColor: "#fff", borderWidth: 2, backgroundColor: "#2a121b" },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bell: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  switchBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 13 },
});