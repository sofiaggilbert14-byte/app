import React from "react";
import { View, Text, StyleSheet, Pressable, BackHandler, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { reminderKey } from "@/src/utils/time";
import { FocusGuide } from "@/src/components/TVFocusGuideView";

export function ProgramModal() {
  const { activeProgram, closeProgram, addReminder, removeReminder, hasReminder, reminders } = useStore();
  const router = useRouter();
  const [msg, setMsg] = React.useState<string | null>(null);
  // Subscribe to reminders so Cancel/Remind label updates immediately after toggle.
  void reminders;

  React.useEffect(() => {
    setMsg(null);
  }, [activeProgram]);

  // Close on the hardware / remote BACK button while the sheet is open.
  React.useEffect(() => {
    if (!activeProgram) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeProgram();
      return true;
    });
    return () => sub.remove();
  }, [activeProgram, closeProgram]);

  if (!activeProgram) return null;
  const { program, channel } = activeProgram;
  const key = reminderKey(channel.id, program.start);
  const reminded = hasReminder(key);
  const start = dayjs(program.start);
  const isFuture = start.isAfter(dayjs());
  const isLive = dayjs().isAfter(program.start) && program.stop && dayjs().isBefore(program.stop);

  const watch = () => {
    void Haptics.selectionAsync().catch(() => {});
    closeProgram();
    router.push({ pathname: "/player", params: { channelId: channel.id } });
  };

  const onReminder = async () => {
    if (reminded) {
      await removeReminder(key);
      setMsg("Reminder removed");
      return;
    }
    const ok = await addReminder(program, channel);
    if (ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMsg("Reminder set — we'll alert you before it starts");
    } else {
      setMsg("Enable notifications to set reminders");
    }
  };

  return (
    <View style={styles.overlay} testID="program-modal-overlay">
      <Pressable style={styles.backdrop} onPress={closeProgram} testID="program-modal-backdrop">
        <Pressable style={styles.card} onPress={() => {}}>
          {/* Trap the D-pad inside the sheet so the remote can reach every
              button and can't fall back onto the guide grid behind it. */}
          <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
            <View style={styles.header}>
              <Text style={styles.channel}>{channel.name}</Text>
              <Pressable
                style={({ focused }: any) => [styles.closeBtn, focused && styles.btnFocused]}
                onPress={closeProgram}
                hitSlop={10}
                testID="program-modal-close"
              >
                <Ionicons name="close" size={22} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>
            <Text style={styles.title}>{program.title}</Text>
            <Text style={styles.time}>
              {start.format("ddd, MMM D · h:mm A")}
              {program.stop ? ` – ${dayjs(program.stop).format("h:mm A")}` : ""}
              {isLive ? "  • LIVE" : ""}
            </Text>
            {!!program.category && <Text style={styles.category}>{program.category}</Text>}
            {!!program.desc && (
              <ScrollView style={styles.descBox} nestedScrollEnabled showsVerticalScrollIndicator>
                <Text style={styles.desc}>{program.desc}</Text>
              </ScrollView>
            )}

            {msg && <Text style={styles.msg}>{msg}</Text>}

            <View style={styles.actions}>
              <Pressable
                style={({ focused }: any) => [styles.btn, styles.watchBtn, focused && styles.btnFocused]}
                hasTVPreferredFocus
                onPress={watch}
                testID="program-watch-btn"
              >
                <Ionicons name="play" size={16} color="#fff" />
                <Text style={styles.watchText}>Watch now</Text>
              </Pressable>
              {isFuture && (
                <Pressable
                  style={({ focused }: any) => [
                    styles.btn,
                    styles.remindBtn,
                    reminded && styles.remindCancel,
                    focused && styles.btnFocused,
                  ]}
                  onPress={onReminder}
                  testID="program-reminder-btn"
                >
                  <Ionicons
                    name={reminded ? "notifications-off" : "notifications-outline"}
                    size={16}
                    color={reminded ? "#FACC15" : colors.onSurface}
                  />
                  <Text style={[styles.remindText, reminded && styles.remindCancelText]}>
                    {reminded ? "Cancel reminder" : "Remind me"}
                  </Text>
                </Pressable>
              )}
            </View>
          </FocusGuide>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  channel: { color: colors.brandSecondary, fontFamily: fonts.semibold, fontSize: 13 },
  title: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 24 },
  time: { color: colors.onSurfaceSecondary, fontFamily: fonts.medium, fontSize: 13 },
  category: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 12 },
  descBox: { maxHeight: 138, marginTop: 4 },
  desc: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  msg: { color: colors.success, fontFamily: fonts.medium, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  closeBtn: { padding: 4, borderRadius: radius.sm },
  btnFocused: { borderWidth: 2, borderColor: "#fff" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    flex: 1,
  },
  watchBtn: { backgroundColor: colors.brand },
  watchText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  remindBtn: { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  remindCancel: { borderColor: "#FACC15", backgroundColor: "rgba(250,204,21,0.12)" },
  remindText: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14 },
  remindCancelText: { color: "#FACC15" },
});
