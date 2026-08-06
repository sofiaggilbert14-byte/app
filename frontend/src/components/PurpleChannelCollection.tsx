import React, { memo, useCallback, useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { nowNext } from "@/src/utils/time";

type CollectionRoute = "/movies" | "/series";

const Card = memo(function Card({
  channel,
  logos,
  onPress,
}: {
  channel: Channel;
  logos: boolean;
  onPress: (channel: Channel) => void;
}) {
  const current = nowNext(channel.programs, new Date()).current;
  return (
    <Pressable
      onPress={() => onPress(channel)}
      style={({ focused }: any) => [styles.card, focused && styles.focused]}
      testID={`collection-${channel.id}`}
    >
      <View style={styles.art}>
        <LinearGradient colors={["rgba(124,58,237,0.44)", "#111020"]} style={StyleSheet.absoluteFill} />
        <ChannelLogo name={channel.name} logo={channel.logo} disabled={!logos} size={58} />
      </View>
      <Text numberOfLines={2} style={styles.name}>{channel.name}</Text>
      <Text numberOfLines={1} style={styles.program}>{current?.title || channel.group || "Available now"}</Text>
    </Pressable>
  );
});

export function PurpleChannelCollection({
  active,
  title,
  subtitle,
  matcher,
}: {
  active: CollectionRoute;
  title: string;
  subtitle: string;
  matcher: (channel: Channel) => boolean;
}) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { channels, addRecent, channelLogos, hardRefresh, loading, refreshing, error } = useStore();
  const columns = width >= 1500 ? 6 : width >= 1050 ? 5 : 4;

  const items = useMemo(() => channels.filter(matcher), [channels, matcher]);
  const playlistEmpty = channels.length === 0;

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    router.push({ pathname: "/player", params: { channelId: channel.id } });
  }, [addRecent, router]);

  return (
    <PurpleTvShell active={active}>
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>{subtitle.toUpperCase()}</Text>
            <Text style={styles.title}>{title}</Text>
          </View>
          <Text style={styles.count}>{items.length} available channels</Text>
        </View>
        {items.length ? (
          <>
            <Text style={styles.section}>Available Now</Text>
            <FlatList
              key={columns}
              data={items}
              numColumns={columns}
              keyExtractor={(item) => item.id}
              initialNumToRender={columns * 2}
              maxToRenderPerBatch={columns * 2}
              windowSize={5}
              showsVerticalScrollIndicator={false}
              columnWrapperStyle={styles.row}
              contentContainerStyle={styles.grid}
              renderItem={({ item }) => <Card channel={item} logos={channelLogos} onPress={play} />}
            />
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {playlistEmpty ? (error ? "Guide failed to load" : "No channels loaded") : "No matching channels"}
            </Text>
            <Text style={styles.emptyText}>
              {playlistEmpty
                ? error || "Reload your playlist, then try again."
                : `Nothing in the current playlist matched ${title.toLowerCase()}. Try the TV Guide or Channels list instead.`}
            </Text>
            {playlistEmpty ? (
              <Pressable
                hasTVPreferredFocus
                onPress={() => void hardRefresh()}
                disabled={loading || refreshing}
                style={({ focused }: any) => [styles.emptyButton, focused && styles.focused]}
              >
                <Ionicons name="refresh-outline" size={14} color="#fff" />
                <Text style={styles.emptyButtonText}>{refreshing || loading ? "Loading…" : "Retry load"}</Text>
              </Pressable>
            ) : (
              <Pressable
                hasTVPreferredFocus
                onPress={() => router.replace("/guide" as any)}
                style={({ focused }: any) => [styles.emptyButton, focused && styles.focused]}
              >
                <Text style={styles.emptyButtonText}>Open TV Guide</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14 },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  count: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  section: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11.5, marginTop: 10, marginBottom: 7 },
  grid: { paddingBottom: 20 },
  row: { gap: 8, marginBottom: 8 },
  card: { flex: 1, minWidth: 0, maxWidth: 220, minHeight: 158, backgroundColor: tvColors.panel, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", padding: 6 },
  art: { height: 96, borderRadius: 5, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  name: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9.5, lineHeight: 12, marginTop: 6, minHeight: 24 },
  program: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, marginTop: 2 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40 },
  emptyTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  emptyText: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, textAlign: "center", maxWidth: 420 },
  emptyButton: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 5,
    backgroundColor: tvColors.purple,
    borderWidth: 2,
    borderColor: "transparent",
    marginTop: 4,
  },
  emptyButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
});
