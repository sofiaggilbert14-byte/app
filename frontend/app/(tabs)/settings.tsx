import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import { DeviceEventEmitter, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { PurpleDrawerButton } from "@/src/components/PurpleDrawerButton";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { TvCalibrationControls } from "@/src/components/TvCalibrationControls";
import {
  useStore,
  type DeviceLayoutMode,
  type GuideDensity,
  type GuideLayout,
  type PlayerControlsTimeoutMs,
  type PowerProfile,
  type SafePreviewMode,
  type SleepTimerMinutes,
  type StartScreen,
} from "@/src/store";
import { sourceDiagnostics } from "@/src/source";
import {
  type LongDownAction,
  type PlayerRemoteAction,
  useRemoteShortcutPreferences,
} from "@/src/core/remoteShortcutPreferences";

import {
  readLatestFavoritesBackup,
  resolveFavoritesBackup,
  serializeFavoritesBackup,
  writeFavoritesBackup,
} from "@/src/utils/favoritesBackup";
import { formatDiagnosticsExport } from "@/src/core/diagnosticsExport";
import {
  audioDiagnosticsExtras,
  getLastAudioDiagnostics,
} from "@/src/core/audioDiagnostics";
import { POWER_PROFILE_OPTIONS } from "@/src/core/devicePowerProfile";
import { getCacheStorageReport, pruneDiskCaches } from "@/src/utils/tvRemote";
import {
  usePlaybackBufferProfile,
  type PlaybackBufferProfile,
} from "@/src/core/playbackBufferProfile";
import { useChannelCustomize } from "@/src/core/channelCustomize";
import { useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { useParentalPin } from "@/src/core/parentalPin";
import { failedStreamCount, listFailedChannelIds } from "@/src/core/streamFailureRegistry";
import {
  useSubtitlePreferences,
  type SubtitleBg,
  type SubtitleSize,
} from "@/src/core/subtitlePreferences";
import { fonts, radius, tvColors } from "@/src/theme";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import { useAudioTrackPreferences } from "@/src/core/audioTrackPreferences";
import { PREFERRED_AUDIO_LANGUAGE_OPTIONS } from "@/src/core/preferredAudioLanguages";
import {
  getDeviceCodecCapabilities,
  type DeviceCodecCapabilities,
} from "@/src/core/deviceCodecCapabilities";
import * as FileSystem from "expo-file-system/legacy";

const PLAYER_REMOTE_ACTIONS: { label: string; value: PlayerRemoteAction }[] = [
  { label: "Previous channel", value: "previous" },
  { label: "Channel up", value: "channel_up" },
  { label: "Channel down", value: "channel_down" },
  { label: "Open channel bar", value: "channels" },
  { label: "Show player controls", value: "controls" },
  { label: "Add/remove Favorite", value: "favorite" },
  { label: "Open TV Guide", value: "guide" },
  { label: "No shortcut", value: "none" },
];

type Section =
  | "general"
  | "player"
  | "remote"
  | "epg"
  | "appearance"
  | "health"
  | "channels"
  | "parental"
  | "backup"
  | "account"
  | "about";

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
  { id: "health", label: "Health", icon: "pulse-outline" },
  { id: "channels", label: "Channels", icon: "list-circle-outline" },
  { id: "parental", label: "Parental", icon: "lock-closed-outline" },
  { id: "backup", label: "Backup & Restore", icon: "cloud-download-outline" },
  { id: "account", label: "Account", icon: "person-outline" },
  { id: "about", label: "About", icon: "information-circle-outline" },
];

const ADULT_GROUP_RE = /adult|xxx|porn/i;

function SettingsScreenContent() {
  const router = useRouter();
  const {
    channels,
    favorites,
    replaceFavorites,
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
    preferTvgIdOnly,
    powerProfile,
    setPowerProfile,
    logosOffWhileSurfing,
    setLogosOffWhileSurfing,
    instantGuide,
    setInstantGuide,
    epgGuideFilter,
    guideWindowHours,
    clock24h,
    setClock24h,
    startScreen,
    setStartScreen,
    sleepTimerMinutes,
    setSleepTimerMinutes,
  } = useStore();
  const remoteShortcuts = useRemoteShortcutPreferences();
  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();
  const channelCustomize = useChannelCustomize();
  const guideUi = useGuideUiPreferences();
  const parental = useParentalPin();
  const subtitles = useSubtitlePreferences();
  const audioPreferences = useAudioTrackPreferences();
  const latestAudio = getLastAudioDiagnostics();
  const [section, setSection] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [clearFavoritesArmed, setClearFavoritesArmed] = useState(false);
  const [codecCapabilities, setCodecCapabilities] = useState<DeviceCodecCapabilities | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [focusedCustomizeId, setFocusedCustomizeId] = useState<string | null>(null);
  const [channelEditPage, setChannelEditPage] = useState(0);
  const clearFavoritesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preferTileFocus, setPreferTileFocus] = useState(true);
  const [preferBackFocus, setPreferBackFocus] = useState(false);

  useEffect(() => {
    if (section !== "health" && section !== "about") return;
    void getDeviceCodecCapabilities().then(setCodecCapabilities);
  }, [section]);

  useEffect(() => {
    if (!preferTileFocus) return;
    const timer = setTimeout(() => setPreferTileFocus(false), 180);
    return () => clearTimeout(timer);
  }, [preferTileFocus]);

  useEffect(() => {
    if (!section) return;
    setClearFavoritesArmed(false);
    setPreferBackFocus(true);
    const timer = setTimeout(() => setPreferBackFocus(false), 180);
    return () => clearTimeout(timer);
  }, [section]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("CharmShowAllSettings", () => {
      setBackupStatus(null);
      setClearFavoritesArmed(false);
      setPreferTileFocus(true);
      setSection(null);
    });
    return () => sub.remove();
  }, []);

  useEffect(
    () => () => {
      if (clearFavoritesTimer.current) clearTimeout(clearFavoritesTimer.current);
    },
    [],
  );

  useTvBackHandler(
    useCallback(() => {
      if (section) {
        setBackupStatus(null);
        setClearFavoritesArmed(false);
        setPreferTileFocus(true);
        setSection(null);
        return true;
      }
      return false;
    }, [section]),
  );

  const appVersion = Constants.expoConfig?.version || "2.0.0-purple";
  const versionCode = (Constants.expoConfig as any)?.android?.versionCode;
  const selected = useMemo(() => TILES.find((item) => item.id === section), [section]);

  const channelEditPageCount = Math.max(1, Math.ceil(channels.length / 100));
  const channelEditIds = useMemo(
    () => section === "channels" ? channels.map((channel) => channel.id) : [],
    [channels, section],
  );
  const customizeChannels = useMemo(() => channels.slice(channelEditPage * 100, channelEditPage * 100 + 100), [channelEditPage, channels]);
  const hiddenSet = useMemo(() => new Set(channelCustomize.hiddenIds), [channelCustomize.hiddenIds]);

  useEffect(() => {
    if (section !== "channels") return;
    setChannelEditPage((current) => Math.max(0, Math.min(channelEditPageCount - 1, current)));
    setFocusedCustomizeId(null);
  }, [channelEditPageCount, channels, section]);
  const failedChannelRows = useMemo(() => {
    if (section !== "health") return [] as { id: string; name: string }[];
    return listFailedChannelIds()
      .slice(0, 8)
      .map((id) => {
        const channel = channels.find((item) => item.id === id);
        return { id, name: channel?.name || id };
      });
  }, [channels, section]);
  const lockableGroups = useMemo(() => {
    const groups = ["Movies", "Kids"];
    const seen = new Set(groups);
    for (const channel of channels) {
      const name = String(channel.group || "").trim();
      if (!name || seen.has(name) || !ADULT_GROUP_RE.test(name)) continue;
      seen.add(name);
      groups.push(name);
      if (groups.length >= 10) break;
    }
    return groups;
  }, [channels]);

  const choose = useCallback((id: Section) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setBackupStatus(null);
    setClearFavoritesArmed(false);
    if (id === "epg") {
      router.push("/epg-sources" as any);
      return;
    }
    setPreferBackFocus(true);
    setSection(id);
  }, [router]);

  const exportDiagnostics = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const snap = await sourceDiagnostics();
      const body = formatDiagnosticsExport({
        diagnostics: snap,
        appVersion,
        preferTvgIdOnly,
        powerProfile,
        guideFilter: epgGuideFilter,
        extras: {
          guideWindowHours,
          clock24h,
          startScreen,
          sleepTimerMinutes,
          logosOffWhileSurfing,
          favorites: favorites.length,
          ...audioDiagnosticsExtras(),
        },
      });
      const root = FileSystem.documentDirectory || "";
      if (!root || Platform.OS === "web") {
        setBackupStatus("Diagnostics ready (copy unavailable on this platform).");
        return;
      }
      const path = `${root}charmiptv-diagnostics-${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(path, body);
      setBackupStatus(`Diagnostics saved to ${path.split("/").pop()}`);
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Diagnostics export failed.");
    } finally {
      setBusy(false);
    }
  }, [
    appVersion,
    busy,
    clock24h,
    epgGuideFilter,
    favorites.length,
    guideWindowHours,
    logosOffWhileSurfing,
    powerProfile,
    preferTvgIdOnly,
    sleepTimerMinutes,
    startScreen,
  ]);

  const clearFavoritesDangerous = useCallback(async () => {
    if (busy) return;
    if (!clearFavoritesArmed) {
      setClearFavoritesArmed(true);
      setBackupStatus("Press again to confirm clear favorites.");
      if (clearFavoritesTimer.current) clearTimeout(clearFavoritesTimer.current);
      clearFavoritesTimer.current = setTimeout(() => setClearFavoritesArmed(false), 7000);
      return;
    }
    if (clearFavoritesTimer.current) {
      clearTimeout(clearFavoritesTimer.current);
      clearFavoritesTimer.current = null;
    }
    setBusy(true);
    setBackupStatus("Clearing all favorites…");
    try {
      replaceFavorites([]);
      setClearFavoritesArmed(false);
      setBackupStatus("Favorites cleared. This does not clear the guide cache.");
    } finally {
      setBusy(false);
    }
  }, [busy, clearFavoritesArmed, replaceFavorites]);

  const backupFavorites = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setBackupStatus("Saving favorites backup…");
    try {
      const raw = serializeFavoritesBackup(favorites, channels);
      const { fileName, portable } = await writeFavoritesBackup(raw);
      setBackupStatus(
        portable
          ? `Exported ${favorites.length} favorite${favorites.length === 1 ? "" : "s"} to ${fileName} in your chosen folder (and kept a local copy). Stream URLs are not stored.`
          : `Saved ${favorites.length} favorite${favorites.length === 1 ? "" : "s"} to ${fileName} in app storage. Choose a shared folder next time to make the backup portable. Stream URLs are not stored.`,
      );
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Favorites backup failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, channels, favorites]);

  const restoreFavorites = useCallback(async () => {
    if (busy) return;
    if (!channels.length) {
      setBackupStatus("Channels must be loaded before restoring favorites.");
      return;
    }
    setBusy(true);
    setBackupStatus("Looking for the newest CharmIPTV favorites backup…");
    try {
      const { fileName, raw } = await readLatestFavoritesBackup();
      const restored = resolveFavoritesBackup(raw, channels);
      replaceFavorites(restored);

      const unavailableCount = restored.unavailable.length;
      const unavailableNames = restored.unavailable
        .map((item) => item.name || item.tvgId || item.id)
        .filter(Boolean)
        .slice(0, 3);
      const skippedSummary = unavailableCount
        ? ` ${unavailableCount} unavailable favorite${unavailableCount === 1 ? " was" : "s were"} skipped${unavailableNames.length ? ` (${unavailableNames.join(", ")}${unavailableCount > unavailableNames.length ? ", …" : ""})` : ""}.`
        : " All favorites matched current playable channels.";

      setBackupStatus(
        `Restored ${restored.length} favorite${restored.length === 1 ? "" : "s"} from ${fileName}.${skippedSummary}`,
      );
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Favorites restore failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, channels, replaceFavorites]);

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PurpleDrawerButton testID="settings-open-drawer" />
            {section ? (
              <Pressable
                hasTVPreferredFocus={preferBackFocus}
                onFocus={() => setPreferBackFocus(false)}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  setBackupStatus(null);
                  setClearFavoritesArmed(false);
                  setPreferTileFocus(true);
                  setSection(null);
                }}
                style={({ focused }: any) => [styles.backButton, focused && styles.focused]}
                testID="settings-all-settings"
              >
                <Ionicons name="arrow-back" size={14} color="#fff" />
                <Text style={styles.backText}>All Settings</Text>
              </Pressable>
            ) : null}
            <View>
              <Text style={styles.kicker}>SYSTEM</Text>
              <Text style={styles.title}>{selected ? selected.label : "Settings"}</Text>
            </View>
          </View>
        </View>

        {!section ? (
          <FocusGuide style={styles.tileGridWrap}>
            <View style={styles.tileGrid}>
              {TILES.map((tile, index) => (
                <Pressable
                  key={tile.id}
                  hasTVPreferredFocus={preferTileFocus && index === 0}
                  onFocus={() => setPreferTileFocus(false)}
                  onPress={() => choose(tile.id)}
                  style={({ focused }: any) => [styles.tile, focused && styles.focused]}
                  testID={`settings-tile-${tile.id}`}
                >
                  <View style={styles.tileIcon}><Ionicons name={tile.icon} size={27} color={tvColors.purpleSoft} /></View>
                  <Text style={styles.tileText}>{tile.label}</Text>
                </Pressable>
              ))}
            </View>
          </FocusGuide>
        ) : (
          <FocusGuide style={styles.detailsWrap}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.details}>

            {section === "general" ? (
              <SettingsCard title="Guide & channels" icon="list-outline">
                <ChoiceRow<GuideLayout>
                  label="Guide layout"
                  value={guideLayout}
                  options={[{ label: "Timeline", value: "cinematic" }, { label: "Mobile", value: "compact" }]}
                  onChange={setGuideLayout}
                />
                {guideLayout === "cinematic" ? (
                  <ChoiceRow<GuideDensity>
                    label="Guide density"
                    value={guideDensity}
                    options={[{ label: "Comfortable", value: "large" }, { label: "Normal", value: "normal" }, { label: "Compact", value: "compact" }, { label: "Extra compact", value: "extra_compact" }]}
                    onChange={setGuideDensity}
                  />
                ) : (
                  <Text style={styles.help}>Guide density applies to Timeline layout. Mobile uses block cards sized for phones and touch.</Text>
                )}
                <ChoiceRow<SafePreviewMode>
                  label="Live preview"
                  value={safePreviewMode}
                  options={[
                    { label: "Normal", value: "on" },
                    { label: "Delayed", value: "delayed" },
                    { label: "Off while surfing", value: "surf" },
                    { label: "Off", value: "off" },
                  ]}
                  onChange={setSafePreviewMode}
                />
                <Text style={styles.help}>
                  Off while surfing soft-clears preview during D-pad surfing and arms after settle. Preview never shares a decoder with fullscreen.
                </Text>
                <ToggleRow label="Channel numbers" value={channelNumbers} onChange={setChannelNumbers} />
                <ToggleRow label="Channel logos" value={channelLogos} onChange={setChannelLogos} />
                <ToggleRow label="Logos off while surfing" value={logosOffWhileSurfing} onChange={setLogosOffWhileSurfing} />
                <ToggleRow label="Instant Guide / reduce motion" value={instantGuide} onChange={setInstantGuide} />
                <Text style={styles.help}>Snaps Guide movement and avoids repeated transition work during fast remote navigation.</Text>
                <ChoiceRow<PowerProfile>
                  label="Power profile"
                  value={powerProfile}
                  options={POWER_PROFILE_OPTIONS}
                  onChange={setPowerProfile}
                />
                <Text style={styles.help}>
                  Compatibility lengthens preview arm and settle times for older devices. Max preview arms sooner on stronger devices.
                </Text>
                <ToggleRow label="24-hour clock" value={clock24h} onChange={setClock24h} />
                <ChoiceRow<StartScreen>
                  label="Start screen"
                  value={startScreen}
                  options={[
                    { label: "Home", value: "home" },
                    { label: "Guide", value: "guide" },
                    { label: "Last channel", value: "last_channel" },
                  ]}
                  onChange={setStartScreen}
                />
              </SettingsCard>
            ) : null}

            {section === "player" ? (
              <SettingsCard title="Playback" icon="play-circle-outline">
                <Text style={styles.settingLabel}>Media3 live TV</Text>
                <Text style={styles.help}>
                  Live TV uses one Android-owned Media3 player. It starts with supported hardware codecs and uses the installed Media3 audio fallback when available; no second engine is started automatically.
                </Text>
                <ChoiceRow<PlayerControlsTimeoutMs>
                  label="Controls timeout"
                  value={playerControlsTimeoutMs}
                  options={[{ label: "8 sec", value: 8000 }, { label: "15 sec", value: 15000 }, { label: "30 sec", value: 30000 }, { label: "60 sec", value: 60000 }]}
                  onChange={setPlayerControlsTimeoutMs}
                />
                <ChoiceRow<LongDownAction>
                  label="Remote · Long Down"
                  value={remoteShortcuts.longDown}
                  options={[
                    { label: "Open channel bar", value: "channels" },
                    { label: "Open TV Guide", value: "guide" },
                    { label: "No shortcut", value: "none" },
                  ]}
                  onChange={remoteShortcuts.setLongDown}
                />
                <Text style={styles.help}>Long OK/Select is reserved for contextual Quick Actions. Directional D-pad keys remain deterministic; Long Down is the only remappable D-pad hold.</Text>
                <ChoiceRow<PlaybackBufferProfile>
                  label="Playback buffer"
                  value={playbackBufferProfile}
                  options={[
                    { label: "Low latency", value: "low_latency" },
                    { label: "Balanced", value: "balanced" },
                    { label: "Stable", value: "stable" },
                  ]}
                  onChange={setPlaybackBufferProfile}
                />
                <ChoiceRow<SleepTimerMinutes>
                  label="Sleep timer"
                  value={sleepTimerMinutes}
                  options={[
                    { label: "Off", value: 0 },
                    { label: "15m", value: 15 },
                    { label: "30m", value: 30 },
                    { label: "60m", value: 60 },
                    { label: "90m", value: 90 },
                  ]}
                  onChange={setSleepTimerMinutes}
                />
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Audio / CC</Text>
                <Text style={styles.help}>
                  Preferred audio language auto-selects a matching native Media3 track.
                  The last working track is remembered per channel (up to 128). Use Audio/CC in the fullscreen player to pick a track manually.
                </Text>
                <ChoiceRow<string>
                  label="Preferred audio language"
                  value={audioPreferences.defaultLanguage}
                  options={PREFERRED_AUDIO_LANGUAGE_OPTIONS}
                  onChange={audioPreferences.setDefaultLanguage}
                />
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Subtitles (CC)</Text>
                <Text style={styles.help}>Default language auto-selects when tracks appear. Size/background are stored for Settings (native burn-in styling is not available yet).</Text>
                <View style={styles.pinInputRow}>
                  <Text style={styles.infoLabel}>Default language</Text>
                  <TextInput
                    value={subtitles.defaultLanguage}
                    onChangeText={subtitles.setDefaultLanguage}
                    placeholder="eng"
                    placeholderTextColor={tvColors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={16}
                    style={styles.pinInput}
                    testID="settings-subtitle-lang"
                  />
                </View>
                <ChoiceRow<SubtitleSize>
                  label="Subtitle size"
                  value={subtitles.size}
                  options={[
                    { label: "Small", value: "small" },
                    { label: "Normal", value: "normal" },
                    { label: "Large", value: "large" },
                  ]}
                  onChange={subtitles.setSize}
                />
                <ChoiceRow<SubtitleBg>
                  label="Subtitle background"
                  value={subtitles.background}
                  options={[
                    { label: "None", value: "none" },
                    { label: "Dim", value: "dim" },
                    { label: "Solid", value: "solid" },
                  ]}
                  onChange={subtitles.setBackground}
                />
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Guide preview</Text>
                <ToggleRow label="Mute preview by default" value={guideUi.mutePreview} onChange={guideUi.setMutePreview} />
                <ToggleRow label="Hide preview by default" value={guideUi.hidePreview} onChange={guideUi.setHidePreview} />
              </SettingsCard>
            ) : null}

            {section === "health" ? (
              <SettingsCard title="Health" icon="pulse-outline">
                <InfoRow
                  label="Native codecs"
                  value={codecCapabilities
                    ? [codecCapabilities.h264 && "H.264", codecCapabilities.hevc && "HEVC", codecCapabilities.vp9 && "VP9", codecCapabilities.av1 && "AV1", codecCapabilities.aac && "AAC", codecCapabilities.ac3 && "AC-3", codecCapabilities.eac3 && "E-AC-3"].filter(Boolean).join(", ")
                    : "Unavailable"}
                />
                <InfoRow
                  label="Advertised video max"
                  value={codecCapabilities?.maxWidth ? `${codecCapabilities.maxWidth} × ${codecCapabilities.maxHeight}` : "Unavailable"}
                />
                <InfoRow label="Failed streams" value={String(failedStreamCount())} />
                <InfoRow
                  label="Last audio engine"
                  value={latestAudio?.engine ? String(latestAudio.engine).toUpperCase() : "—"}
                />
                <InfoRow
                  label="Last audio mime"
                  value={latestAudio?.mimeType || "—"}
                />
                <InfoRow
                  label="Last audio silent"
                  value={latestAudio ? (latestAudio.silentAudio ? "Yes" : "No") : "—"}
                />
                <InfoRow
                  label="Audio tracks seen"
                  value={latestAudio?.trackCount != null ? String(latestAudio.trackCount) : "—"}
                />
                <Action label="Report cache storage" icon="server-outline" onPress={() => void (async () => {
                  const report = await getCacheStorageReport();
                  if (!report) return setBackupStatus("Cache storage report is unavailable.");
                  const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;
                  setBackupStatus(`Cache ${mib(report.cacheDiskBytes)} · Logos ${mib(report.logoDiskBytes)} · Databases ${mib(report.databaseBytes)}`);
                })()} />
                <Action label="Prune old disk cache" icon="trash-bin-outline" onPress={() => void (async () => {
                  const report = await pruneDiskCaches(14);
                  if (!report) return setBackupStatus("Disk cache pruning is unavailable.");
                  setBackupStatus(`Removed ${report.removedFiles} old cache files (${(report.removedBytes / 1048576).toFixed(1)} MiB).`);
                })()} />
                <Action label={busy ? "Working…" : "Export diagnostics"} icon="document-text-outline" onPress={exportDiagnostics} disabled={busy} />
                {backupStatus && section === "health" ? <Text style={styles.status}>{backupStatus}</Text> : null}
                {failedChannelRows.length ? (
                  <View style={styles.matchBlock}>
                    <Text style={styles.settingLabel}>Recent failed channels</Text>
                    {failedChannelRows.map((row) => (
                      <InfoRow key={row.id} label={row.name} value={row.id.slice(0, 18)} />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.help}>No recent stream failures recorded this session.</Text>
                )}
              </SettingsCard>
            ) : null}

            {section === "channels" ? (
              <SettingsCard title="Channels" icon="list-circle-outline">
                <Text style={styles.help}>
                  All channels are available in 100-row pages so very large playlists stay memory-safe. Focus a channel, then Hide, Move, or set a custom number.
                </Text>
                <Action label="Manage Guide groups & tabs" icon="albums-outline" onPress={() => router.push("/group-settings" as any)} />
                <View style={styles.backupActions}>
                  <Action label="Previous 100" icon="chevron-up-outline" disabled={channelEditPage <= 0} onPress={() => { setFocusedCustomizeId(null); setChannelEditPage((value) => Math.max(0, value - 1)); }} />
                  <InfoRow label="Channel page" value={`${channelEditPage + 1} / ${channelEditPageCount}`} />
                  <Action label="Next 100" icon="chevron-down-outline" disabled={channelEditPage + 1 >= channelEditPageCount} onPress={() => { setFocusedCustomizeId(null); setChannelEditPage((value) => Math.min(channelEditPageCount - 1, value + 1)); }} />
                </View>
                <Action
                  label="Clear custom order"
                  icon="refresh-outline"
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => undefined);
                    channelCustomize.clearCustomOrder();
                    setBackupStatus("Custom channel order cleared.");
                  }}
                />
                {backupStatus && section === "channels" ? <Text style={styles.status}>{backupStatus}</Text> : null}
                {customizeChannels.map((channel, index) => {
                  const hidden = hiddenSet.has(channel.id);
                  const focused = focusedCustomizeId === channel.id;
                  const customNumber = channelCustomize.customNumbers[channel.id];
                  const displayNumber = customNumber || channelEditPage * 100 + index + 1;
                  return (
                    <View key={channel.id} style={styles.channelEditBlock}>
                      <Pressable
                        onFocus={() => setFocusedCustomizeId(channel.id)}
                        onPress={() => setFocusedCustomizeId(channel.id)}
                        style={({ focused: rowFocused }: any) => [
                          styles.settingRow,
                          (focused || rowFocused) && styles.focused,
                        ]}
                      >
                        <Text numberOfLines={1} style={styles.settingLabel}>
                          {displayNumber}. {channel.name}
                        </Text>
                        <Text style={styles.infoValue}>{hidden ? "Hidden" : "Visible"}</Text>
                      </Pressable>
                      {focused ? (
                        <>
                          <View style={styles.channelEditActions}>
                            <Pressable
                              onPress={() => channelCustomize.toggleHidden(channel.id)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>{hidden ? "Show" : "Hide"}</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, -1, channelEditIds)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>Up</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, 1, channelEditIds)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>Down</Text>
                            </Pressable>
                          </View>
                          <View style={styles.channelEditActions}>
                            <Pressable
                              onPress={() =>
                                channelCustomize.setCustomNumber(
                                  channel.id,
                                  Math.max(1, (customNumber || displayNumber) - 1),
                                )
                              }
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                              testID="settings-channel-number-dec"
                            >
                              <Text style={styles.miniActionText}>Num −</Text>
                            </Pressable>
                            <Text style={styles.infoValue}>#{displayNumber}</Text>
                            <Pressable
                              onPress={() =>
                                channelCustomize.setCustomNumber(
                                  channel.id,
                                  Math.min(99999, (customNumber || displayNumber) + 1),
                                )
                              }
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                              testID="settings-channel-number-inc"
                            >
                              <Text style={styles.miniActionText}>Num +</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => channelCustomize.setCustomNumber(channel.id, null)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>Clear #</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </SettingsCard>
            ) : null}

            {section === "parental" ? (
              <SettingsCard title="Parental" icon="lock-closed-outline">
                <Text style={styles.help}>
                  PIN unlocks locked groups for this app session. Lock session again to re-require the PIN.
                </Text>
                <InfoRow label="PIN" value={parental.hasPin ? "Set" : "Not set"} />
                <View style={styles.pinInputRow}>
                  <TextInput
                    value={pinDraft}
                    onChangeText={(value) => setPinDraft(value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="4–8 digit PIN"
                    placeholderTextColor={tvColors.textMuted}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={8}
                    style={styles.pinInput}
                    testID="settings-parental-pin"
                  />
                </View>
                <View style={styles.backupActions}>
                  <Action
                    label="Set PIN"
                    icon="key-outline"
                    onPress={() => {
                      if (pinDraft.replace(/\D/g, "").length < 4) {
                        setBackupStatus("PIN must be at least 4 digits.");
                        return;
                      }
                      parental.setPin(pinDraft);
                      setPinDraft("");
                      setBackupStatus("Parental PIN saved.");
                    }}
                  />
                  <Action
                    label="Clear PIN"
                    icon="trash-outline"
                    onPress={() => {
                      parental.setPin(null);
                      setPinDraft("");
                      setBackupStatus("Parental PIN cleared.");
                    }}
                  />
                  <Action
                    label="Lock session now"
                    icon="lock-closed-outline"
                    onPress={() => {
                      parental.lockSession();
                      setBackupStatus("Session locked. Locked groups require PIN again.");
                    }}
                  />
                </View>
                {backupStatus && section === "parental" ? <Text style={styles.status}>{backupStatus}</Text> : null}
                <Text style={[styles.settingLabel, { marginTop: 6 }]}>Locked groups</Text>
                {lockableGroups.map((group) => {
                  const locked = parental.lockedGroups.includes(group);
                  return (
                    <ToggleRow
                      key={group}
                      label={group}
                      value={locked}
                      onChange={(next) => {
                        const set = new Set(parental.lockedGroups);
                        if (next) set.add(group);
                        else set.delete(group);
                        parental.setLockedGroups(Array.from(set));
                      }}
                    />
                  );
                })}
              </SettingsCard>
            ) : null}

            {section === "remote" ? (
              <SettingsCard title="Remote Control" icon="game-controller-outline">
                <ChoiceRow<PlayerRemoteAction> label="Channel Up button" value={remoteShortcuts.channelUp} options={PLAYER_REMOTE_ACTIONS} onChange={remoteShortcuts.setChannelUp} />
                <ChoiceRow<PlayerRemoteAction> label="Channel Down button" value={remoteShortcuts.channelDown} options={PLAYER_REMOTE_ACTIONS} onChange={remoteShortcuts.setChannelDown} />
                <ChoiceRow<PlayerRemoteAction> label="Play/Pause media button" value={remoteShortcuts.mediaPlayPause} options={PLAYER_REMOTE_ACTIONS} onChange={remoteShortcuts.setMediaPlayPause} />
                <ChoiceRow<LongDownAction>
                  label="Long Down"
                  value={remoteShortcuts.longDown}
                  options={[{ label: "Open channel bar", value: "channels" }, { label: "Open TV Guide", value: "guide" }, { label: "No shortcut", value: "none" }]}
                  onChange={remoteShortcuts.setLongDown}
                />
                <Text style={styles.help}>Long OK/Select always opens contextual Quick Actions. Other hardware mappings apply only while fullscreen playback owns the remote.</Text>
                <Action label="Restore remote defaults" icon="refresh-outline" onPress={remoteShortcuts.reset} />
                <View style={styles.divider} />
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
                  options={[{ label: "Comfortable", value: "large" }, { label: "Normal", value: "normal" }, { label: "Compact", value: "compact" }, { label: "Extra compact", value: "extra_compact" }]}
                  onChange={setGuideDensity}
                />
                <ToggleRow
                  label="Instant Guide / reduce motion"
                  value={instantGuide}
                  onChange={setInstantGuide}
                />
                <Text style={styles.help}>
                  Snaps Guide panning and drawer motion so focus borders and metadata keep pace with rapid remote input. Enabled by default.
                </Text>
                <ToggleRow label="Mute guide preview" value={guideUi.mutePreview} onChange={guideUi.setMutePreview} />
                <ToggleRow label="Hide guide preview" value={guideUi.hidePreview} onChange={guideUi.setHidePreview} />
                <View style={styles.calibrationWrap}><TvCalibrationControls /></View>
              </SettingsCard>
            ) : null}

            {section === "backup" ? (
              <SettingsCard title="Backup & Restore" icon="cloud-download-outline">
                <Text style={styles.help}>Favorites backups are portable JSON files. Back Up writes a local copy and offers a shared folder (Downloads / USB) via the system picker so you can move the file off this device. They contain channel identity only—never stream URLs. Restore matches the current playlist and uses the current build&apos;s stream, logo and EPG data.</Text>
                <View style={styles.backupActions}>
                  <Action label={busy ? "Working…" : "Back Up Favorites"} icon="save-outline" onPress={backupFavorites} disabled={busy} />
                  <Action label={busy ? "Working…" : "Restore Favorites"} icon="download-outline" onPress={restoreFavorites} disabled={busy} />
                </View>
                {backupStatus ? <Text style={styles.status}>{backupStatus}</Text> : null}
                <View style={styles.divider} />
                <Text style={styles.help}>
                  Clear favorites is destructive and separate from guide cache. Export a backup first if you may need them later.
                </Text>
                <Action
                  label={
                    busy
                      ? "Working…"
                      : clearFavoritesArmed
                        ? "Confirm clear all favorites"
                        : "Clear all favorites"
                  }
                  icon="warning-outline"
                  onPress={clearFavoritesDangerous}
                  disabled={busy || favorites.length === 0}
                />
              </SettingsCard>
            ) : null}

            {section === "account" ? (
              <SettingsCard title="Account" icon="person-outline">
                <InfoRow label="Profile" value="Local CharmIPTV profile" />
                <Text style={styles.help}>No external account login is exposed in this build. Playlist and EPG details are under EPG Settings.</Text>
              </SettingsCard>
            ) : null}

            {section === "about" ? (
              <SettingsCard title="About CharmIPTV" icon="information-circle-outline">
                <InfoRow label="Version" value={appVersion} />
                <InfoRow label="Android build" value={versionCode ? String(versionCode) : "—"} />
                <InfoRow label="Interface" value="Purple TV experiment" />
                <InfoRow label="Install package" value="Purple / side-by-side" />
                <InfoRow label="Core" value="perf/opt-fix performance grade" />
                <Text style={styles.help}>This branch changes presentation and navigation while preserving the optimized playback, guide, cache, and source architecture underneath.</Text>
              </SettingsCard>
            ) : null}
          </ScrollView>
          </FocusGuide>
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
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  backButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  tileGridWrap: { flex: 1 },
  tileGrid: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "center", gap: 9, paddingHorizontal: 18 },
  detailsWrap: { flex: 1 },
  tile: { width: "23.8%", minHeight: 118, alignItems: "center", justifyContent: "center", gap: 10, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  tileIcon: { width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  tileText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5, textAlign: "center" },
  details: { paddingTop: 10, paddingHorizontal: 24, paddingBottom: 24 },
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
  backupActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  status: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8.5, lineHeight: 12.5 },
  divider: { height: 1, backgroundColor: tvColors.line, marginVertical: 2 },
  infoRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  infoLabel: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  infoValue: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, lineHeight: 12.5 },
  matchBlock: { gap: 2, paddingTop: 4, borderTopWidth: 1, borderTopColor: tvColors.line },
  matchGroups: { gap: 1, paddingTop: 4 },
  calibrationWrap: { borderTopWidth: 1, borderTopColor: tvColors.line, marginTop: 4, paddingTop: 8 },
  pinInputRow: { gap: 6 },
  pinInput: {
    minHeight: 36,
    borderWidth: 1,
    borderColor: tvColors.lineStrong,
    borderRadius: 5,
    paddingHorizontal: 10,
    color: "#fff",
    fontFamily: fonts.medium,
    fontSize: 11,
    backgroundColor: tvColors.panelRaised,
  },
  channelEditBlock: { gap: 3 },
  channelEditActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 8, paddingBottom: 4 },
  miniAction: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panelRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  miniActionText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});

export default function SettingsScreen() {
  return (
    <FocusedTabMount>
      <SettingsScreenContent />
    </FocusedTabMount>
  );
}
