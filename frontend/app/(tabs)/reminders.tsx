import React, { useCallback, useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import { usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { fmtDayTime } from "@/src/utils/time";

export default function RemindersScreen() {
  const router = useRouter();
  const { drawerOpen, openDrawer } = usePurpleTvDrawer();
  const { reminders, removeReminder, channelById } = useStore();

  useTvBackHandler(
    useCallback(() => {
      if (!drawerOpen) {
        openDrawer();
        return true;
      }
      return true;
    }, [drawerOpen, openDrawer]),
  );

  const upcoming = useMemo(
    () =>
      [...reminders].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    [reminders],
  );

  const openChannel = useCallback(
    (channelId: string) => {
      void Haptics.selectionAsync().catch(() => undefined);
      if (channelById(channelId)) openFullscreenPlayer(router, channelId);
      else router.replace("/guide" as any);
    },
    [channelById, router],
  );

  return (
    <PurpleTvShell active="/reminders">
      <View style={styles.page}>
        <Text style={styles.kicker}>SCHEDULE</Text>
        <Text style={styles.title}>Reminders</Text>
        <Text style={styles.help}>Upcoming programme reminders on this device. Cancel anytime.</Text>
        <FlatList
          data={upcoming}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No upcoming reminders. Open a programme in the guide and choose Remind me.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                onPress={() => openChannel(item.channelId)}
                style={({ focused }: any) => [styles.main, focused && styles.focused]}
              >
                <Text style={styles.when}>{fmtDayTime(item.start)}</Text>
                <Text style={styles.program} numberOfLines={1}>{item.programTitle}</Text>
                <Text style={styles.channel} numberOfLines={1}>{item.channelName}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  void removeReminder(item.key);
                }}
                style={({ focused }: any) => [styles.cancel, focused && styles.focused]}
              >
                <Ionicons name="close" size={16} color="#fff" />
              </Pressable>
            </View>
          )}
        />
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, marginTop: 6, marginBottom: 10 },
  list: { paddingBottom: 40, gap: 8 },
  empty: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, marginTop: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  main: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panel,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  when: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8 },
  program: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  channel: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5 },
  cancel: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panelRaised,
  },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
