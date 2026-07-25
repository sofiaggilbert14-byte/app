import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { Channel, Program } from "@/src/api";
import { TimelineGrid } from "@/src/components/TimelineGrid";
import { BoxGrid } from "@/src/components/BoxGrid";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { nowNext, progressPct, fmtTime } from "@/src/utils/time";
import dayjs from "dayjs";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type AppRoute = "/search" | "/favorites" | "/settings";

const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";
const GOLD_DEEP = "#7C4A11";
const PANEL = "rgba(27, 18, 12, 0.86)";
const PANEL_LIGHT = "rgba(48, 32, 20, 0.84)";
const BORDER_GOLD = "rgba(246, 183, 60, 0.34)";

function byChannelName(a: Channel, b: Channel): number {
  return (a.name || "").localeCompare(b.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function NavItem({
  icon,
  label,
  active,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ focused }: any) => [styles.navItem, active && styles.navItemActive, focused && styles.goldFocus]}
      testID={testID}
    >
      <Ionicons name={icon} size={23} color={active ? "#fff" : "rgba(255,255,255,0.74)"} />
      <Text numberOfLines={1} style={[styles.navText, active && styles.navTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CommandButton({
  icon,
  label,
  onPress,
  preferred,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  preferred?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      style={({ focused }: any) => [styles.commandBtn, focused && styles.goldFocus]}
      testID={testID}
    >
      <Ionicons name={icon} size={18} color={GOLD_SOFT} />
      <Text numberOfLines={1} style={styles.commandText}>
        {label}
      </Text>
    </Pressable>
  );
}

function GuideRow({
  label,
  program,
  active,
  onPress,
}: {
  label: string;
  program?: Program;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!program || !onPress}
      onPress={onPress}
      style={({ focused }: any) => [styles.guideRow, active && styles.guideRowActive, focused && styles.goldFocus]}
    >
      <View style={styles.guideTimeCol}>
        <Text style={[styles.guideLabel, active && styles.guideLabelActive]}>{label}</Text>
        <Text style={styles.guideTime}>{program ? fmtTime(program.start) : "--"}</Text>
      </View>
      <View style={styles.guideProgramCol}>
        <Text numberOfLines={1} style={[styles.guideTitle, active && styles.guideTitleActive]}>
          {program?.title || "No guide information"}
        </Text>
        <Text numberOfLines={1} style={styles.guideMeta}>
          {program?.stop ? `${fmtTime(program.start)} - ${fmtTime(program.stop)}` : program ? fmtTime(program.start) : "Guide still loading"}
        </Text>
      </View>
    </Pressable>
  );
}

export default function GuideScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const {
    channels,
    windowStart,
    windowEnd,
    loading,
    refreshing,
    error,
    refresh,
    hardRefresh,
    addRecent,
    openProgram,
    favorites,
    lastChannelId,
  } = useStore();
  const now = new Date().toISOString();

  const compact = width < 900;
  const shortScreen = height < 760;
  const [mode, setMode] = useState<"timeline" | "box">("box");
  const [group, setGroup] = useState<string>("All");
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const set = new Set<string>();
    channels.forEach((c: Channel) => c.group && set.add(c.group));
    return ["All", "Favorites", ...Array.from(set).sort()];
  }, [channels]);

  const filtered = useMemo(() => {
    const list =
      group === "All"
        ? channels
        : group === "Favorites"
          ? channels.filter((c: Channel) => favorites.includes(c.id))
          : channels.filter((c: Channel) => c.group === group);
    return [...list].sort(byChannelName);
  }, [channels, group, favorites]);

  const previewChannel = useMemo(() => {
    const focused = focusedChannelId ? filtered.find((c) => c.id === focusedChannelId) : null;
    if (focused) return focused;
    const last = lastChannelId ? channels.find((c) => c.id === lastChannelId) : null;
    return last || filtered.find((c) => c.programs?.length) || filtered[0] || null;
  }, [channels, filtered, focusedChannelId, lastChannelId]);

  const preview = useMemo(
    () => (previewChannel ? nowNext(previewChannel.programs, new Date(now)) : {}),
    [previewChannel, now],
  );

  const upcoming = useMemo(() => {
    const list = previewChannel?.programs || [];
    const nowMs = Date.parse(now);
    return list
      .filter((p) => Date.parse(p.start) >= nowMs)
      .slice(0, 4);
  }, [previewChannel, now]);

  const visibleUpcoming = useMemo(() => {
    const start = preview.next ? 1 : 0;
    const count = shortScreen ? 0 : 2;
    return upcoming.slice(start, start + count);
  }, [preview.next, shortScreen, upcoming]);

  const previewProgress = progressPct(preview.current, new Date(now));

  const openChannel = (c: Channel) => {
    void Haptics.selectionAsync().catch(() => {});
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };

  const openLastChannel = () => {
    const last = lastChannelId ? channels.find((c) => c.id === lastChannelId) : null;
    if (last) openChannel(last);
  };

  const openAdjacentChannel = (offset: number) => {
    if (!filtered.length) return;
    const currentIndex = previewChannel ? filtered.findIndex((c) => c.id === previewChannel.id) : 0;
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const target = filtered[(safeIndex + offset + filtered.length) % filtered.length];
    if (target) openChannel(target);
  };

  const navTo = (route: AppRoute) => {
    router.push(route as any);
  };

  return (
    <LinearGradient
      colors={["#050403", "#120B05", "#050403"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <View style={[styles.safeWrap, { paddingTop: insets.top + (shortScreen ? spacing.xs : spacing.md) }]}>
        {!compact && (
          <View style={styles.leftRail}>
            <View style={styles.brandBlock}>
              <LinearGradient colors={["#FFD782", "#B86F16"]} style={styles.phoenixMark}>
                <Ionicons name="flame" size={32} color="#1B1006" />
              </LinearGradient>
              <View>
                <Text style={styles.brandText}>
                  Charm<Text style={styles.brandGold}>IPTV</Text>
                </Text>
                <Text style={styles.brandSub}>Command Center</Text>
              </View>
            </View>

            <View style={styles.navList}>
              <NavItem icon="home" label="Home" active onPress={() => setGroup("All")} testID="cmd-nav-home" />
              <NavItem icon="calendar-outline" label="TV Guide" onPress={() => setMode("box")} testID="cmd-nav-guide" />
              <NavItem icon="search" label="Search" onPress={() => navTo("/search")} testID="cmd-nav-search" />
              <NavItem icon="heart-outline" label="Favorites" onPress={() => navTo("/favorites")} testID="cmd-nav-favorites" />
              <NavItem icon="settings-outline" label="Settings" onPress={() => navTo("/settings")} testID="cmd-nav-settings" />
              <NavItem icon="notifications-outline" label="Reminders" onPress={() => navTo("/favorites")} testID="cmd-nav-reminders" />
            </View>
          </View>
        )}

        <View style={styles.main}>
          <View style={[styles.topBar, shortScreen && styles.topBarShort]}>
            <View>
              <Text style={styles.kicker}>Live Preview</Text>
              <Text style={styles.title}>Black & Gold Command Center</Text>
            </View>
            <View style={styles.topActions}>
              <Text style={styles.clock}>{dayjs().format("ddd, MMM D")}  |  {dayjs().format("h:mm A")}</Text>
              <Pressable style={({ focused }: any) => [styles.roundIcon, focused && styles.goldFocus]} onPress={() => hardRefresh()} testID="cmd-refresh-btn">
                <Ionicons name="refresh" size={18} color="#fff" />
              </Pressable>
              <Pressable style={({ focused }: any) => [styles.roundIcon, focused && styles.goldFocus]} onPress={() => navTo("/settings")} testID="cmd-settings-btn">
                <Ionicons name="settings-outline" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={[styles.commandRow, shortScreen && styles.commandRowShort]}>
            <Pressable
              style={({ focused }: any) => [styles.heroCard, shortScreen && styles.heroCardShort, focused && styles.goldFocus]}
              onPress={() => previewChannel && openChannel(previewChannel)}
              testID="guide-preview-card"
            >
              <LinearGradient
                colors={["rgba(246,183,60,0.2)", "rgba(75,21,8,0.88)", "rgba(0,0,0,0.94)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.heroGlowA} />
              <View style={styles.heroGlowB} />
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>LIVE</Text>
              </View>
              <View style={styles.heroLogoWrap}>
                {previewChannel ? (
                  <ChannelLogo name={previewChannel.name} logo={previewChannel.logo} size={72} />
                ) : (
                  <Ionicons name="tv-outline" size={62} color={GOLD_SOFT} />
                )}
              </View>
              <View style={styles.heroInfo}>
                <Text numberOfLines={1} style={styles.heroProgram}>
                  {preview.current?.title || "Guide is ready"}
                </Text>
                <Text numberOfLines={1} style={styles.heroMeta}>
                  {previewChannel?.name || "Select a channel"} {preview.current ? ` | ${fmtTime(preview.current.start)} - ${preview.current.stop ? fmtTime(preview.current.stop) : "Later"}` : ""}
                </Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${previewProgress}%` }]} />
                </View>
              </View>
            </Pressable>

            <View style={[styles.guidePanel, shortScreen && styles.guidePanelShort]}>
              <View style={styles.panelTabs}>
                <Text style={[styles.panelTab, styles.panelTabActive]}>Now</Text>
                <Text style={styles.panelTab}>Next</Text>
                <Text style={styles.panelTab}>Coming Up</Text>
              </View>
              <GuideRow
                label="Now"
                active
                program={preview.current}
                onPress={preview.current && previewChannel ? () => openProgram(preview.current!, previewChannel) : undefined}
              />
              <GuideRow
                label="Next"
                program={preview.next}
                onPress={preview.next && previewChannel ? () => openProgram(preview.next!, previewChannel) : undefined}
              />
              {visibleUpcoming.map((p, i) => (
                <GuideRow
                  key={`${p.start}-${p.title}-${i}`}
                  label={i === 0 ? "Later" : fmtTime(p.start)}
                  program={p}
                  onPress={previewChannel ? () => openProgram(p, previewChannel) : undefined}
                />
              ))}
            </View>
          </View>

          <View style={[styles.commandControls, shortScreen && styles.commandControlsShort]}>
            <CommandButton icon="play-back" label="Previous" onPress={() => openAdjacentChannel(-1)} testID="cmd-prev-btn" />
            <CommandButton icon="return-up-back" label="Last Channel" onPress={openLastChannel} testID="cmd-last-btn" />
            <CommandButton icon="play-forward" label="Next Channel" onPress={() => openAdjacentChannel(1)} testID="cmd-next-btn" />
            <CommandButton icon="play" label="Continue" onPress={() => previewChannel && openChannel(previewChannel)} testID="cmd-continue-btn" />
            <CommandButton icon={mode === "box" ? "grid" : "list"} label={mode === "box" ? "Timeline" : "Box Grid"} onPress={() => setMode(mode === "box" ? "timeline" : "box")} testID="cmd-mode-btn" />
          </View>

          <View style={[styles.groupWrap, shortScreen && styles.groupWrapShort]}>
            <Text style={styles.sectionTitle}>A-Z Channels</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {groups.map((g) => (
                <Pressable
                  key={g}
                  onPress={() => setGroup(g)}
                  style={({ focused }: any) => [styles.chip, group === g && styles.chipActive, focused && styles.goldFocus]}
                  testID={`chip-${g}`}
                >
                  <Text style={[styles.chipText, group === g && styles.chipTextActive]}>{g}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <EpgProgressBar />

          {loading && channels.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator color={GOLD} size="large" />
              <Text style={styles.centerText}>Loading channels & guide...</Text>
            </View>
          ) : error && channels.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline-outline" size={42} color={GOLD_SOFT} />
              <Text style={styles.centerText}>{error}</Text>
              <Pressable style={({ focused }: any) => [styles.retryBtn, focused && styles.goldFocus]} onPress={() => refresh()} testID="guide-retry-btn">
                <Text style={styles.retryText}>Reload Guide</Text>
              </Pressable>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="tv-outline" size={42} color={GOLD_SOFT} />
              <Text style={styles.centerText}>No channels here yet</Text>
            </View>
          ) : (
            <FocusGuide style={styles.gridArea} autoFocus>
              {mode === "timeline" ? (
                <TimelineGrid
                  channels={filtered}
                  windowStart={windowStart}
                  windowEnd={windowEnd}
                  now={now}
                  onChannelPress={openChannel}
                  onProgramPress={openProgram}
                  onChannelFocus={(c) => setFocusedChannelId(c.id)}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                />
              ) : (
                <BoxGrid
                  channels={filtered}
                  now={now}
                  onChannelPress={openChannel}
                  onProgramPress={openProgram}
                  onChannelFocus={(c) => setFocusedChannelId(c.id)}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                />
              )}
            </FocusGuide>
          )}
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeWrap: { flex: 1, flexDirection: "row", paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  leftRail: {
    width: 220,
    paddingRight: spacing.md,
    borderRightWidth: 1,
    borderRightColor: "rgba(246,183,60,0.13)",
  },
  brandBlock: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl },
  phoenixMark: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GOLD,
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  brandText: { color: "#fff", fontFamily: fonts.bold, fontSize: 25 },
  brandGold: { color: GOLD },
  brandSub: { color: "rgba(255,227,163,0.72)", fontFamily: fonts.medium, fontSize: 12, marginTop: 1 },
  navList: { gap: spacing.sm },
  navItem: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
  },
  navItemActive: {
    backgroundColor: "rgba(246,183,60,0.22)",
    borderColor: BORDER_GOLD,
  },
  navText: { color: "rgba(255,255,255,0.74)", fontFamily: fonts.semibold, fontSize: 15 },
  navTextActive: { color: "#fff" },
  main: { flex: 1, paddingLeft: spacing.lg, gap: spacing.xs },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 46 },
  topBarShort: { minHeight: 34 },
  kicker: { color: colors.error, fontFamily: fonts.semibold, fontSize: 13 },
  title: { color: GOLD_SOFT, fontFamily: fonts.display, fontSize: 25, marginTop: 1 },
  topActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  clock: { color: "rgba(255,255,255,0.7)", fontFamily: fonts.medium, fontSize: 12 },
  roundIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  commandRow: { flexDirection: "row", gap: spacing.md, minHeight: 238, maxHeight: 280 },
  commandRowShort: { minHeight: 190, maxHeight: 212 },
  heroCard: {
    flex: 1.22,
    minHeight: 238,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    backgroundColor: "#130C06",
    padding: spacing.lg,
    justifyContent: "space-between",
  },
  heroCardShort: {
    minHeight: 190,
    padding: spacing.md,
  },
  heroGlowA: {
    position: "absolute",
    right: 60,
    top: 30,
    width: 220,
    height: 150,
    borderRadius: 120,
    backgroundColor: "rgba(246,183,60,0.20)",
  },
  heroGlowB: {
    position: "absolute",
    left: 70,
    bottom: 10,
    width: 260,
    height: 120,
    borderRadius: 140,
    backgroundColor: "rgba(225,29,72,0.16)",
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(225,29,72,0.92)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  heroBadgeText: { color: "#fff", fontFamily: fonts.bold, fontSize: 11 },
  heroLogoWrap: {
    alignSelf: "center",
    width: 124,
    height: 124,
    borderRadius: 62,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.24)",
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.16)",
  },
  heroInfo: { gap: spacing.xs },
  heroProgram: { color: "#fff", fontFamily: fonts.bold, fontSize: 20 },
  heroMeta: { color: "rgba(255,235,200,0.82)", fontFamily: fonts.medium, fontSize: 13 },
  progressTrack: {
    height: 5,
    backgroundColor: "rgba(255,255,255,0.20)",
    borderRadius: radius.pill,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  progressFill: { height: 5, backgroundColor: GOLD },
  guidePanel: {
    flex: 0.92,
    minHeight: 238,
    borderRadius: radius.lg,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    padding: spacing.md,
    gap: spacing.xs,
  },
  guidePanelShort: { minHeight: 190, padding: spacing.sm },
  panelTabs: { flexDirection: "row", justifyContent: "space-around", borderBottomWidth: 1, borderBottomColor: "rgba(246,183,60,0.18)" },
  panelTab: { color: "rgba(255,255,255,0.65)", fontFamily: fonts.semibold, fontSize: 14, paddingBottom: spacing.sm },
  panelTabActive: { color: GOLD_SOFT, borderBottomWidth: 2, borderBottomColor: GOLD },
  guideRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  guideRowActive: { backgroundColor: "rgba(124,74,17,0.40)", borderColor: BORDER_GOLD },
  guideTimeCol: { width: 74, paddingHorizontal: spacing.sm, gap: 2 },
  guideLabel: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.semibold, fontSize: 12 },
  guideLabelActive: { color: GOLD },
  guideTime: { color: "rgba(255,255,255,0.66)", fontFamily: fonts.regular, fontSize: 11 },
  guideProgramCol: { flex: 1, paddingRight: spacing.sm },
  guideTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 14 },
  guideTitleActive: { color: GOLD_SOFT },
  guideMeta: { color: "rgba(255,255,255,0.62)", fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  commandControls: { flexDirection: "row", gap: spacing.sm, minHeight: 42 },
  commandControlsShort: { minHeight: 36 },
  commandBtn: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: PANEL_LIGHT,
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.16)",
    paddingHorizontal: spacing.sm,
  },
  commandText: { color: "rgba(255,255,255,0.88)", fontFamily: fonts.semibold, fontSize: 11 },
  groupWrap: { gap: spacing.xs, minHeight: 66 },
  groupWrapShort: { minHeight: 46 },
  sectionTitle: { color: GOLD, fontFamily: fonts.bold, fontSize: 18 },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  chip: {
    height: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: "rgba(246,183,60,0.22)", borderColor: BORDER_GOLD },
  chipText: { color: "rgba(255,255,255,0.68)", fontFamily: fonts.medium, fontSize: 12 },
  chipTextActive: { color: GOLD_SOFT },
  gridArea: { flex: 1 },
  goldFocus: {
    borderColor: GOLD_SOFT,
    borderWidth: 2,
    shadowColor: GOLD,
    shadowOpacity: 0.65,
    shadowRadius: 14,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  centerText: { color: "rgba(255,255,255,0.74)", fontFamily: fonts.medium, fontSize: 14, textAlign: "center" },
  retryBtn: {
    backgroundColor: GOLD_DEEP,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
  },
  retryText: { color: "#fff", fontFamily: fonts.semibold },
});
