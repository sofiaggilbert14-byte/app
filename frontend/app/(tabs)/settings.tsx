import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import type { SourceStatus } from "@/src/api";
import {
  DeviceLayoutMode,
  GuideDensity,
  GuideLayout,
  PlayerControlsTimeoutMs,
  SafePreviewMode,
  useStore,
} from "@/src/store";
import {
  clearGuideCache,
  refreshSource,
  sourceDiagnostics,
  sourceStatus,
  subscribeSource,
  type SourceDiagnostics,
} from "@/src/source";
import {
  type PlayerEnginePreference,
  usePlayerEnginePreference,
} from "@/src/playerEnginePreference";
import { TvCalibrationControls } from "@/src/components/TvCalibrationControls";
import { useTvBackToGuide } from "@/src/hooks/use-tv-back-to-guide";
import { getTvSafeInsets } from "@/src/utils/tvLayout";

const RED = "#E3262E";
const RED_DEEP = "#A80F17";
const PANEL = "rgba(24,28,34,0.94)";

type SettingsSection = "guide" | "playback" | "remote" | "appearance" | "accessibility" | "about";

const SECTIONS: { id: SettingsSection; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
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
  const [playerEnginePreference, setPlayerEnginePreference] = usePlayerEnginePreference();

  const { width, height } = useWindowDimensions();
  const tvSafe = useMemo(() => getTvSafeInsets(width, height), [width, height]);
  const compact = width < 720 || (deviceLayoutMode === "mobile" && !Platform.isTV);
  const [section, setSection] = useState<SettingsSection>("guide");
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  useTvBackToGuide();

  const appVersion = Constants.expoConfig?.version || "2.0.0-beta";
  const androidVersionCode = (Constants.expoConfig as any)?.android?.versionCode;

  const loadStatus = useCallback(() => {
    setStatus(sourceStatus());
    sourceDiagnostics().then(setDiagnostics).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadStatus();
    return subscribeSource(loadStatus);
  }, [loadStatus]);

  const doRefresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      setStatus(await refreshSource(true));
      await refreshGuide(true);
      loadStatus();
    } finally {
      setBusy(false);
    }
  }, [busy, loadStatus, refreshGuide]);

  const resetGuideData = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearGuideCache();
      setStatus(await refreshSource(true));
      await refreshGuide(true);
      loadStatus();
    } finally {
      setBusy(false);
    }
  }, [busy, loadStatus, refreshGuide]);

  return (
    <View
      style={[
        styles.container,
        compact && styles.containerCompact,
        { paddingTop: tvSafe.top, paddingBottom: tvSafe.bottom, paddingLeft: tvSafe.left, paddingRight: tvSafe.right },
      ]}
    >
      <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
        <View style={styles.brandRow}>
          <Text style={styles.brandCharm}>CHARM</Text>
          <Text style={styles.brandIptv}> IPTV</Text>
        </View>
        <Text style={styles.versionMark}>EXPERIMENTAL v3</Text>
        <View style={[styles.nav, compact && styles.navCompact]}>
          {SECTIONS.map((item, index) => (
            <Pressable
              key={item.id}
              hasTVPreferredFocus={index === 0}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => undefined);
                setSection(item.id);
              }}
              style={({ focused }: any) => [
                styles.navItem,
                compact && styles.navItemCompact,
                section === item.id && styles.navActive,
                focused && styles.focused,
              ]}
              testID={`settings-section-${item.id}`}
            >
              <Ionicons name={item.icon} size={18} color="#fff" />
              <Text style={styles.navText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.content}>
        <Text style={styles.heading}>{SECTIONS.find((item) => item.id === section)?.label} settings</Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={hardRefresh} tintColor={RED} colors={[RED]} />
          }
        >
          {section === "guide" && (
            <>
              <Card>
                <ChoiceRow label="Guide layout" value={guideLayout} options={[
                  { label: "Timeline", value: "cinematic" as GuideLayout },
                  { label: "Grid", value: "compact" as GuideLayout },
                ]} onChange={setGuideLayout} />
                <ChoiceRow label="Channel row density" value={guideDensity} options={[
                  { label: "Comfortable", value: "large" as GuideDensity },
                  { label: "Normal", value: "normal" as GuideDensity },
                  { label: "Compact", value: "compact" as GuideDensity },
                ]} onChange={setGuideDensity} />
                <ChoiceRow label="Live preview" value={safePreviewMode} options={[
                  { label: "Normal", value: "on" as SafePreviewMode },
                  { label: "Delayed", value: "delayed" as SafePreviewMode },
                  { label: "Off", value: "off" as SafePreviewMode },
                ]} onChange={setSafePreviewMode} />
                <ToggleRow label="Channel numbers" sub="Show lineup numbers beside channel logos." value={channelNumbers} onChange={setChannelNumbers} />
                <ToggleRow label="Channel logos" sub="Show cached logos when available." value={channelLogos} onChange={setChannelLogos} />
              </Card>

              <Pressable style={({ focused }: any) => [styles.action, focused && styles.focused]} onPress={doRefresh} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="refresh" size={18} color="#fff" />}
                <Text style={styles.actionText}>Refresh playlist & EPG</Text>
              </Pressable>

              <Card>
                <Text style={styles.cardTitle}>Source health</Text>
                <Stat label="Channels" value={String(status?.channel_count || 0)} />
                <Stat label="Channels with EPG" value={String(status?.channels_with_epg || 0)} />
                <Stat label="Cached programs" value={String(diagnostics?.programs || 0)} />
                <Stat label="Refresh active" value={diagnostics?.refreshInFlight ? "Yes" : "No"} />
                <Stat label="Next refresh" value={diagnostics?.nextAutoRefresh ? dayjs(diagnostics.nextAutoRefresh).format("MMM D, h:mm A") : "—"} />
                {diagnostics?.epgError ? <Text style={styles.error}>EPG: {diagnostics.epgError}</Text> : null}
              </Card>
            </>
          )}

          {section === "playback" && (
            <Card>
              <ChoiceRow<PlayerEnginePreference>
                label="Video player"
                value={playerEnginePreference}
                options={[
                  { label: "App Default", value: "default" },
                  { label: "VLC", value: "vlc" },
                ]}
                onChange={setPlayerEnginePreference}
              />
              <Text style={styles.sub}>
                App Default automatically chooses the best engine for each stream. VLC forces VLC for full-screen playback when it is available; live guide preview remains on the optimized default path.
              </Text>
              <ChoiceRow<PlayerControlsTimeoutMs> label="Player controls timeout" value={playerControlsTimeoutMs} options={[
                { label: "8 sec", value: 8000 },
                { label: "15 sec", value: 15000 },
                { label: "30 sec", value: 30000 },
                { label: "60 sec", value: 60000 },
              ]} onChange={setPlayerControlsTimeoutMs} />
              <ToggleRow label="Auto retry streams" sub="Reconnect after a stream drop using the bounded v3 retry policy." value={autoRetryStreams} onChange={setAutoRetryStreams} />
            </Card>
          )}

          {section === "remote" && (
            <Card>
              <Text style={styles.cardTitle}>Remote Control</Text>
              <Text style={styles.sub}>D-pad focus is the primary TV navigation mode. Pointer mode is available for devices with unreliable native focus.</Text>
              <ToggleRow label="Pointer mode" sub="Enable the fallback pointer navigation layer." value={pointerMode} onChange={setPointerMode} />
            </Card>
          )}

          {section === "appearance" && (
            <Card>
              <ChoiceRow<DeviceLayoutMode> label="Device layout" value={deviceLayoutMode} options={[
                { label: "Auto", value: "auto" },
                { label: "TV", value: "tv" },
                { label: "Mobile", value: "mobile" },
              ]} onChange={setDeviceLayoutMode} />
              <ChoiceRow<GuideDensity> label="Guide density" value={guideDensity} options={[
                { label: "Comfortable", value: "large" },
                { label: "Normal", value: "normal" },
                { label: "Compact", value: "compact" },
              ]} onChange={setGuideDensity} />
              <TvCalibrationControls />
            </Card>
          )}

          {section === "accessibility" && (
            <Card>
              <ToggleRow label="Always show channel numbers" sub="Adds a consistent numeric landmark to each guide row." value={channelNumbers} onChange={setChannelNumbers} />
              <ChoiceRow<SafePreviewMode> label="Preview motion" value={safePreviewMode} options={[
                { label: "Normal", value: "on" },
                { label: "Reduced", value: "delayed" },
                { label: "Off", value: "off" },
              ]} onChange={setSafePreviewMode} />
            </Card>
          )}

          {section === "about" && (
            <>
              <Card>
                <Text style={styles.cardTitle}>Charm IPTV Experimental v3</Text>
                <Stat label="Build" value={`v${appVersion}${androidVersionCode ? ` (${androidVersionCode})` : ""}`} />
                <Stat label="Platform" value={Platform.isTV ? "Android TV / Fire TV" : Platform.OS} />
                <Stat label="Data mode" value={diagnostics?.mode || "—"} />
                <Text style={styles.sub}>Native streaming XMLTV, indexed SQLite guide storage, bounded player recovery, and TV-first display calibration.</Text>
              </Card>
              <Card>
                <Text style={styles.cardTitle}>Guide maintenance</Text>
                <Pressable style={({ focused }: any) => [styles.actionSecondary, focused && styles.focused]} onPress={async () => { await clearGuideCache(); loadStatus(); }}>
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.actionText}>Clear Guide Cache</Text>
                </Pressable>
                <Pressable style={({ focused }: any) => [styles.action, focused && styles.focused]} onPress={resetGuideData} disabled={busy}>
                  <Ionicons name="cloud-download-outline" size={18} color="#fff" />
                  <Text style={styles.actionText}>Reset & Reload Guide</Text>
                </Pressable>
              </Card>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>;
}

function ChoiceRow<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (value: T) => void;
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
              onPress={() => { void Haptics.selectionAsync().catch(() => undefined); onChange(option.value); }}
              style={({ focused }: any) => [styles.choiceButton, active && styles.choiceActive, focused && styles.focused]}
            >
              <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ToggleRow({ label, sub, value, onChange }: { label: string; sub: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable
      focusable
      onPress={() => { void Haptics.selectionAsync().catch(() => undefined); onChange(!value); }}
      style={({ focused }: any) => [styles.toggle, focused && styles.focused]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <Text style={[styles.toggleValue, value && styles.toggleValueOn]}>{value ? "ON" : "OFF"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row", backgroundColor: "#05070A" },
  containerCompact: { flexDirection: "column" },
  sidebar: { width: 212, backgroundColor: "#090C10", borderRightWidth: 1, borderRightColor: "rgba(255,255,255,0.12)", padding: 10 },
  sidebarCompact: { width: "100%", borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.12)", paddingBottom: 6 },
  brandRow: { flexDirection: "row", alignItems: "baseline" },
  brandCharm: { color: RED, fontFamily: fonts.bold, fontSize: 18 },
  brandIptv: { color: "#fff", fontFamily: fonts.medium, fontSize: 14 },
  versionMark: { color: RED, fontFamily: fonts.medium, fontSize: 8, letterSpacing: 0.7, marginBottom: 10 },
  nav: { gap: 2 },
  navCompact: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  navItem: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 8 },
  navItemCompact: { flexGrow: 1, flexBasis: "31%" },
  navActive: { backgroundColor: RED_DEEP },
  navText: { color: "#fff", fontFamily: fonts.medium, fontSize: 11.5 },
  content: { flex: 1, paddingHorizontal: 14, paddingTop: 10 },
  heading: { color: "#fff", fontFamily: fonts.bold, fontSize: 21, marginBottom: 8 },
  scrollContent: { gap: 8, paddingBottom: 56 },
  card: { backgroundColor: PANEL, borderRadius: radius.md, padding: 9, gap: 7 },
  cardTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  settingLabel: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11.5 },
  sub: { color: "rgba(255,255,255,0.66)", fontFamily: fonts.regular, fontSize: 10, lineHeight: 13 },
  choiceBlock: { gap: 5 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choiceButton: { minHeight: 34, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.05)" },
  choiceActive: { backgroundColor: "rgba(227,38,46,0.24)", borderColor: RED },
  choiceText: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.semibold, fontSize: 11.5 },
  choiceTextActive: { color: "#fff" },
  toggle: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.035)" },
  toggleValue: { minWidth: 44, color: "rgba(255,255,255,0.55)", fontFamily: fonts.bold, fontSize: 10, textAlign: "center" },
  toggleValueOn: { color: RED },
  stat: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 3 },
  statLabel: { color: "rgba(255,255,255,0.62)", fontFamily: fonts.regular, fontSize: 12 },
  statValue: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12, textAlign: "right", flexShrink: 1 },
  action: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: RED_DEEP, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(227,38,46,0.45)" },
  actionSecondary: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  actionText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  error: { color: colors.error, fontFamily: fonts.medium, fontSize: 11 },
  focused: { borderColor: "#fff", borderWidth: 2, shadowColor: RED, shadowOpacity: 0.35, shadowRadius: 7 },
});
