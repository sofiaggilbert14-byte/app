import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { Channel } from "@/src/api";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { nowNext } from "@/src/utils/time";

function byChannelName(a: Channel, b: Channel): number {
  return (a.name || "").localeCompare(b.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function ChannelRow({ channel, onPress, right }: { channel: Channel; onPress: () => void; right?: React.ReactNode }) {
  const { current } = nowNext(channel.programs, new Date());
  return (
    <Pressable
      style={({ focused }: any) => [styles.row, focused && styles.rowFocused]}
      onPress={onPress}
      testID={`fav-row-${channel.id}`}
    >
      <ChannelLogo name={channel.name} logo={channel.logo} size={44} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={styles.rowName}>{channel.name}</Text>
        <Text numberOfLines={1} style={styles.rowSub}>
          {current ? current.title : "No program info"}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

export default function FavoritesScreen() {
  const router = useRouter();
  const { channels, favorites, toggleFavorite, recent, reminders, removeReminder, addRecent, channelById, lastChannelId } = useStore();

  const favChannels = channels.filter((c) => favorites.includes(c.id)).sort(byChannelName);
  const lastChannel = lastChannelId ? channelById(lastChannelId) : null;
  const play = (c: Channel) => {
    Haptics.selectionAsync();
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };
  const upcoming = [...reminders].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <View style={[styles.container, { paddingTop: spacing.md }]}>
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
              <ChannelLogo name={lastChannel.name} logo={lastChannel.logo} size={58} />
              <View style={{ flex: 1 }}>
                <Text style={styles.continueLabel}>Last channel</Text>
                <Text numberOfLines={1} style={styles.continueName}>{lastChannel.name}</Text>
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
          favChannels.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              onPress={() => play(c)}
              right={
                <Pressable hitSlop={8} onPress={() => toggleFavorite(c.id)} testID={`unfav-${c.id}`}>
                  <Ionicons name="star" size={20} color={colors.warning} />
                </Pressable>
              }
            />
          ))
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
          recent.map((c) => <ChannelRow key={c.id} channel={channelById(c.id) || c} onPress={() => play(c)} />)
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
  rowSub: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  rowFocused: { borderColor: colors.brand, borderWidth: 2, backgroundColor: "#2a121b" },
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
