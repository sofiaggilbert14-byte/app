import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useStore } from "@/src/store";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { fonts, radius, tvColors } from "@/src/theme";
import { addTvQuickActionsListener, emitPlayerQuickCommand, setRemoteContext, type PlayerQuickCommand, type TvQuickActionsContext } from "@/src/utils/tvRemote";
import { getGuideSelection } from "@/src/core/guideSelectionStore";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { useChannelCustomize } from "@/src/core/channelCustomize";
import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";
import { useSourceRefreshPreferences } from "@/src/core/sourceRefreshPreferences";
import {
  assignMultiEpgChannel,
  clearMultiEpgChannelAssignments,
  useMultiEpgSources,
} from "@/src/core/multiEpgSources";
import {
  configureNativeUserGuideSources,
  listNativeSourceGuideChannels,
  listNativeUserGuideChannels,
  refreshNativeSourceGuide,
  setNativeGuideChannelBinding,
  setNativeSourceGuideBinding,
} from "@/src/nativeEpg";
import { invalidateGuideOwnershipCaches } from "@/src/source";
import { fingerprintStreamUri, getLastAudioDiagnostics } from "@/src/core/audioDiagnostics";
import { usePlayerEnginePreference, type PlayerEnginePreference } from "@/src/playerEnginePreference";
import { usePlaybackBufferProfile, type PlaybackBufferProfile } from "@/src/core/playbackBufferProfile";

type Mode = "main" | "epg-source" | "epg-channel";
type SourceChoice = { id: string; name: string; url: string; enabled: boolean; legacy: boolean };
type EpgRow = { id: string; name: string };

const BUFFER_ORDER: PlaybackBufferProfile[] = ["low_latency", "balanced", "stable"];
const ENGINE_ORDER: PlayerEnginePreference[] = ["default", "media3", "vlc"];

function nextValue<T>(values: readonly T[], current: T): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + 1) % values.length];
}

export function TvQuickActionsOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ channelId?: string }>();
  const {
    channels,
    channelById,
    favorites,
    toggleFavorite,
    sleepTimerMinutes,
    setSleepTimerMinutes,
    openProgram,
  } = useStore();
  const customize = useChannelCustomize();
  const primaryEpg = useEpgSourcePreferences();
  const refreshPrefs = useSourceRefreshPreferences();
  const multiEpg = useMultiEpgSources();
  const [playerEngine, setPlayerEngine] = usePlayerEnginePreference();
  const [bufferProfile, setBufferProfile] = usePlaybackBufferProfile();

  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<TvQuickActionsContext>("guide");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("main");
  const [sourceChoice, setSourceChoice] = useState<SourceChoice | null>(null);
  const [epgQuery, setEpgQuery] = useState("");
  const [epgRows, setEpgRows] = useState<EpgRow[]>([]);
  const [epgTotal, setEpgTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [focusClaim, setFocusClaim] = useState(false);
  const queryGeneration = useRef(0);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const hiddenSet = useMemo(() => new Set(customize.hiddenIds), [customize.hiddenIds]);
  const channel = channelId ? channelById(channelId) : null;

  const resolvePlayerChannelId = useCallback((): string | null => {
    const diagnostics = getLastAudioDiagnostics();
    if (diagnostics?.role === "fullscreen" && diagnostics.streamKey) {
      for (const item of channels) {
        if (!item.url) continue;
        if (fingerprintStreamUri(item.url) === diagnostics.streamKey) return item.id;
      }
    }
    const routeId = String(params.channelId || "").trim();
    return routeId && channelById(routeId) ? routeId : null;
  }, [channelById, channels, params.channelId]);

  const close = useCallback(() => {
    setOpen(false);
    setMode("main");
    setSourceChoice(null);
    setEpgRows([]);
    setEpgTotal(0);
    setEpgQuery("");
    setStatus(null);
    setBusy(false);
    setRemoteContext(pathname?.startsWith("/player") ? "player" : pathname?.startsWith("/guide") ? "guide" : "default");
  }, [pathname]);

  const runPlayerCommand = useCallback((command: PlayerQuickCommand) => {
    close();
    requestAnimationFrame(() => emitPlayerQuickCommand(command));
  }, [close]);

  useEffect(() => addTvQuickActionsListener((nextContext) => {
    const guideSelection = nextContext === "guide" ? getGuideSelection() : null;
    const id = guideSelection?.channelId || resolvePlayerChannelId();
    if (!id) return;
    const selectedChannel = channelById(id);
    if (!selectedChannel) return;
    void Haptics.selectionAsync().catch(() => undefined);

    if (nextContext === "guide" && guideSelection?.surface === "program" && guideSelection.program) {
      openProgram(guideSelection.program, selectedChannel);
      return;
    }

    setContext(nextContext);
    setChannelId(id);
    setMode("main");
    setStatus(null);
    setSourceChoice(null);
    setOpen(true);
    setRemoteContext("modal");
  }), [channelById, openProgram, resolvePlayerChannelId]);

  useEffect(() => {
    if (!open) return;
    setFocusClaim(false);
    const frame = requestAnimationFrame(() => setFocusClaim(true));
    return () => cancelAnimationFrame(frame);
  }, [open, mode, sourceChoice?.id]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (mode === "epg-channel") {
        setMode("epg-source");
        setSourceChoice(null);
        setEpgRows([]);
        setEpgTotal(0);
        return true;
      }
      if (mode === "epg-source") {
        setMode("main");
        return true;
      }
      close();
      return true;
    });
    return () => sub.remove();
  }, [close, mode, open]);

  useEffect(() => {
    if (!open || mode !== "epg-channel" || !sourceChoice) return;
    const timer = setTimeout(() => {
      const generation = ++queryGeneration.current;
      void (async () => {
        try {
          const page = sourceChoice.legacy
            ? await listNativeUserGuideChannels(epgQuery, 0, 80)
            : await listNativeSourceGuideChannels(sourceChoice.id, epgQuery, 0, 80);
          if (generation !== queryGeneration.current) return;
          setEpgRows(page.rows || []);
          setEpgTotal(Math.max(0, Number(page.total) || 0));
        } catch (error) {
          if (generation !== queryGeneration.current) return;
          setEpgRows([]);
          setEpgTotal(0);
          setStatus(error instanceof Error ? error.message : "Could not read EPG channels.");
        }
      })();
    }, 180);
    return () => clearTimeout(timer);
  }, [epgQuery, mode, open, sourceChoice]);

  const sourceChoices = useMemo<SourceChoice[]>(() => {
    const out: SourceChoice[] = [];
    if (primaryEpg.userUrl) {
      out.push({ id: "user", name: primaryEpg.userName || "Custom EPG", url: primaryEpg.userUrl, enabled: primaryEpg.userEnabled, legacy: true });
    }
    for (const source of multiEpg.sources) {
      if (!source.url) continue;
      out.push({ id: source.id, name: source.name, url: source.url, enabled: source.enabled, legacy: false });
    }
    return out;
  }, [multiEpg.sources, primaryEpg.userEnabled, primaryEpg.userName, primaryEpg.userUrl]);

  const extraOwner = useMemo(
    () => channelId ? multiEpg.sources.find((source) => !!source.overrides[channelId]) || null : null,
    [channelId, multiEpg.sources],
  );
  const legacyOwnerId = channelId ? primaryEpg.userOverrides[channelId] || "" : "";
  const ownerLabel = legacyOwnerId
    ? primaryEpg.userName
    : extraOwner
      ? extraOwner.name
      : primaryEpg.primaryEnabled
        ? "Automatic / Charm EPG"
        : "No EPG source";

  const ensureNativeSources = useCallback(async (override?: { id: string; enabled: boolean }) => {
    const extras = multiEpg.sources.map((source) => ({
      ...source,
      enabled: override?.id === source.id ? override.enabled : source.enabled,
    }));
    await configureNativeUserGuideSources(primaryEpg.primaryEnabled, [
      {
        id: "user",
        url: primaryEpg.userUrl,
        enabled: override?.id === "user" ? override.enabled : primaryEpg.userEnabled,
        refreshHours: refreshPrefs.epgHours,
      },
      ...extras.map((source) => ({ id: source.id, url: source.url, enabled: source.enabled, refreshHours: source.refreshHours })),
    ]);
  }, [multiEpg.sources, primaryEpg.primaryEnabled, primaryEpg.userEnabled, primaryEpg.userUrl, refreshPrefs.epgHours]);

  const assignEpg = useCallback(async (xmltvId: string) => {
    if (!channel || !sourceChoice || busy) return;
    setBusy(true);
    setStatus("Assigning EPG…");
    try {
      if (sourceChoice.legacy) {
        if (extraOwner) await setNativeSourceGuideBinding(extraOwner.id, channel.id, null);
        clearMultiEpgChannelAssignments(channel.id);
        primaryEpg.setUserEnabled(true);
        await ensureNativeSources({ id: "user", enabled: true });
        await setNativeGuideChannelBinding(channel.id, xmltvId);
        primaryEpg.setUserOverride(channel.id, xmltvId);
      } else {
        if (legacyOwnerId) await setNativeGuideChannelBinding(channel.id, null);
        primaryEpg.setUserOverride(channel.id, null);
        const saved = multiEpg.sources.find((source) => source.id === sourceChoice.id);
        if (saved && !saved.enabled) multiEpg.save({ ...saved, enabled: true });
        await ensureNativeSources({ id: sourceChoice.id, enabled: true });
        await setNativeSourceGuideBinding(sourceChoice.id, channel.id, xmltvId);
        assignMultiEpgChannel(sourceChoice.id, channel.id, xmltvId);
        void refreshNativeSourceGuide(sourceChoice.id, sourceChoice.url).catch(() => undefined);
      }
      invalidateGuideOwnershipCaches();
      setStatus(`${channel.name} now uses ${sourceChoice.name}: ${xmltvId}`);
      setMode("main");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not assign EPG.");
    } finally {
      setBusy(false);
    }
  }, [busy, channel, ensureNativeSources, extraOwner, legacyOwnerId, multiEpg, primaryEpg, sourceChoice]);

  const clearEpgAssignment = useCallback(async () => {
    if (!channel || busy) return;
    setBusy(true);
    setStatus("Returning channel to automatic EPG…");
    try {
      if (legacyOwnerId) {
        await setNativeGuideChannelBinding(channel.id, null);
        primaryEpg.setUserOverride(channel.id, null);
      }
      if (extraOwner) {
        await setNativeSourceGuideBinding(extraOwner.id, channel.id, null);
        clearMultiEpgChannelAssignments(channel.id);
      }
      invalidateGuideOwnershipCaches();
      setStatus(primaryEpg.primaryEnabled ? "Automatic Charm EPG restored." : "Custom assignment cleared; built-in EPG is disabled.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear EPG assignment.");
    } finally {
      setBusy(false);
    }
  }, [busy, channel, extraOwner, legacyOwnerId, primaryEpg]);

  const favorite = useCallback(() => {
    if (!channel) return;
    toggleFavorite(channel.id);
    setStatus(favoriteSet.has(channel.id) ? "Removed from Favorites." : "Added to Favorites.");
  }, [channel, favoriteSet, toggleFavorite]);

  const play = useCallback(() => {
    if (!channel) return;
    close();
    openFullscreenPlayer(router, channel.id, { returnToGuide: context === "guide" });
  }, [channel, close, context, router]);

  const goGuide = useCallback(() => {
    close();
    router.replace("/guide" as any);
  }, [close, router]);

  const openSettings = useCallback(() => {
    close();
    router.replace("/settings" as any);
  }, [close, router]);

  if (!open || !channel) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.scrim} />
      <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.drawer}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.kicker}>{context === "guide" ? "CHANNEL QUICK ACTIONS" : "PLAYER QUICK ACTIONS"}</Text>
            <Text numberOfLines={1} style={styles.title}>{channel.name}</Text>
            <Text numberOfLines={1} style={styles.subtitle}>EPG · {ownerLabel}</Text>
          </View>
          <Pressable onPress={close} style={({ focused }: any) => [styles.close, focused && styles.focused]}>
            <Ionicons name="close" size={18} color="#fff" />
          </Pressable>
        </View>

        {mode === "main" ? (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <Action preferredFocus={focusClaim} icon={context === "guide" ? "play" : "heart-outline"} label={context === "guide" ? "Play channel" : (favoriteSet.has(channel.id) ? "Remove Favorite" : "Add Favorite")} onPress={context === "guide" ? play : favorite} />
            {context === "guide" ? <Action icon={favoriteSet.has(channel.id) ? "heart" : "heart-outline"} label={favoriteSet.has(channel.id) ? "Remove Favorite" : "Add Favorite"} onPress={favorite} /> : null}
            <Action icon="git-compare-outline" label="Assign custom EPG" value={ownerLabel} onPress={() => { setStatus(null); setMode("epg-source"); }} />
            {(legacyOwnerId || extraOwner) ? <Action icon="refresh-outline" label="Use automatic EPG" onPress={() => void clearEpgAssignment()} disabled={busy} /> : null}

            {context === "guide" ? (
              <>
                <Action icon={hiddenSet.has(channel.id) ? "eye-outline" : "eye-off-outline"} label={hiddenSet.has(channel.id) ? "Show channel" : "Hide channel"} onPress={() => { customize.toggleHidden(channel.id); setStatus(hiddenSet.has(channel.id) ? "Channel restored." : "Channel hidden."); }} />
                <Action icon="settings-outline" label="Guide / channel settings" onPress={openSettings} />
              </>
            ) : (
              <>
                <Action icon="calendar-outline" label="Open TV Guide" onPress={goGuide} />
                <Action icon="resize-outline" label="Aspect ratio" value="Fit / Zoom / Stretch" onPress={() => runPlayerCommand("CYCLE_ASPECT")} />
                <Action icon="musical-notes-outline" label="Audio / subtitles" value="Live tracks" onPress={() => runPlayerCommand("OPEN_TRACKS")} />
                <Action icon="speedometer-outline" label="Playback buffer" value={bufferProfile.replace("_", " ")} onPress={() => setBufferProfile(nextValue(BUFFER_ORDER, bufferProfile))} />
                <Action icon="play-circle-outline" label="Player engine" value={playerEngine === "default" ? "Auto" : playerEngine.toUpperCase()} onPress={() => setPlayerEngine(nextValue(ENGINE_ORDER, playerEngine))} />
                <Action icon="moon-outline" label="Sleep timer" value={sleepTimerMinutes ? `${sleepTimerMinutes}m` : "Off"} onPress={() => setSleepTimerMinutes(sleepTimerMinutes === 0 ? 15 : sleepTimerMinutes === 15 ? 30 : sleepTimerMinutes === 30 ? 60 : sleepTimerMinutes === 60 ? 90 : 0)} />
                <Action icon="options-outline" label="Playback compatibility" value="Advanced settings" onPress={openSettings} />
                <Action icon="settings-outline" label="All Settings" onPress={openSettings} />
              </>
            )}
            {status ? <Text style={styles.status}>{status}</Text> : null}
          </ScrollView>
        ) : null}

        {mode === "epg-source" ? (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>Choose EPG source</Text>
            {sourceChoices.length ? sourceChoices.map((source) => (
              <Action
                key={source.id}
                preferredFocus={focusClaim && source.id === sourceChoices[0]?.id}
                icon="server-outline"
                label={source.name}
                value={source.enabled ? "Enabled" : "Will enable on assignment"}
                onPress={() => { setSourceChoice(source); setEpgQuery(""); setEpgRows([]); setEpgTotal(0); setMode("epg-channel"); }}
              />
            )) : <Text style={styles.status}>Add and refresh a custom XMLTV source in EPG Settings first.</Text>}
            <Action icon="arrow-back" label="Back" onPress={() => setMode("main")} />
          </ScrollView>
        ) : null}

        {mode === "epg-channel" && sourceChoice ? (
          <View style={styles.epgBody}>
            <Text style={styles.sectionTitle}>{sourceChoice.name}</Text>
            <TextInput
              value={epgQuery}
              onChangeText={setEpgQuery}
              placeholder="Search XMLTV channels"
              placeholderTextColor={tvColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.search}
            />
            <Text style={styles.count}>{epgTotal} XMLTV channels · showing first {Math.min(80, epgRows.length)}</Text>
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {epgRows.map((row) => (
                <Action key={row.id} icon="calendar-outline" label={row.name || row.id} value={row.id} disabled={busy} onPress={() => void assignEpg(row.id)} />
              ))}
              {!epgRows.length ? <Text style={styles.status}>No matching XMLTV channels. Refresh this EPG source from EPG Settings if its directory has not been indexed yet.</Text> : null}
              <Action icon="arrow-back" label="Back to EPG sources" onPress={() => { setMode("epg-source"); setSourceChoice(null); }} />
            </ScrollView>
          </View>
        ) : null}
      </FocusGuide>
    </View>
  );
}

function Action({
  icon,
  label,
  value,
  onPress,
  disabled = false,
  preferredFocus = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value?: string;
  onPress: () => void;
  disabled?: boolean;
  preferredFocus?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      hasTVPreferredFocus={preferredFocus}
      onPress={onPress}
      style={({ focused }: any) => [styles.row, disabled && styles.disabled, focused && styles.focused]}
    >
      <Ionicons name={icon} size={17} color={tvColors.purpleSoft} />
      <Text numberOfLines={1} style={styles.rowText}>{label}</Text>
      {value ? <Text numberOfLines={1} style={styles.value}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={13} color={tvColors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, zIndex: 10000, flexDirection: "row", justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.38)" },
  drawer: { width: 390, maxWidth: "46%", height: "100%", backgroundColor: "rgba(12,10,25,0.985)", borderLeftWidth: 1, borderLeftColor: tvColors.lineStrong, paddingTop: 24, paddingHorizontal: 14, paddingBottom: 18 },
  header: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: tvColors.line },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 0.8 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 3 },
  subtitle: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, marginTop: 3 },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, borderWidth: 2, borderColor: "transparent" },
  list: { gap: 5, paddingVertical: 10, paddingBottom: 28 },
  row: { minHeight: 43, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: "rgba(255,255,255,0.035)" },
  rowText: { flex: 1, minWidth: 0, color: "#fff", fontFamily: fonts.medium, fontSize: 10.5 },
  value: { maxWidth: 145, color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8.5, textTransform: "capitalize" },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  disabled: { opacity: 0.42 },
  status: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 9.5, lineHeight: 14, padding: 8 },
  sectionTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 12, marginTop: 4, marginBottom: 4 },
  epgBody: { flex: 1, minHeight: 0, paddingTop: 10 },
  search: { minHeight: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.lineStrong, color: "#fff", paddingHorizontal: 10, fontFamily: fonts.regular, fontSize: 10.5, marginBottom: 6 },
  count: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, marginBottom: 3 },
});
