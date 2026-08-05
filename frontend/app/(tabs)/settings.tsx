import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { TvCalibrationControls } from "@/src/components/TvCalibrationControls";
import {
  DeviceLayoutMode,
  GuideDensity,
  GuideLayout,
  PlayerControlsTimeoutMs,
  SafePreviewMode,
  useStore,
} from "@/src/store";
import { clearGuideCache, refreshSource } from "@/src/source";
import {
  type PlayerEnginePreference,
  usePlayerEnginePreference,
} from "@/src/playerEnginePreference";
import { fonts, radius, tvColors } from "@/src/theme";

type Section = "general" | "player" | "remote" | "epg" | "appearance" | "backup" | "account" | "about";

type Tile = {
  id: Section;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

const TILES: Tile[] = [
  { id: "general", label: "General", icon: "settings-outline" },
  { id: "player", label: "Player", icon: "play-circle-outline" },
  { id: "remote", label: "Remote Control", icon: "game-controller-outline" },
  { id: "epg", label: "EPG", icon: "calendar-outline" },
  { id: "appearance", label: "Appearance", icon: "color-palette-outline" },
  { id: "backup", label: "Backup & Restore", icon: "cloud-download-outline" },
  { id: "account", label: "Account", icon: "person-outline" },
  { id: "about", label: "About", icon: "information-circle-outline" },
];

export default function SettingsScreen() {
  const router = useRouter();
  const {
    refresh,
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
  const [section, setSection] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);

  const appVersion = Constants.expoConfig?.version || "2.0.0-beta";
  const versionCode = (Constants.expoConfig as any)?.android?.versionCode;
  const selected = useMemo(() => TILES.find((item) => item.id === section), [section]);

  const choose = useCallback((id: Section) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (id === "epg") {
      router.push("/epg-sources" as any);
      return;
    }
    setSection(id);
  }, [router]);

  const hardReload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshSource(true);
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const clearCache = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearGuideCache();
      await refreshSource(true);
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>SYSTEM</Text>
            <Text style={styles.title}>{selected ? selected.label : "Settings"}</Text>
          </View>
          {section ? (
            <Pressable onPress={() => setSection(null)} style={({ focused }: any) => [styles.backButton, focused && styles.focused]}>
              <Ionicons name="arrow-back" size={14} color="#fff" />
              <Text style={styles.backText}>All Settings</Text>
            </Pressable>
          ) : null}
        </View>

        {!section ? (
          <View style={styles.tileGrid}>
            {TILES.map((tile, index) => (
              <Pressable
                key={tile.id}
                hasTVPreferredFocus={index === 0}
                onPress={() => choose(tile.id)}
                style={({ focused }: any) => [styles.tile, focused && styles.focused]}
                testID={`settings-tile-${tile.id}`}
              >
                <View style={styles.tileIcon}><Ionicons name={tile.icon} size={27} color={tvColors.purpleSoft} /></View>
                <Text style={styles.tileText}>{tile.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.details}>
            {section === "general" ? (
              <SettingsCard title="Guide & channels" icon="list-outline">
                <ChoiceRow<GuideLayout>
                  label="Guide layout"
                  value={guideLayout}
                  options={[{ label: "Timeline", value: "cinematic" }, { label: "Compact", value: "compact" }]}
                  onChange={setGuideLayout}
                />
                <ChoiceRow<GuideDensity>
                  label="Guide density"
                  value={guideDensity}
                  options={[{ label: "Comfortable", value: "large" }, { label: "Normal", value: "normal" }, { label: "Compact", value: "compact" }]}
                  onChange={setGuideDensity}
                />
                <ChoiceRow<SafePreviewMode>
                  label="Live preview"
                  value={safePreviewMode}
                  options={[{ label: "Normal", value: "on" }, { label: "Delayed", value: "delayed" }, { label: "Off", value: "off" }]}
                  onChange={setSafePreviewMode}
                />
                <ToggleRow label="Channel numbers" value={channelNumbers} onChange={setChannelNumbers} />
                <ToggleRow label="Channel logos" value={channelLogos} onChange={setChannelLogos} />
                <Action label={busy ? "Refreshing…" : "Refresh playlist & EPG"} icon="refresh" onPress={hardReload} disabled={busy} />
              </SettingsCard>
            ) : null}

            {section === "player" ? (
              <SettingsCard title="Playback" icon="play-circle-outline">
                <ChoiceRow<PlayerEnginePreference>
                  label="Video player"
                  value={playerEnginePreference}
                  options={[{ label: "App Default", value: "default" }, { label: "VLC", value: "vlc" }]}
                  onChange={setPlayerEnginePreference}
                />
                <ChoiceRow<PlayerControlsTimeoutMs>
                  label="Controls timeout"
                  value={playerControlsTimeoutMs}
                  options={[{ label: "8 sec", value: 8000 }, { label: "15 sec", value: 15000 }, { label: "30 sec", value: 30000 }, { label: "60 sec", value: 60000 }]}
                  onChange={setPlayerControlsTimeoutMs}
                />
                <ToggleRow label="Auto retry streams" value={autoRetryStreams} onChange={setAutoRetryStreams} />
                <Text style={styles.help}>App Default chooses the best engine per stream. VLC can be forced for full-screen playback when available; the purple guide preview stays on its optimized default path.</Text>
              </SettingsCard>
            ) : null}

            {section === "remote" ? (
              <SettingsCard title="Remote Control" icon="game-controller-outline">
                <ToggleRow label="Pointer mode" value={pointerMode} onChange={setPointerMode} />
                <Text style={styles.help}>D-pad remains the primary TV navigation method. Pointer mode is a fallback for devices with unreliable native focus.</Text>
              </SettingsCard>
            ) : null}

            {section === "appearance" ? (
              <SettingsCard title="Appearance" icon="color-palette-outline">
                <ChoiceRow<DeviceLayoutMode>
                  label="Device layout"
                  value={deviceLayoutMode}
                  options={[{ label: "Auto", value: "auto" }, { label: "TV", value: "tv" }, { label: "Mobile", value: "mobile" }]}
                  onChange={setDeviceLayoutMode}
                />
                <ChoiceRow<GuideDensity>
                  label="Guide density"
                  value={guideDensity}
                  options={[{ label: "Comfortable", value: "large" }, { label: "Normal", value: "normal" }, { label: "Compact", value: "compact" }]}
                  onChange={setGuideDensity}
                />
                <View style={styles.calibrationWrap}><TvCalibrationControls /></View>
              </SettingsCard>
            ) : null}

            {section === "backup" ? (
              <SettingsCard title="Backup & Restore" icon="cloud-download-outline">
                <Text style={styles.help}>CharmIPTV keeps its channel/guide cache locally. Clearing it forces a clean source rebuild while preserving your app installation.</Text>
                <Action label={busy ? "Working…" : "Clear & rebuild guide cache"} icon="trash-outline" onPress={clearCache} disabled={busy} />
              </SettingsCard>
            ) : null}

            {section === "account" ? (
              <SettingsCard title="Account" icon="person-outline">
                <InfoRow label="Profile" value="Local CharmIPTV profile" />
                <InfoRow label="Playlist access" value="Private / app managed" />
                <InfoRow label="EPG access" value="Private / app managed" />
                <Text style={styles.help}>No external account or playlist login is exposed in this build.</Text>
              </SettingsCard>
            ) : null}

            {section === "about" ? (
              <SettingsCard title="About CharmIPTV" icon="information-circle-outline">
                <InfoRow label="Version" value={appVersion} />
                <InfoRow label="Android build" value={versionCode ? String(versionCode) : "—"} />
                <InfoRow label="Interface" value="Purple TV experiment" />
                <InfoRow label="Core" value="perf/opt-fix" />
                <Text style={styles.help}>This branch changes presentation and navigation while preserving the optimized playback, guide, cache, and source architecture underneath.</Text>
              </SettingsCard>
            ) : null}
          </ScrollView>
        )}
      </View>
    </PurpleTvShell>
  );
}

function SettingsCard({ title, icon, children }: { title: string; icon: React.ComponentProps<typeof Ionicons>["name"]; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}><Ionicons name={icon} size={18} color={tvColors.purpleSoft} /></View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={({ focused }: any) => [styles.settingRow, focused && styles.focused]}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={[styles.toggle, value && styles.toggleOn]}><View style={[styles.knob, value && styles.knobOn]} /></View>
    </Pressable>
  );
}

function ChoiceRow<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { label: string; value: T }[]; onChange: (value: T) => void }) {
  return (
    <View style={styles.choiceBlock}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={({ focused }: any) => [styles.choice, option.value === value && styles.choiceActive, focused && styles.focused]}
          >
            <Text style={[styles.choiceText, option.value === value && styles.choiceTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Action({ label, icon, onPress, disabled }: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ focused }: any) => [styles.action, disabled && styles.disabled, focused && styles.focused]}>
      <Ionicons name={icon} size={14} color="#fff" />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14 },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  backButton: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  tileGrid: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "center", gap: 9, paddingHorizontal: 18 },
  tile: { width: "23.8%", minHeight: 118, alignItems: "center", justifyContent: "center", gap: 10, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  tileIcon: { width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  tileText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5, textAlign: "center" },
  details: { paddingTop: 14, paddingHorizontal: 24, paddingBottom: 24 },
  card: { backgroundColor: tvColors.panel, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.md, padding: 14, gap: 9 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 9, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: tvColors.line },
  cardIcon: { width: 32, height: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  cardTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  settingRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 8 },
  settingLabel: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5 },
  toggle: { width: 34, height: 19, borderRadius: 10, backgroundColor: "#343145", padding: 2 },
  toggleOn: { backgroundColor: tvColors.purple },
  knob: { width: 15, height: 15, borderRadius: 8, backgroundColor: "#817D91" },
  knobOn: { alignSelf: "flex-end", backgroundColor: "#fff" },
  choiceBlock: { gap: 7, paddingVertical: 4 },
  choices: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  choice: { minHeight: 29, justifyContent: "center", paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  choiceActive: { backgroundColor: tvColors.purple },
  choiceText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  choiceTextActive: { color: "#fff" },
  action: { alignSelf: "flex-start", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple },
  actionText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8.5 },
  disabled: { opacity: 0.55 },
  infoRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  infoLabel: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  infoValue: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, lineHeight: 12.5 },
  calibrationWrap: { borderTopWidth: 1, borderTopColor: tvColors.line, marginTop: 4, paddingTop: 8 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});