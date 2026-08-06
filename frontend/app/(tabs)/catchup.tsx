import React, { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { nowNext } from "@/src/utils/time";

export default function CatchUpScreen() {
  const router = useRouter();
  const { recent, channels, channelById, addRecent, channelLogos } = useStore();
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: Channel[] = [];
    for (const item of recent) {
      const channel = channelById(item.id) || item;
      if (!channel || seen.has(channel.id)) continue;
      seen.add(channel.id);
      out.push(channel);
      if (out.length >= 8) break;
    }
    if (!out.length) out.push(...channels.slice(0, 8));
    return out;
  }, [channelById, channels, recent]);

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    router.push({ pathname: "/player", params: { channelId: channel.id } });
  }, [addRecent, router]);

  const dates = useMemo(() => [2, 1, 0, -1, -2].map((offset) => dayjs().add(offset, "day")), []);

  return (
    <PurpleTvShell active="/catchup">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>RECENT & REPLAY</Text>
            <Text style={styles.title}>Catch Up</Text>
          </View>
          <Text style={styles.note}>Replay availability depends on the source.</Text>
        </View>

        <View style={styles.dateRow}>
          {dates.map((date) => {
            const today = date.isSame(dayjs(), "day");
            return (
              <View key={date.format("YYYY-MM-DD")} style={[styles.dateChip, today && styles.dateActive]}>
                <Text style={[styles.dateText, today && styles.dateTextActive]}>{today ? "Today" : date.format("ddd, MMM D")}</Text>
              </View>
            );
          })}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.rows}>
          {items.map((channel, rowIndex) => {
            const programs = (channel.programs || []).slice(0, 4);
            const current = nowNext(channel.programs, new Date()).current;
            const cards = programs.length ? programs : current ? [current] : [];
            return (
              <View key={channel.id} style={styles.channelRow}>
                <View style={styles.channelLabel}>
                  <Text style={styles.number}>{rowIndex + 1}</Text>
                  <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={28} />
                  <Text numberOfLines={1} style={styles.channelName}>{channel.name}</Text>
                </View>
                <View style={styles.programRow}>
                  {cards.length ? cards.map((program, index) => (
                    <Pressable
                      key={`${program.start}-${index}`}
                      onPress={() => play(channel)}
                      style={({ focused }: any) => [styles.programCard, focused && styles.focused]}
                    >
                      <View style={styles.programIcon}><Ionicons name="play" size={12} color={tvColors.purpleSoft} /></View>
                      <Text numberOfLines={2} style={styles.programTitle}>{program.title}</Text>
                      <Text style={styles.programTime}>{dayjs(program.start).format("h:mm A")}</Text>
                    </Pressable>
                  )) : (
                    <Pressable onPress={() => play(channel)} style={({ focused }: any) => [styles.programCard, focused && styles.focused]}>
                      <Ionicons name="radio-outline" size={14} color={tvColors.purpleSoft} />
                      <Text numberOfLines={2} style={styles.programTitle}>Watch live channel</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14 },
  header: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  note: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5 },
  dateRow: { height: 42, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  dateChip: { minWidth: 84, minHeight: 27, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: tvColors.panel, borderWidth: 1, borderColor: tvColors.line },
  dateActive: { backgroundColor: tvColors.purple, borderColor: tvColors.purpleBright },
  dateText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 7.5 },
  dateTextActive: { color: "#fff", fontFamily: fonts.semibold },
  rows: { paddingBottom: 20, gap: 7 },
  channelRow: { minHeight: 84, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: tvColors.line, paddingBottom: 7 },
  channelLabel: { width: 150, flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 8 },
  number: { width: 15, color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 8 },
  channelName: { flex: 1, color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  programRow: { flex: 1, flexDirection: "row", gap: 6 },
  programCard: { flex: 1, minWidth: 0, maxWidth: 170, minHeight: 72, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised, padding: 7, justifyContent: "space-between" },
  programIcon: { width: 22, height: 18, borderRadius: 4, backgroundColor: tvColors.purpleDeep, alignItems: "center", justifyContent: "center" },
  programTitle: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5, lineHeight: 11 },
  programTime: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
