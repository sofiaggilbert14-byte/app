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

const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";
const GOLD_DEEP = "#7C4A11";
const PANEL = "rgba(18, 13, 8, 0.92)";
const BORDER_GOLD = "rgba(246, 183, 60, 0.34)";

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
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostics | null>(null);
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
      const s = await refreshSource();
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
      const s = await refreshSource();
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
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: spacing.md }]}>
        <Text style={styles.brand}>CharmIPTV Phoenix</Text>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={colors.brand} colors={[colors.brand]} />
        }
      >
        {/* Playlist refresher */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Playlist & EPG</Text>
          {!status ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
          ) : (
            <>
              <Stat label="Channels loaded" value={String(status.channel_count)} />
              <Stat label="Channels with EPG" value={String(status.channels_with_epg)} />
              <Stat
                label="Last refreshed"
                value={status.last_refresh ? dayjs(status.last_refresh).format("MMM D, h:mm A") : "—"}
              />
              {status.error ? <Text style={styles.errText}>Error: {status.error}</Text> : null}
            </>
          )}
          <Pressable style={({ focused }: any) => [styles.primaryBtn, focused && styles.focusRing]} onPress={doRefresh} disabled={busy} testID="settings-refresh-btn">
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.primaryText}>Refresh Playlist Now</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.hint}>
            Channels & guide are fetched and parsed directly on your device — no server required. Pull down to refresh
            anywhere on this screen.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Phoenix Diagnostics</Text>
          <Stat label="Build" value={`v${appVersion}${androidVersionCode ? ` (${androidVersionCode})` : ""}`} />
          <Stat label="Platform" value={Platform.isTV ? "Android TV / Fire TV" : Platform.OS} />
          <Stat label="Data mode" value={diagnostics?.mode || "—"} />
          <Stat label="Channels" value={String(diagnostics?.channels || status?.channel_count || 0)} />
          <Stat label="Cached programs" value={String(diagnostics?.programs || 0)} />
          <Stat label="Refresh in progress" value={diagnostics?.refreshInFlight ? "Yes" : "No"} />
          <Stat
            label="Guide cache"
            value={diagnostics ? `${(diagnostics.cacheBytes / 1024 / 1024).toFixed(1)} MB` : "—"}
          />
          <Stat
            label="Cache age"
            value={diagnostics?.cacheAgeMinutes == null ? "—" : `${diagnostics.cacheAgeMinutes} min`}
          />
          <Pressable
            style={({ focused }: any) => [styles.secondaryBtn, focused && styles.focusRing]}
            onPress={async () => {
              await clearGuideCache();
              loadStatus();
            }}
            focusable
            testID="settings-clear-guide-cache-btn"
          >
            <Ionicons name="trash-outline" size={16} color={colors.onSurface} />
            <Text style={styles.secondaryText}>Clear Guide Cache</Text>
          </Pressable>
          <Pressable
            style={({ focused }: any) => [styles.primaryBtn, focused && styles.focusRing]}
            onPress={resetGuideData}
            disabled={busy}
            focusable
            testID="settings-reset-guide-data-btn"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-download-outline" size={16} color="#fff" />
                <Text style={styles.primaryText}>Reset & Reload Guide</Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Guide & Player Preferences</Text>
          <Text style={styles.sub}>
            Tune the layout for real TVs. Compact options show more guide rows; larger options are easier to read from
            across the room.
          </Text>
          <ChoiceRow<GuideLayout>
            label="Guide layout"
            value={guideLayout}
            options={[
              { label: "Cinematic", value: "cinematic" },
              { label: "Compact", value: "compact" },
            ]}
            onChange={setGuideLayout}
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
          <ChoiceRow<SafePreviewMode>
            label="Safe preview mode"
            value={safePreviewMode}
            options={[
              { label: "Preview after focus stops", value: "on" },
              { label: "Extra safe delay", value: "delayed" },
              { label: "Live preview OFF", value: "off" },
            ]}
            onChange={setSafePreviewMode}
          />
          <ChoiceRow<DeviceLayoutMode>
            label="Device layout mode"
            value={deviceLayoutMode}
            options={[
              { label: "Auto", value: "auto" },
              { label: "TV", value: "tv" },
              { label: "Mobile", value: "mobile" },
            ]}
            onChange={setDeviceLayoutMode}
          />
          <ToggleRow
            label="Channel numbers"
            sub="Automatically numbers the current lineup. If channels are added or removed, Phoenix rebuilds the numbering from the latest channel list."
            value={channelNumbers}
            onChange={setChannelNumbers}
            testID="settings-channel-numbers-toggle"
          />
          <ToggleRow
            label="Channel logos"
            sub="Turn this off to use initials instead of loading channel logo images. This can make weaker boxes feel smoother."
            value={channelLogos}
            onChange={setChannelLogos}
            testID="settings-channel-logos-toggle"
          />
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
            sub="When a stream drops, Phoenix keeps trying until you leave the player."
            value={autoRetryStreams}
            onChange={setAutoRetryStreams}
            testID="settings-auto-retry-toggle"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Beta Tester Checklist</Text>
          <ChecklistItem label="Guide loads and scrolls without crashing" />
          <ChecklistItem label="Player controls fade away after playback starts" />
          <ChecklistItem label="Previous / Last / Next channel buttons work" />
          <ChecklistItem label="Search finds channels and programs" />
          <ChecklistItem label="Favorites and Continue Watching show the right channels" />
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={styles.cardTitle}>Pointer (mouse) mode</Text>
              <Text style={styles.sub}>
                For Android TV / Fire TV boxes where the D-pad focus isn’t reliable. Turns the remote’s
                arrow keys into an on-screen mouse pointer — move with the D-pad and press OK/Select to
                click whatever the pointer is on. Only works on an installed Android TV build.
              </Text>
            </View>
            <TogglePill value={pointerMode} />
          </View>
          <Pressable
            style={({ focused }: any) => [styles.togglePressRow, focused && styles.focusRing]}
            onPress={() => {
              Haptics.selectionAsync();
              setPointerMode(!pointerMode);
            }}
            focusable
            testID="settings-pointer-toggle"
          >
            <Text style={styles.toggleActionText}>{pointerMode ? "Turn pointer mode off" : "Turn pointer mode on"}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>About Reminders</Text>
          <Text style={styles.sub}>
            Set reminders from the guide to get a local notification before a program starts, with a tap-to-switch
            action. Scheduled notifications only fire on an installed Android/iOS build — not in the Expo Go preview.
          </Text>
        </View>
      </ScrollView>
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
  container: { flex: 1, backgroundColor: "#050403" },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(246,183,60,0.24)",
    backgroundColor: "rgba(8,5,3,0.96)",
  },
  brand: { color: GOLD, fontFamily: fonts.semibold, fontSize: 12 },
  title: { color: "#fff", fontFamily: fonts.display, fontSize: 28 },
  card: {
    backgroundColor: PANEL,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: GOLD,
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  cardTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 16 },
  settingLabel: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sub: { color: "rgba(255,255,255,0.68)", fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  choiceBlock: { gap: spacing.xs, marginTop: spacing.xs },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choiceBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.18)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  choiceBtnActive: { backgroundColor: "rgba(246,183,60,0.26)", borderColor: GOLD },
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
    borderColor: "rgba(255,227,163,0.18)",
  },
  secondaryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  toggleRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.16)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: spacing.md,
    gap: spacing.md,
  },
  togglePressRow: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,227,163,0.16)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  toggleActionText: { color: GOLD_SOFT, fontFamily: fonts.semibold, fontSize: 13 },
  togglePill: {
    width: 76,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  togglePillActive: { borderColor: GOLD, backgroundColor: "rgba(246,183,60,0.22)" },
  toggleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.36)" },
  toggleDotActive: { backgroundColor: GOLD },
  toggleText: { color: "rgba(255,255,255,0.56)", fontFamily: fonts.bold, fontSize: 11 },
  toggleTextActive: { color: GOLD_SOFT },
  focusRing: {
    borderWidth: 2,
    borderColor: GOLD_SOFT,
    shadowColor: GOLD,
    shadowOpacity: 0.65,
    shadowRadius: 12,
  },
});
