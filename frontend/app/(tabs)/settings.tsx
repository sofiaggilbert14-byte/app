import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type EpgGuideFilter,
  type GuideDensity,
  type GuideLayout,
  type GuideWindowHours,
  type PlayerControlsTimeoutMs,
  type PowerProfile,
  type SafePreviewMode,
  type SleepTimerMinutes,
  type StartScreen,
} from "@/src/store";
import { clearGuideCache, refreshEpgOnly, refreshSource, sourceDiagnostics, type SourceDiagnostics } from "@/src/source";
import {
  type PlayerEnginePreference,
  usePlayerEnginePreference,
} from "@/src/playerEnginePreference";
import {
  type SourceRefreshIntervalHours,
  useSourceRefreshPreferences,
} from "@/src/core/sourceRefreshPreferences";
import { type LogoPriority, useLogoPriority } from "@/src/core/logoPreferences";
import { chooseLocalLogoFolder, clearLocalLogoFolder } from "@/src/core/localLogoFolder";
import {
  type LongDownAction,
  type LongSelectAction,
  useRemoteShortcutPreferences,
} from "@/src/core/remoteShortcutPreferences";
import { clearChannelLogoCache } from "@/src/components/ChannelLogo";
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
import { channelHasEpgMatch } from "@/src/core/epgUserOverrides";
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
  usePlayerCompatibilityPreferences,
  type Media3AudioMode,
  type VlcAudioOutput,
} from "@/src/core/playerCompatibilityPreferences";
import {
  getDeviceCodecCapabilities,
  type DeviceCodecCapabilities,
} from "@/src/core/deviceCodecCapabilities";
import dayjs from "dayjs";
import * as FileSystem from "expo-file-system/legacy";
import { formatRelativeAge } from "@/src/utils/time";

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

export default function SettingsScreen() {
  const router = useRouter();
  const {
    refresh,
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
    autoRetryStreams,
    setAutoRetryStreams,
    preferTvgIdOnly,
    setPreferTvgIdOnly,
    powerProfile,
    setPowerProfile,
    logosOffWhileSurfing,
    setLogosOffWhileSurfing,
    instantGuide,
    setInstantGuide,
    epgGuideFilter,
    setEpgGuideFilter,
    guideWindowHours,
    setGuideWindowHours,
    clock24h,
    setClock24h,
    startScreen,
    setStartScreen,
    sleepTimerMinutes,
    setSleepTimerMinutes,
  } = useStore();
  const [playerEnginePreference, setPlayerEnginePreference] = usePlayerEnginePreference();
  const sourceRefresh = useSourceRefreshPreferences();
  const [logoPriority, setLogoPriority] = useLogoPriority();
  const remoteShortcuts = useRemoteShortcutPreferences();
  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();
  const channelCustomize = useChannelCustomize();
  const guideUi = useGuideUiPreferences();
  const parental = useParentalPin();
  const subtitles = useSubtitlePreferences();
  const audioPreferences = useAudioTrackPreferences();
  const playerCompat = usePlayerCompatibilityPreferences();
  const latestAudio = getLastAudioDiagnostics();
  const [section, setSection] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [clearFavoritesArmed, setClearFavoritesArmed] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostics | null>(null);
  const [codecCapabilities, setCodecCapabilities] = useState<DeviceCodecCapabilities | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [focusedCustomizeId, setFocusedCustomizeId] = useState<string | null>(null);
  const clearFavoritesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mount-once preferred focus — sticky hasTVPreferredFocus steals focus on re-render.
  const [preferTileFocus, setPreferTileFocus] = useState(true);
  const [preferBackFocus, setPreferBackFocus] = useState(false);

  useEffect(() => {
    if (section !== "general" && section !== "backup" && section !== "about" && section !== "health") return;
    void sourceDiagnostics().then(setDiagnostics).catch(() => undefined);
  }, [section, busy]);
  useEffect(() => {
    if (section !== "health" && section !== "about") return;
    void getDeviceCodecCapabilities().then(setCodecCapabilities);
  }, [section]);

  useEffect(() => {
    if (!preferTileFocus) return;
    const timer = setTimeout(() => setPreferTileFocus(false), 700);
    return () => clearTimeout(timer);
  }, [preferTileFocus]);

  useEffect(() => {
    if (!section) return;
    setClearFavoritesArmed(false);
    setPreferBackFocus(true);
    const timer = setTimeout(() => setPreferBackFocus(false), 700);
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
      // Close a settings section first — never open the drawer on a single Back.
      if (section) {
        setBackupStatus(null);
        setClearFavoritesArmed(false);
        setSection(null);
        return true;
      }
      // Defer to PurpleTvShell double-Back policy (arm / open / close).
      return false;
    }, [section]),
  );

  const appVersion = Constants.expoConfig?.version || "2.0.0-purple";
  const versionCode = (Constants.expoConfig as any)?.android?.versionCode;
  const selected = useMemo(() => TILES.find((item) => item.id === section), [section]);
  const groupMatchBreakdown = useMemo(() => {
    const byGroup = new Map<string, { matched: number; unmatched: number; total: number }>();
    for (const channel of channels) {
      const name = (channel.group || "Ungrouped").trim() || "Ungrouped";
      const entry = byGroup.get(name) || { matched: 0, unmatched: 0, total: 0 };
      entry.total += 1;
      if (channelHasEpgMatch(channel)) entry.matched += 1;
      else entry.unmatched += 1;
      byGroup.set(name, entry);
    }
    return Array.from(byGroup.entries())
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [channels]);

  const customizeChannels = useMemo(() => channels.slice(0, 30), [channels]);
  const hiddenSet = useMemo(() => new Set(channelCustomize.hiddenIds), [channelCustomize.hiddenIds]);
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

  const reloadEpgOnly = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setBackupStatus("Refreshing EPG only…");
    try {
      await refreshEpgOnly();
      await refresh(true);
      setBackupStatus("EPG refreshed. Playlist was left unchanged.");
      void sourceDiagnostics().then(setDiagnostics).catch(() => undefined);
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "EPG refresh failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const exportDiagnostics = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const snap = await sourceDiagnostics();
      setDiagnostics(snap);
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

  const clearCache = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setBackupStatus("Clearing guide cache (favorites kept)…");
    try {
      await clearGuideCache();
      await refreshSource(true);
      await refresh(true);
      setBackupStatus("Guide cache cleared and rebuilt. Favorites were not changed.");
      void sourceDiagnostics().then(setDiagnostics).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

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
                <ChoiceRow<EpgGuideFilter>
                  label="Guide EPG filter"
                  value={epgGuideFilter}
                  options={[
                    { label: "All", value: "all" },
                    { label: "Matched", value: "matched" },
                    { label: "Unmatched", value: "unmatched" },
                  ]}
                  onChange={setEpgGuideFilter}
                />
                <ChoiceRow<GuideWindowHours>
                  label="Guide window"
                  value={guideWindowHours}
                  options={[
                    { label: "6h", value: 6 },
                    { label: "8h", value: 8 },
                    { label: "12h", value: 12 },
                    { label: "24h", value: 24 },
                  ]}
                  onChange={setGuideWindowHours}
                />
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
                <ToggleRow
                  label="Prefer tvg-id matching only"
                  value={preferTvgIdOnly}
                  onChange={setPreferTvgIdOnly}
                />
                <Text style={styles.help}>
                  For messy providers: match playlist channels by tvg-id only (never by display name). Ambiguous names never invent a match. Turn this off to allow conservative display-name matching.
                </Text>
                <ChoiceRow<SourceRefreshIntervalHours>
                  label="Playlist auto refresh"
                  value={sourceRefresh.playlistHours}
                  options={[
                    { label: "Manual only", value: 0 },
                    { label: "Every 2 hours", value: 2 },
                    { label: "Every 4 hours", value: 4 },
                    { label: "Every 6 hours", value: 6 },
                    { label: "Every 12 hours", value: 12 },
                    { label: "Every 24 hours", value: 24 },
                  ]}
                  onChange={sourceRefresh.setPlaylistHours}
                />
                <ChoiceRow<SourceRefreshIntervalHours>
                  label="EPG auto refresh"
                  value={sourceRefresh.epgHours}
                  options={[
                    { label: "Manual only", value: 0 },
                    { label: "Every 2 hours", value: 2 },
                    { label: "Every 4 hours", value: 4 },
                    { label: "Every 6 hours", value: 6 },
                    { label: "Every 12 hours", value: 12 },
                    { label: "Every 24 hours", value: 24 },
                  ]}
                  onChange={sourceRefresh.setEpgHours}
                />
                <Text style={styles.help}>Playlist and guide refresh independently. Defaults are 24h for channels and 6h for EPG; Manual only disables automatic checks for that source.</Text>
                <ChoiceRow<LogoPriority>
                  label="Channel logos priority"
                  value={logoPriority}
                  options={[
                    { label: "Prefer playlist logos", value: "playlist" },
                    { label: "Prefer EPG logos", value: "epg" },
                  ]}
                  onChange={setLogoPriority}
                />
                <Text style={styles.help}>Both playlist and EPG logo URLs are retained. The preferred source wins, with the other used as fallback.</Text>
                <Action label="Choose local / USB / network logo folder" icon="folder-open-outline" onPress={() => void chooseLocalLogoFolder()} />
                <Action label="Stop using local logo folder" icon="folder-outline" onPress={() => void clearLocalLogoFolder()} />
                <Action label="Clear channel logo cache" icon="image-outline" onPress={() => void clearChannelLogoCache(true)} />
                <Action label={busy ? "Refreshing…" : "Refresh playlist & EPG"} icon="refresh" onPress={hardReload} disabled={busy} />
                <Action label={busy ? "Working…" : "Refresh EPG only"} icon="calendar-outline" onPress={reloadEpgOnly} disabled={busy} />
                <Action label={busy ? "Working…" : "Export diagnostics"} icon="document-text-outline" onPress={exportDiagnostics} disabled={busy} />
                {backupStatus && section === "general" ? <Text style={styles.status}>{backupStatus}</Text> : null}
                {diagnostics?.matchQuality ? (
                  <View style={styles.matchBlock}>
                    <Text style={styles.settingLabel}>EPG match quality</Text>
                    <InfoRow label="Matched" value={String(diagnostics.matchQuality.matched)} />
                    <InfoRow label="Ambiguous" value={String(diagnostics.matchQuality.ambiguous)} />
                    <InfoRow label="Unmatched" value={String(diagnostics.matchQuality.unmatched)} />
                    {groupMatchBreakdown.length ? (
                      <View style={styles.matchGroups}>
                        {groupMatchBreakdown.map((item) => (
                          <InfoRow
                            key={item.name}
                            label={item.name}
                            value={`${item.matched} matched / ${item.unmatched} unmatched`}
                          />
                        ))}
                      </View>
                    ) : null}
                    <Text style={styles.help}>
                      Guide filter and favorite folders use this match state. Matched ≈ channels with a programme source id after refresh.
                    </Text>
                  </View>
                ) : null}
                <InfoRow
                  label="Playlist refreshed"
                  value={
                    diagnostics?.playlistRefreshedAt
                      ? `${formatRelativeAge(diagnostics.playlistRefreshedAt)} · ${dayjs(diagnostics.playlistRefreshedAt).format(clock24h ? "MMM D, HH:mm" : "MMM D, h:mm A")}`
                      : "—"
                  }
                />
                <InfoRow
                  label="EPG refreshed"
                  value={
                    diagnostics?.guideRefreshedAt
                      ? `${formatRelativeAge(diagnostics.guideRefreshedAt)} · ${dayjs(diagnostics.guideRefreshedAt).format(clock24h ? "MMM D, HH:mm" : "MMM D, h:mm A")}`
                      : "—"
                  }
                />
              </SettingsCard>
            ) : null}

            {section === "player" ? (
              <SettingsCard title="Playback" icon="play-circle-outline">
                <ChoiceRow<PlayerEnginePreference>
                  label="Video player"
                  value={playerEnginePreference}
                  options={[
                    { label: "Expo / Media3 (Default)", value: "default" },
                    { label: "Expo / Media3 only", value: "media3" },
                    { label: "VLC", value: "vlc" },
                  ]}
                  onChange={setPlayerEnginePreference}
                />
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
                <ChoiceRow<LongSelectAction>
                  label="Remote · Long OK/Select"
                  value={remoteShortcuts.longSelect}
                  options={[
                    { label: "Show player controls", value: "controls" },
                    { label: "Open TV Guide", value: "guide" },
                    { label: "No shortcut", value: "none" },
                  ]}
                  onChange={remoteShortcuts.setLongSelect}
                />
                <Text style={styles.help}>Directional D-pad keys stay reserved for deterministic focus/navigation. Only safe long-press shortcuts are remappable.</Text>
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
                <ToggleRow label="Auto retry streams" value={autoRetryStreams} onChange={setAutoRetryStreams} />
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
                <Text style={styles.help}>
                  Media3 exposes audio/CC tracks and uses the Android TV codec path. Choose Media3 to keep one player engine; VLC remains an optional compatibility mode.
                </Text>
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Audio / CC</Text>
                <Text style={styles.help}>
                  Preferred audio language auto-selects a matching track when Media3 or VLC exposes one.
                  The last working track is remembered per channel (up to 128). Use Audio/CC in the fullscreen player to pick a track manually.
                </Text>
                <ChoiceRow<string>
                  label="Preferred audio language"
                  value={audioPreferences.defaultLanguage}
                  options={PREFERRED_AUDIO_LANGUAGE_OPTIONS}
                  onChange={audioPreferences.setDefaultLanguage}
                />
                <ToggleRow
                  label="Silent-audio fallback"
                  value={playerCompat.silentAudioFallback}
                  onChange={playerCompat.setSilentAudioFallback}
                />
                <Text style={styles.help}>
                  When Media3 reports an unsupported or silent track, automatically try VLC compatibility mode (unless the engine is forced).
                </Text>
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Media3</Text>
                <ChoiceRow<Media3AudioMode>
                  label="Media3 audio mode"
                  value={playerCompat.media3AudioMode}
                  options={[
                    { label: "Auto", value: "auto" },
                    { label: "Device codecs", value: "device" },
                    { label: "FFmpeg extension", value: "ffmpeg" },
                  ]}
                  onChange={playerCompat.setMedia3AudioMode}
                />
                <ToggleRow
                  label="Media3 tunneling"
                  value={playerCompat.media3Tunneling}
                  onChange={playerCompat.setMedia3Tunneling}
                />
                <Text style={styles.help}>
                  Tunneling can reduce latency on some Android TV devices but may break audio on others. Leave off unless you are testing.
                </Text>
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>VLC</Text>
                <ChoiceRow<VlcAudioOutput>
                  label="VLC audio output"
                  value={playerCompat.vlcAudioOutput}
                  options={[
                    { label: "Auto", value: "auto" },
                    { label: "Stereo / 2-channel", value: "stereo" },
                    { label: "Passthrough", value: "passthrough" },
                  ]}
                  onChange={playerCompat.setVlcAudioOutput}
                />
                <Text style={styles.help}>
                  Stereo / 2-channel forces a downmix. Changing VLC or Media3 audio options remounts the active player so the new setting applies immediately.
                </Text>
                <ToggleRow
                  label="VLC hardware decode"
                  value={playerCompat.vlcHardwareDecode}
                  onChange={playerCompat.setVlcHardwareDecode}
                />
                <Text style={styles.help}>
                  Hardware decode is faster on most Fire TV / Android TV boxes. Turn it off only if a specific channel fails on VLC.
                </Text>
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
                <InfoRow label="Channels" value={String(channels.length)} />
                <InfoRow label="Matched" value={String(diagnostics?.matchQuality?.matched ?? "—")} />
                <InfoRow label="Unmatched" value={String(diagnostics?.matchQuality?.unmatched ?? "—")} />
                <InfoRow
                  label="Unmatched %"
                  value={(() => {
                    const matched = diagnostics?.matchQuality?.matched ?? 0;
                    const unmatched = diagnostics?.matchQuality?.unmatched ?? 0;
                    const denom = matched + unmatched + (diagnostics?.matchQuality?.ambiguous ?? 0);
                    if (!denom) return "—";
                    return `${Math.round((unmatched / denom) * 100)}%`;
                  })()}
                />
                <InfoRow label="Failed streams" value={String(failedStreamCount())} />
                <InfoRow label="Ambiguous matches" value={String(diagnostics?.matchQuality?.ambiguous ?? "—")} />
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
                <InfoRow
                  label="Playlist refreshed"
                  value={
                    diagnostics?.playlistRefreshedAt
                      ? `${formatRelativeAge(diagnostics.playlistRefreshedAt)} · ${dayjs(diagnostics.playlistRefreshedAt).format(clock24h ? "MMM D, HH:mm" : "MMM D, h:mm A")}`
                      : "—"
                  }
                />
                <InfoRow
                  label="Guide refreshed"
                  value={
                    diagnostics?.guideRefreshedAt
                      ? `${formatRelativeAge(diagnostics.guideRefreshedAt)} · ${dayjs(diagnostics.guideRefreshedAt).format(clock24h ? "MMM D, HH:mm" : "MMM D, h:mm A")}`
                      : "—"
                  }
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
                  Cap of 30 rows for TV memory. Focus a channel, then Hide, Move, or set a custom number. Clear custom order resets sort.
                </Text>
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
                  const displayNumber = customNumber || index + 1;
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
                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, -1)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>Up</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, 1)}
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
                  Clear guide cache is safe — rebuilds playlist/EPG meta and native guide DB only. Favorites stay intact.
                </Text>
                <Action label={busy ? "Working…" : "Clear & rebuild guide cache"} icon="trash-outline" onPress={clearCache} disabled={busy} />
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
