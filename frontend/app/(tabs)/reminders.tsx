import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { useStore, type Reminder } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import { fmtDayTime } from "@/src/utils/time";

const COLUMNS = 6;

function formatEta(msLeft: number): string {
  if (msLeft <= 0) return "LIVE";
  const totalSec = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function ReminderCard({
  item,
  cardWidth,
  nowMs,
  logos,
  onCancel,
}: {
  item: Reminder;
  cardWidth: number;
  nowMs: number;
  logos: boolean;
  onCancel: (key: string) => void;
}) {
  const startMs = Date.parse(item.start);
  const msLeft = Number.isFinite(startMs) ? startMs - nowMs : 0;
  const when = fmtDayTime(item.start);
  const description =
    item.programDesc?.trim() ||
    `${item.programTitle || "Program"} on ${item.channelName || "channel"}.`;

  return (
    <View style={[styles.card, { width: cardWidth }]} testID={`reminder-card-${item.key}`}>
      <View style={styles.cardHeader}>
        <ChannelLogo
          name={item.channelName || "Channel"}
          logo={item.channelLogo || undefined}
          size={42}
          disabled={!logos}
        />
        <View style={styles.cardHeaderText}>
          <Text style={styles.channelName} numberOfLines={1}>
            {item.channelName || "Channel"}
          </Text>
          <Text style={styles.whenLine} numberOfLines={2}>
            {when}
            <Text style={styles.whenSep}>{"  /  "}</Text>
            <Text style={styles.etaLabel}>ETA : </Text>
            <Text style={styles.etaValue}>{formatEta(msLeft)}</Text>
          </Text>
        </View>
      </View>
      <Text style={styles.programTitle} numberOfLines={2}>
        {item.programTitle || "Upcoming programme"}
      </Text>
      <Text style={styles.description} numberOfLines={4}>
        {description}
      </Text>
      <Pressable
        onPress={() => onCancel(item.key)}
        style={({ focused }: any) => [styles.cancelButton, focused && styles.cancelFocused]}
        testID={`reminder-cancel-${item.key}`}
      >
        <Ionicons name="close-circle-outline" size={14} color="#fff" />
        <Text style={styles.cancelText}>Cancel Reminder</Text>
      </Pressable>
    </View>
  );
}

function RemindersScreenContent() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const { openDrawer } = usePurpleTvDrawer();
  const { reminders, removeReminder, channelById, channelLogos } = useStore();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [preferInitialFocus, setPreferInitialFocus] = useState(true);

  useTvBackHandler(
    useCallback(() => {
      // Defer to PurpleTvShell — single Back must never open the drawer.
      return false;
    }, []),
  );

  useEffect(() => {
    if (!isFocused) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isFocused]);

  useFocusEffect(
    useCallback(() => {
      setPreferInitialFocus(true);
      const timer = setTimeout(() => setPreferInitialFocus(false), 700);
      return () => clearTimeout(timer);
    }, []),
  );

  const upcoming = useMemo(() => {
    return reminders
      .map((item) => {
        const channel = channelById(item.channelId);
        return {
          ...item,
          channelName: item.channelName || channel?.name || "Channel",
          channelLogo: item.channelLogo || channel?.logo || null,
          programDesc: item.programDesc || "",
        };
      })
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }, [channelById, reminders]);

  const gap = width >= 1200 ? 14 : 10;
  const pagePad = 18;
  const cardWidth = Math.max(
    140,
    Math.floor((width - pagePad * 2 - gap * (COLUMNS - 1) - 8) / COLUMNS),
  );

  const returnToGuide = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    router.replace("/guide" as any);
  }, [router]);

  const openDrawerFromReminders = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    openDrawer({ focusTop: true });
  }, [openDrawer]);

  const cancelReminder = useCallback(
    (key: string) => {
      void Haptics.selectionAsync().catch(() => undefined);
      void removeReminder(key);
    },
    [removeReminder],
  );

  return (
    <PurpleTvShell active="/reminders">
      <View style={styles.page} testID="reminders-page">
        <View style={styles.topBar}>
          <View style={styles.topActions}>
            <Pressable
              hasTVPreferredFocus={preferInitialFocus}
              onPress={returnToGuide}
              style={({ focused }: any) => [styles.returnButton, focused && styles.returnFocused]}
              testID="reminders-return-guide"
            >
              <Ionicons name="arrow-back" size={14} color="#fff" />
              <Text style={styles.returnText}>Return to Guide</Text>
            </Pressable>
            <Pressable
              onPress={openDrawerFromReminders}
              style={({ focused }: any) => [styles.returnButton, focused && styles.returnFocused]}
              testID="reminders-open-drawer"
            >
              <Ionicons name="menu-outline" size={14} color="#fff" />
              <Text style={styles.returnText}>Drawer</Text>
            </Pressable>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{upcoming.length} UPCOMING</Text>
          </View>
        </View>

        <Text style={styles.kicker}>YOUR WATCHLIST</Text>
        <Text style={styles.title}>My Reminders</Text>
        <Text style={styles.help}>
          Never miss what you’re waiting for. Set reminders from the Guide — cards appear here
          instantly and disappear the moment you cancel.
        </Text>

        <FlatList
          data={upcoming}
          keyExtractor={(item) => item.key}
          numColumns={COLUMNS}
          columnWrapperStyle={[styles.row, { gap }]}
          contentContainerStyle={[styles.list, { gap }]}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No reminders yet</Text>
              <Text style={styles.empty}>
                In the Guide, focus a future show and choose Remind. Each reminder creates one of
                these cards.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ReminderCard
              item={item}
              cardWidth={cardWidth}
              nowMs={nowMs}
              logos={isFocused && channelLogos}
              onCancel={cancelReminder}
            />
          )}
        />
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: tvColors.canvas,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  returnButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panel,
  },
  returnFocused: {
    borderColor: "#fff",
    backgroundColor: tvColors.purpleDeep,
  },
  returnText: {
    color: "#fff",
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: tvColors.purpleDeep,
  },
  badgeText: {
    color: "#F3E8FF",
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  kicker: {
    color: tvColors.purpleSoft,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: 1.4,
  },
  title: {
    color: "#fff",
    fontFamily: fonts.bold,
    fontSize: 26,
    marginTop: 2,
  },
  help: {
    color: tvColors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 10,
    marginTop: 6,
    marginBottom: 14,
    maxWidth: 720,
  },
  list: {
    paddingBottom: 36,
  },
  row: {
    flexDirection: "row",
  },
  emptyWrap: {
    marginTop: 28,
    padding: 18,
    borderRadius: radius.md,
    backgroundColor: tvColors.panel,
    borderWidth: 1,
    borderColor: tvColors.line,
  },
  emptyTitle: {
    color: "#fff",
    fontFamily: fonts.semibold,
    fontSize: 14,
    marginBottom: 6,
  },
  empty: {
    color: tvColors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 16,
  },
  card: {
    backgroundColor: tvColors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: tvColors.lineStrong,
    padding: 12,
    minHeight: 210,
    justifyContent: "space-between",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  channelName: {
    color: "#fff",
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  whenLine: {
    color: "rgba(255,255,255,0.78)",
    fontFamily: fonts.medium,
    fontSize: 8.5,
    lineHeight: 12,
  },
  whenSep: {
    color: "rgba(255,255,255,0.35)",
  },
  etaLabel: {
    color: tvColors.purpleSoft,
    fontFamily: fonts.semibold,
  },
  etaValue: {
    color: "#FDE68A",
    fontFamily: fonts.bold,
  },
  programTitle: {
    color: "#fff",
    fontFamily: fonts.semibold,
    fontSize: 12,
    marginTop: 10,
  },
  description: {
    color: tvColors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 6,
    flexGrow: 1,
  },
  cancelButton: {
    marginTop: 12,
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.purpleDeep,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  cancelFocused: {
    borderColor: "#fff",
    backgroundColor: tvColors.purple,
  },
  cancelText: {
    color: "#fff",
    fontFamily: fonts.semibold,
    fontSize: 9.5,
  },
});

export default function RemindersScreen() {
  return (
    <FocusedTabMount>
      <RemindersScreenContent />
    </FocusedTabMount>
  );
}
