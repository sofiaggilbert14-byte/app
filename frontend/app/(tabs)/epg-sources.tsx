import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { clearChannelLogoCache } from "@/src/components/ChannelLogo";
import { useStore, type EpgGuideFilter, type GuideWindowHours } from "@/src/store";
import { clearGuideCache, refreshEpgOnly, refreshSource, sourceDiagnostics, sourceStatus, subscribeSource, type SourceDiagnostics } from "@/src/source";
import type { SourceStatus } from "@/src/api";
import { type SourceRefreshIntervalHours, useSourceRefreshPreferences } from "@/src/core/sourceRefreshPreferences";
import { type LogoPriority, useLogoPriority } from "@/src/core/logoPreferences";
import { chooseLocalLogoFolder, clearLocalLogoFolder } from "@/src/core/localLogoFolder";
import { channelHasOwnedEpgMatch } from "@/src/core/epgUserOverrides";
import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";
import { useCustomGuideGroups } from "@/src/core/customGuideGroups";
import { GUIDE_START_LAST_USED, useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { formatRelativeAge } from "@/src/utils/time";
import { createCustomEpgSourceId, useMultiEpgSources } from "@/src/core/multiEpgSources";
import { fonts, radius, tvColors } from "@/src/theme";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";

const REFRESH_OPTIONS: { label: string; value: SourceRefreshIntervalHours }[] = [
  { label: "Manual only", value: 0 }, { label: "2h", value: 2 }, { label: "4h", value: 4 },
  { label: "6h", value: 6 }, { label: "12h", value: 12 }, { label: "24h", value: 24 },
];

const STANDARD_GUIDE_GROUPS = ["All", "Favorites", "Sports", "News", "Movies", "Kids", "Music"] as const;
type ActiveAction = "refresh-all" | "refresh-epg" | "rebuild" | "logo" | null;

function EpgSourcesScreenContent() {
  const router = useRouter();
  const { refresh, channels, clock24h, epgGuideFilter, setEpgGuideFilter, guideWindowHours, setGuideWindowHours, preferTvgIdOnly, setPreferTvgIdOnly } = useStore();
  const sourceRefresh = useSourceRefreshPreferences();
  const guideUi = useGuideUiPreferences();
  const epgOwnership = useEpgSourcePreferences();
  const multiEpg = useMultiEpgSources();
  const customGuideGroups = useCustomGuideGroups();
  const [logoPriority, setLogoPriority] = useLogoPriority();
  const [status, setStatus] = useState<SourceStatus>(() => sourceStatus());
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostics | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [preferTopFocus, setPreferTopFocus] = useState(true);
  const operationInFlight = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const busy = activeAction !== null;

  useFocusEffect(
    useCallback(() => {
      setPreferTopFocus(true);
      const topTimer = setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 0);
      const focusTimer = setTimeout(() => setPreferTopFocus(false), 180);
      return () => {
        clearTimeout(topTimer);
        clearTimeout(focusTimer);
      };
    }, []),
  );

  useTvBackHandler(useCallback(() => {
    router.replace("/settings" as any);
    return true;
  }, [router]));

  const load = useCallback(() => {
    setStatus(sourceStatus());
    void sourceDiagnostics().then(setDiagnostics).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    return subscribeSource(load);
  }, [load]);

  const runAction = useCallback(async (kind: Exclude<ActiveAction, null>, message: string, action: () => Promise<string>) => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setActiveAction(kind);
    setActionStatus(message);
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      setActionStatus(await action());
      load();
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "The EPG operation failed.");
    } finally {
      operationInFlight.current = false;
      setActiveAction(null);
    }
  }, [load]);

  const refreshAll = useCallback(() => void runAction("refresh-all", "Refreshing playlist and EPG…", async () => {
    setStatus(await refreshSource(true));
    await refresh(true);
    return "Playlist and EPG refreshed.";
  }), [refresh, runAction]);
  const refreshGuide = useCallback(() => void runAction("refresh-epg", "Refreshing EPG only…", async () => {
    setStatus(await refreshEpgOnly());
    await refresh(true);
    return "EPG refreshed. Playlist was left unchanged.";
  }), [refresh, runAction]);
  const rebuildGuide = useCallback(() => void runAction("rebuild", "Clearing and rebuilding guide cache…", async () => {
    await clearGuideCache();
    setStatus(await refreshSource(true));
    await refresh(true);
    return "Guide cache rebuilt. Favorites were not changed.";
  }), [refresh, runAction]);
  const logoAction = useCallback((message: string, done: string, action: () => Promise<unknown>) => {
    void runAction("logo", message, async () => {
      await action();
      return done;
    });
  }, [runAction]);

  const epgMatchOwnership = useMemo(() => ({
    primaryEnabled: epgOwnership.primaryEnabled,
    userEnabled: epgOwnership.userEnabled,
    userOverrides: epgOwnership.userOverrides,
  }), [epgOwnership.primaryEnabled, epgOwnership.userEnabled, epgOwnership.userOverrides]);

  const groupMatches = useMemo(() => {
    const groups = new Map<string, { matched: number; unmatched: number; total: number }>();
    for (const channel of channels) {
      const name = (channel.group || "Ungrouped").trim() || "Ungrouped";
      const item = groups.get(name) || { matched: 0, unmatched: 0, total: 0 };
      item.total += 1;
      if (channelHasOwnedEpgMatch(channel, epgMatchOwnership)) item.matched += 1;
      else item.unmatched += 1;
      groups.set(name, item);
    }
    return Array.from(groups.entries()).map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 6);
  }, [channels, epgMatchOwnership]);

  const guideStartOptions = useMemo(() => {
    const actualGroups = new Set<string>();
    for (const channel of channels) {
      const name = String(channel.group || "").trim();
      if (name) actualGroups.add(name);
    }
    const names = Array.from(new Set<string>([
      ...STANDARD_GUIDE_GROUPS,
      ...guideUi.pinnedGroups,
      ...customGuideGroups.groups.map((item) => item.name),
      guideUi.startGroup !== GUIDE_START_LAST_USED ? guideUi.startGroup : "",
    ])).filter((name) =>
      !!name &&
      !guideUi.hiddenGroups.includes(name) &&
      (name === "All" || name === "Favorites" || customGuideGroups.byName.has(name) || actualGroups.has(name) || STANDARD_GUIDE_GROUPS.includes(name as any)),
    );
    return [
      { label: "Last used", value: GUIDE_START_LAST_USED },
      ...names.map((name) => ({ label: name, value: name })),
    ];
  }, [channels, customGuideGroups.byName, customGuideGroups.groups, guideUi.hiddenGroups, guideUi.pinnedGroups, guideUi.startGroup]);

  const timeFormat = clock24h ? "MMM D, HH:mm" : "MMM D, h:mm A";

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View><Text style={styles.kicker}>GUIDE CONFIGURATION</Text><Text style={styles.title}>EPG & Playlist</Text></View>
          <Pressable hasTVPreferredFocus={preferTopFocus} onFocus={() => setPreferTopFocus(false)} onPress={() => router.replace("/settings" as any)} style={({ focused }: any) => [styles.back, focused && styles.focused]}>
            <Ionicons name="arrow-back" size={14} color="#fff" /><Text style={styles.backText}>All Settings</Text>
          </Pressable>
        </View>
        <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.scrollWrap}>
          <ScrollView
            ref={scrollRef}
            scrollEnabled
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={styles.content}
          >
            <Card title="Sources" icon="server-outline">
              <SourceRow title="Primary XMLTV Guide" subtitle="Managed by CharmIPTV · locked source" status={!epgOwnership.primaryEnabled ? "Disabled" : status.error ? "Guide error — see below" : "Active"} />
              <SourceRow title={epgOwnership.userName} subtitle="Saved custom XMLTV source · select for settings" status={!epgOwnership.userEnabled ? "Disabled" : epgOwnership.userUrl ? `${Object.keys(epgOwnership.userOverrides).length} assigned channels` : "Enabled · URL required"} onPress={() => router.push("/epg-custom" as any)} />
              {multiEpg.sources.map((source) => (
                <SourceRow key={source.id} title={source.name} subtitle="Independent custom XMLTV source · select for settings" status={!source.enabled ? "Disabled" : source.url ? `${Object.keys(source.overrides).length} assigned channels` : "Enabled · URL required"} onPress={() => router.push({ pathname: "/epg-source" as any, params: { sourceId: source.id } })} />
              ))}
              {multiEpg.canAdd ? <Action label="Add another EPG source" icon="add-circle-outline" onPress={() => router.push({ pathname: "/epg-source" as any, params: { sourceId: createCustomEpgSourceId(), create: "1" } })} /> : null}
              <SourceRow title="Playlist Channel Map" subtitle="Managed by CharmIPTV · locked source" status={`${status.channel_count || 0} channels`} />
              <SourceRow title="Native EPG Cache" subtitle="Streamed XMLTV on-device (Android)" status={status.error ? "Unavailable" : `${diagnostics?.programs || 0} cached programs`} />
            </Card>
            <Card title="Guide Data" icon="calendar-outline">
              <ChoiceRow<string>
                label="Guide opens on"
                value={guideUi.startGroup}
                options={guideStartOptions}
                onChange={guideUi.setStartGroup}
              />
              <Text style={styles.help}>Choose which Guide group opens first on a normal Guide entry. Last used keeps your previous Guide tab. Search and returning from fullscreen always open on the requested/current channel instead.</Text>
              <ToggleRow label="Show raw provider/M3U groups" value={guideUi.showProviderGroups} onChange={guideUi.setShowProviderGroups} />
              <Text style={styles.help}>Off keeps provider categories hidden while Charm still uses their names internally to classify channels into Sports, News, Movies, Kids, Entertainment and Miscellaneous.</Text>
              <Action label="Manage Guide groups & custom tabs" icon="albums-outline" onPress={() => router.push("/group-settings" as any)} />
              <Action label="Custom EPG & channel assignments" icon="git-compare-outline" onPress={() => router.push("/epg-custom" as any)} />
              <ChoiceRow<EpgGuideFilter> label="Guide EPG filter" value={epgGuideFilter} options={[{ label: "All", value: "all" }, { label: "Matched", value: "matched" }, { label: "Unmatched", value: "unmatched" }]} onChange={setEpgGuideFilter} />
              <ChoiceRow<GuideWindowHours> label="Guide window" value={guideWindowHours} options={[{ label: "6h", value: 6 }, { label: "8h", value: 8 }, { label: "12h", value: 12 }, { label: "24h", value: 24 }]} onChange={setGuideWindowHours} />
              <ToggleRow label="Prefer tvg-id matching only" value={preferTvgIdOnly} onChange={setPreferTvgIdOnly} />
              <Text style={styles.help}>Use strict IDs for messy providers. Turn this off to allow conservative display-name matching; ambiguous names never invent a match.</Text>
            </Card>
            <Card title="Refresh Schedule" icon="time-outline">
              <ChoiceRow<SourceRefreshIntervalHours> label="Playlist auto refresh" value={sourceRefresh.playlistHours} options={REFRESH_OPTIONS} onChange={sourceRefresh.setPlaylistHours} />
              <ChoiceRow<SourceRefreshIntervalHours> label="EPG auto refresh" value={sourceRefresh.epgHours} options={REFRESH_OPTIONS} onChange={sourceRefresh.setEpgHours} />
              <ChoiceRow<1 | 3 | 7 | 14>
                label="Past days to keep EPG"
                value={sourceRefresh.epgPastDays}
                options={[{ label: "1 day", value: 1 }, { label: "3 days", value: 3 }, { label: "7 days", value: 7 }, { label: "14 days", value: 14 }]}
                onChange={sourceRefresh.setEpgPastDays}
              />
              <ToggleRow label="Update EPG on app start" value={sourceRefresh.updateEpgOnAppStart} onChange={sourceRefresh.setUpdateEpgOnAppStart} />
              <ToggleRow label="Update EPG when playlist changes" value={sourceRefresh.updateEpgOnPlaylistChange} onChange={sourceRefresh.setUpdateEpgOnPlaylistChange} />
              <Text style={styles.help}>Playlist and EPG refresh independently. Only the operation you start runs; repeat OK presses are ignored until it finishes.</Text>
              <Action label={activeAction === "refresh-all" ? "Working…" : "Refresh playlist & EPG now"} icon="refresh" onPress={refreshAll} disabled={busy} />
              <Action label={activeAction === "refresh-epg" ? "Working…" : "Refresh EPG only now"} icon="calendar-outline" onPress={refreshGuide} disabled={busy} />
            </Card>
            <Card title="Channel Logo Sources" icon="image-outline">
              <ChoiceRow<LogoPriority> label="Channel logos priority" value={logoPriority} options={[{ label: "Prefer playlist", value: "playlist" }, { label: "Prefer EPG", value: "epg" }]} onChange={setLogoPriority} />
              <Text style={styles.help}>The preferred source wins; the other URL remains available as fallback.</Text>
              <Action label={activeAction === "logo" ? "Working…" : "Choose local / USB / network logo folder"} icon="folder-open-outline" onPress={() => logoAction("Opening logo folder picker…", "Logo folder selection finished.", chooseLocalLogoFolder)} disabled={busy} />
              <Action label="Stop using local logo folder" icon="folder-outline" onPress={() => logoAction("Removing local logo folder…", "Local logo folder removed.", clearLocalLogoFolder)} disabled={busy} />
              <Action label="Clear channel logo cache" icon="image-outline" onPress={() => logoAction("Clearing channel logo cache…", "Channel logo cache cleared.", () => clearChannelLogoCache(true))} disabled={busy} />
            </Card>
            <Card title="Source Health" icon="pulse-outline">
              <Info label="Channels" value={String(channels.length)} />
              <Info label="Channels with EPG" value={String(status.channels_with_epg || 0)} />
              <Info label="Matched" value={String(diagnostics?.matchQuality?.matched ?? "—")} />
              <Info label="Ambiguous" value={String(diagnostics?.matchQuality?.ambiguous ?? "—")} />
              <Info label="Unmatched" value={String(diagnostics?.matchQuality?.unmatched ?? "—")} />
              <Info label="Refresh in progress" value={diagnostics?.refreshInFlight ? "Yes" : "No"} />
              <Info label="Playlist refreshed" value={diagnostics?.playlistRefreshedAt ? `${formatRelativeAge(diagnostics.playlistRefreshedAt)} · ${dayjs(diagnostics.playlistRefreshedAt).format(timeFormat)}` : "—"} />
              <Info label="EPG refreshed" value={diagnostics?.guideRefreshedAt ? `${formatRelativeAge(diagnostics.guideRefreshedAt)} · ${dayjs(diagnostics.guideRefreshedAt).format(timeFormat)}` : "—"} />
              <Info label="Cache age" value={diagnostics?.cacheAgeMinutes != null ? `${diagnostics.cacheAgeMinutes} min` : "—"} />
              {groupMatches.map((item) => <Info key={item.name} label={item.name} value={`${item.matched} matched / ${item.unmatched} unmatched`} />)}
              {diagnostics?.epgError || status.error ? <Text style={styles.error} testID="epg-sources-error">{diagnostics?.epgError || status.error}</Text> : null}
            </Card>
            <Card title="Maintenance" icon="construct-outline">
              <Text style={styles.help}>Rebuilding clears playlist/EPG metadata and the native guide database, then downloads fresh data. Favorites remain intact.</Text>
              <Action label={activeAction === "rebuild" ? "Working…" : "Clear & rebuild guide cache"} icon="trash-outline" onPress={rebuildGuide} disabled={busy} />
            </Card>
            {actionStatus ? <Text style={styles.actionStatus} accessibilityLiveRegion="polite">{actionStatus}</Text> : null}
          </ScrollView>
        </FocusGuide>
      </View>
    </PurpleTvShell>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ComponentProps<typeof Ionicons>["name"]; children: React.ReactNode }) {
  return <View style={styles.card}><View style={styles.cardHeader}><Ionicons name={icon} size={16} color={tvColors.purpleSoft} /><Text style={styles.cardTitle}>{title}</Text></View>{children}</View>;
}
function SourceRow({ title, subtitle, status, onPress }: { title: string; subtitle: string; status: string; onPress?: () => void }) {
  const content = <><View style={styles.sourceCopy}><Text style={styles.sourceTitle}>{title}</Text><Text style={styles.sourceSub}>{subtitle}</Text></View><Text style={styles.sourceStatus}>{status}</Text><Ionicons name={onPress ? "chevron-forward" : "lock-closed"} size={12} color={tvColors.textMuted} /></>;
  return onPress
    ? <Pressable onPress={onPress} style={({ focused }: any) => [styles.sourceRow, focused && styles.focused]}>{content}</Pressable>
    : <View style={styles.sourceRow}>{content}</View>;
}
function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <Pressable onPress={() => onChange(!value)} style={({ focused }: any) => [styles.settingRow, focused && styles.focused]}><Text style={styles.settingLabel}>{label}</Text><View style={[styles.toggle, value && styles.toggleOn]}><View style={[styles.knob, value && styles.knobOn]} /></View></Pressable>;
}
function ChoiceRow<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { label: string; value: T }[]; onChange: (value: T) => void }) {
  return <View style={styles.choiceBlock}><Text style={styles.settingLabel}>{label}</Text><View style={styles.choices}>{options.map((option) => <Pressable key={String(option.value)} onPress={() => onChange(option.value)} style={({ focused }: any) => [styles.choice, option.value === value && styles.choiceActive, focused && styles.focused]}><Text style={[styles.choiceText, option.value === value && styles.choiceTextActive]}>{option.label}</Text></Pressable>)}</View></View>;
}
function Action({ label, icon, onPress, disabled }: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityState={{ busy: Boolean(disabled) }} onPress={onPress} style={({ focused }: any) => [styles.action, disabled && styles.disabled, focused && styles.focused]}><Ionicons name={icon} size={14} color="#fff" /><Text style={styles.actionText}>{label}</Text></Pressable>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 14, paddingTop: 8 },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  back: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  scrollWrap: { flex: 1 }, content: { paddingVertical: 12, gap: 10, paddingBottom: 28 },
  card: { padding: 11, gap: 7, backgroundColor: tvColors.panelRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 2 },
  cardTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10.5 },
  sourceRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, backgroundColor: tvColors.panel, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.sm },
  sourceCopy: { flex: 1, minWidth: 0 }, sourceTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  sourceSub: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, marginTop: 2 },
  sourceStatus: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 7.5, maxWidth: 150, textAlign: "right" },
  settingRow: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 9, borderWidth: 2, borderColor: "transparent", borderRadius: 5, backgroundColor: tvColors.panel },
  settingLabel: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  toggle: { width: 34, height: 19, borderRadius: 10, backgroundColor: "#343145", padding: 2 }, toggleOn: { backgroundColor: tvColors.purple },
  knob: { width: 15, height: 15, borderRadius: 8, backgroundColor: "#817D91" }, knobOn: { alignSelf: "flex-end", backgroundColor: "#fff" },
  choiceBlock: { gap: 5 }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: { minHeight: 30, justifyContent: "center", paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: tvColors.line, backgroundColor: tvColors.panel },
  choiceActive: { borderColor: tvColors.purpleSoft, backgroundColor: tvColors.purpleDeep },
  choiceText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 }, choiceTextActive: { color: "#fff" },
  help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, lineHeight: 11 },
  action: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12, backgroundColor: tvColors.purple, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  actionText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8.5 },
  infoRow: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: tvColors.line },
  infoLabel: { flex: 1, color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  infoValue: { color: "#fff", fontFamily: fonts.medium, fontSize: 8, textAlign: "right" },
  error: { color: "#FCA5A5", fontFamily: fonts.regular, fontSize: 7.5, marginTop: 4 },
  actionStatus: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8.5, textAlign: "center" },
  disabled: { opacity: 0.55 }, focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});

export default function EpgSourcesScreen() {
  return (
    <FocusedTabMount>
      <EpgSourcesScreenContent />
    </FocusedTabMount>
  );
}
