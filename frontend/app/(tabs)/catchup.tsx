import React, { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { nowNext } from "@/src/utils/time";
import { useTvBackToGuide } from "@/src/hooks/use-tv-back-to-guide";

export default function CatchUpScreen() {
  useTvBackToGuide();
  const router = useRouter();
  const { recent, channelById, addRecent, channelLogos } = useStore();

  // Honest recent-live list only. This build has no timeshift/catch-up URLs yet,
  // so we never present live streams as replay content.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: Channel[] = [];
    for (const item of recent) {
      const channel = channelById(item.id) || item;
      if (!channel?.url || seen.has(channel.id)) continue;
      seen.add(channel.id);
      out.push(channel);
      if (out.length >= 12) break;
    }
    return out;
  }, [channelById, recent]);

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    router.push({ pathname: "/player", params: { channelId: channel.id } });
  }, [addRecent, router]);

  return (
    <PurpleTvShell active="/catchup">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>RECENT LIVE</Text>
            <Text style={styles.title}>Catch Up</Text>
          </View>
        </View>

        <View style={styles.banner}>
          <Ionicons name="information-circle-outline" size={16} color={tvColors.purpleSoft} />
          <Text style={styles.bannerText}>
            Replay / timeshift is not available in this build. Below are recent live channels only.
          </Text>
        </View>

        {items.length ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.rows}>
            {items.map((channel, rowIndex) => {
              const current = nowNext(channel.programs, new Date()).current;
              return (
                <Pressable
                  key={channel.id}
                  onPress={() => play(channel)}
                  style={({ focused }: any) => [styles.row, focused && styles.focused]}
                  testID={`catchup-live-${channel.id}`}
                >
                  <Text style={styles.number}>{rowIndex + 1}</Text>
                  <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={28} />
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={styles.channelName}>{channel.name}</Text>
                    <Text numberOfLines={1} style={styles.programTitle}>{current?.title || "Watch live"}</Text>
                  </View>
                  <View style={styles.livePill}>
                    <Text style={styles.livePillText}>LIVE</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={28} color={tvColors.purpleSoft} />
            <Text style={styles.emptyTitle}>No recent channels yet</Text>
            <Text style={styles.emptyText}>Watch something from the TV Guide, then it will appear here as live history.</Text>
            <Pressable
              onPress={() => router.replace("/guide" as any)}
              style={({ focused }: any) => [styles.guideButton, focused && styles.focused]}
            >
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
  header: { minHeight: 50, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  banner: {
    marginTop: 10,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.28)",
    backgroundColor: "rgba(46,16,101,0.35)",
  },
  bannerText: { flex: 1, color: "rgba(255,255,255,0.84)", fontFamily: fonts.regular, fontSize: 8.5, lineHeight: 12 },
  rows: { paddingBottom: 20, gap: 4 },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panel,
  },
  number: { width: 18, color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 8, textAlign: "right" },
  copy: { flex: 1, minWidth: 0 },
  channelName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  programTitle: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8, marginTop: 2 },
  livePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, backgroundColor: tvColors.purple },
  livePillText: { color: "#fff", fontFamily: fonts.bold, fontSize: 7 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40 },
  emptyTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  emptyText: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, textAlign: "center" },
  guideButton: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 5,
    backgroundColor: tvColors.purple,
    borderWidth: 2,
    borderColor: "transparent",
    marginTop: 4,
  },
  guideText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
