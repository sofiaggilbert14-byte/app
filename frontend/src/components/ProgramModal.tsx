import React from "react";
import { View, Text, StyleSheet, Modal, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { reminderKey } from "@/src/utils/time";

export function ProgramModal() {
  const { activeProgram, closeProgram, addReminder, removeReminder, hasReminder } = useStore();
  const router = useRouter();
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMsg(null);
  }, [activeProgram]);

  if (!activeProgram) return null;
  const { program, channel } = activeProgram;
  const key = reminderKey(channel.id, program.start);
  const reminded = hasReminder(key);
  const start = dayjs(program.start);
  const isFuture = start.isAfter(dayjs());
  const isLive = dayjs().isAfter(program.start) && program.stop && dayjs().isBefore(program.stop);

  const watch = () => {
    Haptics.selectionAsync();
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg("Reminder set — we'll alert you before it starts");
    } else {
      setMsg("Enable notifications to set reminders");
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={closeProgram}>
      <Pressable style={styles.backdrop} onPress={closeProgram} testID="program-modal-backdrop">
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.channel}>{channel.name}</Text>
            <Pressable onPress={closeProgram} hitSlop={10} testID="program-modal-close">
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
            <Text style={styles.desc} numberOfLines={6}>
              {program.desc}
            </Text>
          )}

          {msg && <Text style={styles.msg}>{msg}</Text>}

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.watchBtn]} onPress={watch} testID="program-watch-btn">
              <Ionicons name="play" size={16} color="#fff" />
              <Text style={styles.watchText}>Watch now</Text>
            </Pressable>
            {isFuture && (
              <Pressable
                style={[styles.btn, styles.remindBtn, reminded && styles.remindActive]}
                onPress={onReminder}
                testID="program-reminder-btn"
              >
                <Ionicons
                  name={reminded ? "notifications" : "notifications-outline"}
                  size={16}
                  color={reminded ? colors.brand : colors.onSurface}
                />
                <Text style={[styles.remindText, reminded && { color: colors.brand }]}>
                  {reminded ? "Reminder on" : "Remind me"}
                </Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  desc: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 4 },
  msg: { color: colors.success, fontFamily: fonts.medium, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
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
  remindActive: { borderColor: colors.brand },
  remindText: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14 },
});
