import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import type { SourceStatus } from "@/src/api";
import { DeviceLayoutMode, GuideDensity, GuideLayout, PlayerControlsTimeoutMs, SafePreviewMode, useStore } from "@/src/store";
import {
  sourceStatus,
  refreshSource,
  subscribeSource,
  sourceDiagnostics,
  clearGuideCache,
  type SourceDiagnostics,
} from "@/src/source";
import { useTvBackToGuide } from "@/src/hooks/use-tv-back-to-guide";
import { getTvSafeInsets } from "@/src/utils/tvLayout";

const GOLD = "#E3262E";
const GOLD_SOFT = "#FFFFFF";
const GOLD_DEEP = "#A80F17";
const PANEL = "rgba(24, 28, 34, 0.94)";
const BORDER_GOLD = "rgba(227, 38, 46, 0.38)";

type SettingsSection = "guide" | "playback" | "remote" | "appearance" | "accessibility" | "about";

const SETTINGS_SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { id: "guide", label: "Guide", icon: "list" },
  { id: "playback", label: "Playback", icon: "play-circle-outline" },
  { id: "remote", label: "Remote Control", icon: "game-controller-outline" },
  { id: "appearance", label: "Appearance", icon: "color-palette-outline" },
  { id: "accessibility", label: "Accessibility", icon: "accessibility-outline" },
  { id: "about", label: "About", icon: "information-circle-outline" },
];

export default function SettingsScreen() {
  const {
    refresh: refreshGuide,
    hardRefresh,
    refreshing,
    pointerMode,
    setPointerMode,
    guideLayout,
    setGuideLayout,
    guideDensity,
    setGuideDensity,
    safePreviewMode,
    setSafePreviewMode,
    channelNumbers,
    setChannelNumbers,
    channelLogos,
    setChannelLogos,
    deviceLayoutMode,
    setDeviceLayoutMode,
    playerControlsTimeoutMs,
    setPlayerControlsTimeoutMs,
    autoRetryStreams,
    setAutoRetryStreams,
  } = useStore();
  const { width, height } = useWindowDimensions();
  const tvSafe = getTvSafeInsets(width, height);
  const compactSettings = width < 720 || (deviceLayoutMode === "mobile" && !Platform.isTV);
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostics | null>(null);
  const [section, setSection] = useState<SettingsSection>("guide");
  useTvBackToGuide();
const appVersion = Constants.expoConfig?.version || "2.0.0-beta";
  const androidVersionCode = (Constants.expoConfig as any)?.android?.versionCode;

  const loadStatus = useCallback(() => {
    setStatus(sourceStatus());
    sourceDiagnostics().then(setDiagnostics).catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus();
    // Keep stats fresh as the staged parse emits (channels first, then EPG).
    return subscribeSource(loadStatus);
  }, [loadStatus]);

  const doRefresh = async () => {
    setBusy(true);
    Haptics.selectionAsync();
    try {
      const s = await refreshSource(true);
      setStatus(s);
      await refreshGuide(true);
      loadStatus();
    } catch {}
    setBusy(false);
  };

  const resetGuideData = async () => {
    setBusy(true);
    Haptics.selectionAsync();
    try {
      await clearGuideCache();
      loadStatus();
      const s = await refreshSource(true);
      setStatus(s);
      await refreshGuide(true);
      loadStatus();
    } catch {}
    setBusy(false);
  };

  const onPullRefresh = async () => {
    await hardRefresh();
    loadStatus();
  };

  return (
    <View
      style={[
        styles.container,
        compactSettings && styles.containerMobile,
        {
          paddingLeft: tvSafe.left,
          paddingRight: tvSafe.right,
          paddingBottom: tvSafe.bottom,
          paddingTop: tvSafe.top,
        },
      ]}
    >
      <View style={[styles.settingsSidebar, compactSettings && styles.settingsSidebarMobile]}>
        <View style={[styles.settingsBrand, compactSettings && styles.settingsBrandMobile]}>
          <View style={styles.settingsBrandLine}>
            <Text style={styles.settingsBrandCharm}>CHARM</Text>
            <Text style={styles.settingsBrandIptv}> IPTV</Text>
          </View>
          <Text style={styles.settingsVersionClean}>EXPERIMENTAL v3</Text>
          <Text style={styles.settingsVersion}>— EXPERIMENTAL v3 —</Text>
        </View>
        <Text style={[styles.settingsHeading, compactSettings && styles.settingsHeadingMobile]}>Settings</Text>
        <View style={[styles.settingsNav, compactSettings && styles.settingsNavMobile]}>
          {SETTINGS_SECTIONS.map((item, index) => (
            <Pressable
              key={item.id}
              hasTVPreferredFocus={index === 0}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => {});
                setSection(item.id);
              }}
              style={({ focused }: any) => [
                styles.settingsNavRow,
                compactSettings && styles.settingsNavRowMobile,
                section === item.id && styles.settingsNavActive,
                focused && styles.settingsNavFocused,
              ]}
              testID={`settings-section-${item.id}`}
            >
              <Ionicons name={item.icon} color="#fff" size={19} />
              <Text style={styles.settingsNavText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.settingsContent, compactSettings && styles.settingsContentMobile]}>
        <Text style={styles.settingsContentTitle}>
          {SETTINGS_SECTIONS.find((item) => item.id === section)?.label} settings
        </Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.settingsScrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={GOLD}
              colors={[GOLD]}
            />
          }
        >
          {section === "guide" && (
            <>
              <View style={styles.card}>
                <CycleRow<GuideLayout>
                  label="Guide layout"
                  value={guideLayout}
                  options={[
                    { label: "Timeline", value: "cinematic" },
                    { label: "Grid", value: "compact" },
                  ]}
                  onChange={setGuideLayout}
                />
                <View style={styles.cycleRowStatic}>
                  <Text style={styles.cycleLabel}>Visible hours</Text>
                  <Text style={styles.cycleValue}>8 hours</Text>
                </View>
                <CycleRow<GuideDensity>
                  label="Channel row density"
                  value={guideDensity}
                  options={[
                    { label: "Comfortable", value: "large" },
                    { label: "Normal", value: "normal" },
                    { label: "Compact", value: "compact" },
                  ]}
                  onChange={setGuideDensity}
                />
                <CycleRow<SafePreviewMode>
                  label="Live preview"
                  value={safePreviewMode}
                  options={[
                    { label: "After focus settles", value: "on" },
                    { label: "Extra delay", value: "delayed" },
                    { label: "Off", value: "off" },
                  ]}
                  onChange={setSafePreviewMode}
                />
                <ToggleRow
                  label="Channel numbers"
                  sub="Show lineup numbers beside channel logos."
                  value={channelNumbers}
                  onChange={setChannelNumbers}
                  testID="settings-channel-numbers-toggle"
                />
                <ToggleRow
                  label="Channel logos"
                  sub="Cached logos are used when available; initials remain the fallback."
                  value={channelLogos}
                  onChange={setChannelLogos}
                  testID="settings-channel-logos-toggle"
                />
              </View>

              <Pressable
                style={({ focused }: any) => [styles.refreshRow, focused && styles.focusRing]}
                onPress={doRefresh}
                disabled={busy}
                testID="settings-refresh-btn"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="refresh" size={19} color="#fff" />}
                <Text style={styles.refreshRowText}>Refresh playlist & EPG</Text>
              </Pressable>

              <View style={styles.healthRow}>
                <View style={styles.healthCard}>
                  <Text style={styles.healthEyebrow}>SOURCE HEALTH</Text>
                  {!status ? (
                    <ActivityIndicator color={GOLD} />
                  ) : (
                    <View style={styles.healthStats}>
                      <View style={styles.healthStat}>
                        <Ionicons name="server-outline" size={28} color={GOLD} />
                        <Text style={styles.healthLabel}>Channels loaded</Text>
                        <Text style={styles.healthValue}>{status.channel_count}</Text>
                      </View>
                      <View style={styles.healthDivider} />
                      <View style={styles.healthStat}>
                        <Ionicons name="book-outline" size={28} color={GOLD} />
                        <Text style={styles.healthLabel}>Channels with EPG</Text>
                        <Text style={styles.healthValue}>{status.channels_with_epg}</Text>
                      </View>
                    </View>
                  )}
                </View>
                <View style={styles.healthDetails}>
                  <Text style={styles.cardTitle}>Local guide cache</Text>
                  <Stat label="Cached programs" value={String(diagnostics?.programs || 0)} />
                  <Stat label="Refresh active" value={diagnostics?.refreshInFlight ? "Yes" : "No"} />
                  <Stat
                    label="Next automatic refresh"
                    value={diagnostics?.nextAutoRefresh ? dayjs(diagnostics.nextAutoRefresh).format("MMM D, h:mm A") : "—"}
                  />
                  <Stat
                    label="Cache size"
                    value={diagnostics ? `${(diagnostics.cacheBytes / 1024 / 1024).toFixed(1)} MB` : "—"}
                  />
                  {diagnostics?.epgError ? <Text style={styles.errText}>EPG: {diagnostics.epgError}</Text> : null}
                </View>
              </View>
            </>
          )}

          {section === "playback" && (
            <View style={styles.card}>
              <ChoiceRow<PlayerControlsTimeoutMs>
                label="Player controls timeout"
                value={playerControlsTimeoutMs}
                options={[
                  { label: "8 sec", value: 8000 },
                  { label: "15 sec", value: 15000 },
                  { label: "30 sec", value: 30000 },
                  { label: "60 sec", value: 60000 },
                ]}
                onChange={setPlayerControlsTimeoutMs}
              />
              <ToggleRow
                label="Auto retry streams"
                sub="Reconnect automatically when a live stream drops."
                value={autoRetryStreams}
                onChange={setAutoRetryStreams}
                testID="settings-auto-retry-toggle"
              />
            </View>
          )}

          {section === "remote" && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Remote Control</Text>
              <Text style={styles.sub}>
                The D-pad moves focus between groups, the timeline, and player controls. Pointer mode is available for boxes with unreliable native focus.
              </Text>
              <Pressable
                style={({ focused }: any) => [styles.toggleRow, focused && styles.focusRing]}
                onPress={() => setPointerMode(!pointerMode)}
                testID="settings-pointer-toggle"
              >
                <Text style={styles.settingLabel}>Pointer mode</Text>
                <TogglePill value={pointerMode} />
              </Pressable>
            </View>
          )}

          {section === "appearance" && (
            <View style={styles.card}>
              <ChoiceRow<DeviceLayoutMode>
                label="Device layout"
                value={deviceLayoutMode}
                options={[
                  { label: "Auto", value: "auto" },
                  { label: "TV", value: "tv" },
                  { label: "Mobile", value: "mobile" },
                ]}
                onChange={setDeviceLayoutMode}
              />
              <ChoiceRow<GuideDensity>
                label="Guide density"
                value={guideDensity}
                options={[
                  { label: "Comfortable", value: "large" },
                  { label: "Normal", value: "normal" },
                  { label: "Compact", value: "compact" },
                ]}
                onChange={setGuideDensity}
              />
            </View>
          )}

          {section === "accessibility" && (
            <View style={styles.card}>
              <ToggleRow
                label="Always show channel numbers"
                sub="Adds a consistent numeric landmark to each guide row."
                value={channelNumbers}
                onChange={setChannelNumbers}
                testID="settings-accessibility-channel-numbers"
              />
              <ChoiceRow<SafePreviewMode>
                label="Preview motion"
                value={safePreviewMode}
                options={[
                  { label: "Normal", value: "on" },
                  { label: "Reduced", value: "delayed" },
                  { label: "Off", value: "off" },
                ]}
                onChange={setSafePreviewMode}
              />
            </View>
          )}

          {section === "about" && (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Charm IPTV Experimental v3</Text>
                <Stat label="Build" value={`v${appVersion}${androidVersionCode ? ` (${androidVersionCode})` : ""}`} />
                <Stat label="Platform" value={Platform.isTV ? "Android TV / Fire TV" : Platform.OS} />
                <Stat label="Data mode" value={diagnostics?.mode || "—"} />
                <ChecklistItem label="Separate install from stable CharmIPTV" />
                <ChecklistItem label="Device-local M3U and XMLTV guide" />
                <ChecklistItem label="24-hour automatic refresh cache" />
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Guide maintenance</Text>
                <Pressable
                  style={({ focused }: any) => [styles.secondaryBtn, focused && styles.focusRing]}
                  onPress={async () => {
                    await clearGuideCache();
                    loadStatus();
                  }}
                  testID="settings-clear-guide-cache-btn"
                >
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.secondaryText}>Clear Guide Cache</Text>
                </Pressable>
                <Pressable
                  style={({ focused }: any) => [styles.primaryBtn, focused && styles.focusRing]}
                  onPress={resetGuideData}
                  disabled={busy}
                  testID="settings-reset-guide-data-btn"
                >
                  <Ionicons name="cloud-download-outline" size={18} color="#fff" />
                  <Text style={styles.primaryText}>Reset & Reload Guide</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function ChecklistItem({ label }: { label: string }) {
  return (
    <View style={styles.checkRow}>
      <Ionicons name="checkmark-circle" size={17} color={colors.success} />
      <Text style={styles.checkText}>{label}</Text>
    </View>
  );
}

function CycleRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  const currentIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const current = options[currentIndex] || options[0];
  return (
    <Pressable
      style={({ focused }: any) => [styles.cycleRow, focused && styles.focusRing]}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onChange(options[(currentIndex + 1) % options.length].value);
      }}
    >
      <Text style={styles.cycleLabel}>{label}</Text>
      <View style={styles.cycleSelection}>
        <Text style={styles.cycleValue}>{current?.label}</Text>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.72)" />
      </View>
    </Pressable>
  );
}

function ChoiceRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.choiceBlock}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => {
                Haptics.selectionAsync();
                onChange(option.value);
              }}
              style={({ focused }: any) => [styles.choiceBtn, active && styles.choiceBtnActive, focused && styles.focusRing]}
            >
              <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  sub,
  value,
  onChange,
  testID,
}: {
  label: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID: string;
}) {
  return (
    <Pressable
      style={({ focused }: any) => [styles.toggleRow, focused && styles.focusRing]}
      onPress={() => {
        Haptics.selectionAsync();
        onChange(!value);
      }}
      focusable
      testID={testID}
    >
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <TogglePill value={value} />
    </Pressable>
  );
}

function TogglePill({ value }: { value: boolean }) {
  return (
    <View style={[styles.togglePill, value && styles.togglePillActive]}>
      <View style={[styles.toggleDot, value && styles.toggleDotActive]} />
      <Text style={[styles.toggleText, value && styles.toggleTextActive]}>{value ? "ON" : "OFF"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#05070A", flexDirection: "row" },
  containerMobile: { flexDirection: "column" },
  settingsSidebar: {
    backgroundColor: "#090C10",
    borderRightColor: "rgba(255,255,255,0.14)",
    borderRightWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 9,
    width: "16.5%",
    minWidth: 196,
    maxWidth: 224,
  },
  settingsSidebarMobile: {
    borderBottomColor: "rgba(255,255,255,0.12)",
    borderBottomWidth: 1,
    borderRightWidth: 0,
    maxWidth: undefined,
    minWidth: 0,
    paddingBottom: 6,
    width: "100%",
  },
  settingsBrand: { gap: 1, marginBottom: 8, paddingHorizontal: 5 },
  settingsBrandMobile: { marginBottom: 3 },
  settingsBrandLine: { flexDirection: "row", alignItems: "baseline" },
  settingsBrandCharm: { color: GOLD, fontFamily: fonts.bold, fontSize: 18 },
  settingsBrandIptv: { color: "#fff", fontFamily: fonts.medium, fontSize: 14 },
  settingsVersion: { display: "none" },
  settingsVersionClean: { color: GOLD, fontFamily: fonts.medium, fontSize: 7, letterSpacing: 0.6 },
  settingsHeading: { color: "#fff", fontFamily: fonts.bold, fontSize: 17, marginBottom: 7, paddingHorizontal: 5 },
  settingsHeadingMobile: { display: "none" },
  settingsNav: { gap: 1 },
  settingsNavMobile: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
  settingsNavRow: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: "row",
    gap: 7,
    minHeight: 36,
    paddingHorizontal: 7,
  },
  settingsNavActive: { backgroundColor: GOLD_DEEP },
  settingsNavRowMobile: { flexBasis: "32%", flexGrow: 1, minHeight: 32 },
  settingsNavFocused: { backgroundColor: GOLD_DEEP, borderColor: "#fff" },
  settingsNavText: { color: "#fff", fontFamily: fonts.medium, fontSize: 11.5 },
  settingsContent: { flex: 1, paddingHorizontal: 14, paddingTop: 9 },
  settingsContentMobile: { paddingHorizontal: 8, paddingTop: 6 },
  settingsContentTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 21, marginBottom: 6 },
  settingsScrollContent: { gap: 5, paddingBottom: 48 },
  refreshRow: {
    alignItems: "center",
    backgroundColor: "#1B2026",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.sm,
    borderWidth: 0,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 9,
  },
  refreshRowText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11.5 },
  healthRow: { flexDirection: "row", gap: 7, marginTop: 4 },
  healthCard: {
    backgroundColor: PANEL,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    gap: spacing.md,
    minHeight: 120,
    padding: 9,
  },
  healthEyebrow: { color: GOLD, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.7 },
  healthStats: { alignItems: "stretch", flex: 1, flexDirection: "row" },
  healthStat: { alignItems: "center", flex: 1, gap: spacing.xs, justifyContent: "center" },
  healthDivider: { backgroundColor: "rgba(255,255,255,0.14)", width: 1 },
  healthLabel: { color: "rgba(255,255,255,0.78)", fontFamily: fonts.medium, fontSize: 10, textAlign: "center" },
  healthValue: { color: "#fff", fontFamily: fonts.bold, fontSize: 22 },
  healthDetails: {
    backgroundColor: PANEL,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1.45,
    gap: spacing.xs,
    minHeight: 120,
    padding: 9,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(227,38,46,0.24)",
    backgroundColor: "rgba(9,12,16,0.96)",
  },
  brand: { color: GOLD, fontFamily: fonts.semibold, fontSize: 12 },
  title: { color: "#fff", fontFamily: fonts.display, fontSize: 28 },
  card: {
    backgroundColor: PANEL,
    borderRadius: radius.sm,
    borderWidth: 0,
    marginHorizontal: 0,
    marginTop: 2,
    padding: 5,
    gap: 3,
  },
  cardTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  settingLabel: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11.5 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sub: { color: "rgba(255,255,255,0.68)", fontFamily: fonts.regular, fontSize: 10, lineHeight: 13 },
  cycleRow: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 39,
    paddingHorizontal: 9,
  },
  cycleRowStatic: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderRadius: radius.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 39,
    paddingHorizontal: 11,
  },
  cycleLabel: { color: "#fff", fontFamily: fonts.medium, fontSize: 11.5 },
  cycleSelection: { alignItems: "center", flexDirection: "row", gap: 5 },
  cycleValue: { color: "rgba(255,255,255,0.90)", fontFamily: fonts.medium, fontSize: 11.5 },
  choiceBlock: { gap: spacing.xs, marginTop: spacing.xs },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choiceBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  choiceBtnActive: { backgroundColor: "rgba(227,38,46,0.26)", borderColor: GOLD },
  choiceText: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.semibold, fontSize: 12 },
  choiceTextActive: { color: "#fff" },
  hint: { color: "rgba(255,255,255,0.58)", fontFamily: fonts.regular, fontSize: 11, textAlign: "center" },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs },
  statLabel: { color: "rgba(255,255,255,0.62)", fontFamily: fonts.regular, fontSize: 14 },
  statValue: { color: GOLD_SOFT, fontFamily: fonts.semibold, fontSize: 14 },
  errText: { color: colors.error, fontFamily: fonts.medium, fontSize: 12 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  checkText: { color: "rgba(255,255,255,0.78)", fontFamily: fonts.regular, fontSize: 13, flex: 1 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: GOLD_DEEP,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
  },
  primaryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  secondaryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  toggleRow: {
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 9,
    paddingVertical: 5,
    gap: 8,
  },
  togglePressRow: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  toggleActionText: { color: GOLD_SOFT, fontFamily: fonts.semibold, fontSize: 13 },
  togglePill: {
    width: 60,
    height: 26,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  togglePillActive: { borderColor: GOLD, backgroundColor: "rgba(227,38,46,0.22)" },
  toggleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.36)" },
  toggleDotActive: { backgroundColor: GOLD },
  toggleText: { color: "rgba(255,255,255,0.56)", fontFamily: fonts.bold, fontSize: 9.5 },
  toggleTextActive: { color: GOLD_SOFT },
  focusRing: {
    borderWidth: 2,
    borderColor: GOLD_SOFT,
    shadowColor: GOLD,
    shadowOpacity: 0.38,
    shadowRadius: 7,
  },
});
