import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { useStore } from "@/src/store";
import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";
import {
  configureNativeGuideOwnership,
  clearNativeUserGuide,
  listNativeUserGuideChannels,
  refreshNativeUserGuide,
  setNativeGuideChannelBinding,
} from "@/src/nativeEpg";
import { invalidateGuideOwnershipCaches } from "@/src/source";
import { fonts, radius, tvColors } from "@/src/theme";
import { type SourceRefreshIntervalHours, useSourceRefreshPreferences } from "@/src/core/sourceRefreshPreferences";
import { formatRelativeAge } from "@/src/utils/time";

const PLAYLIST_PAGE_SIZE = 60;
const XMLTV_PAGE_SIZE = 60;

type XmltvRow = { id: string; name: string };

function validHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

export default function CustomEpgScreen() {
  const router = useRouter();
  const { channels } = useStore();
  const prefs = useEpgSourcePreferences();
  const refreshPrefs = useSourceRefreshPreferences();
  const [nameDraft, setNameDraft] = useState(prefs.userName);
  const [urlDraft, setUrlDraft] = useState(prefs.userUrl);
  const [urlTouched, setUrlTouched] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelQuery, setChannelQuery] = useState("");
  const [channelPage, setChannelPage] = useState(0);
  const [xmltvQuery, setXmltvQuery] = useState("");
  const [xmltvPage, setXmltvPage] = useState(0);
  const [xmltvRows, setXmltvRows] = useState<XmltvRow[]>([]);
  const [xmltvTotal, setXmltvTotal] = useState(0);
  const [preferBackFocus, setPreferBackFocus] = useState(true);
  const queryGeneration = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);

  useTvBackHandler(useCallback(() => {
    router.replace("/epg-sources" as any);
    return true;
  }, [router]));

  useEffect(() => {
    if (!urlTouched) setUrlDraft(prefs.userUrl);
  }, [prefs.userUrl, urlTouched]);

  useEffect(() => setNameDraft(prefs.userName), [prefs.userName]);

  useEffect(() => {
    const topTimer = setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 0);
    const focusTimer = setTimeout(() => setPreferBackFocus(false), 180);
    return () => {
      clearTimeout(topTimer);
      clearTimeout(focusTimer);
    };
  }, []);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) || null,
    [channels, selectedChannelId],
  );

  const filteredChannels = useMemo(() => {
    const q = channelQuery.trim().toLowerCase();
    if (!q) return channels;
    const out = [];
    for (const channel of channels) {
      const haystack = `${channel.name || ""} ${channel.group || ""} ${channel.raw_tvg_id || channel.tvg_id || ""}`.toLowerCase();
      if (haystack.includes(q)) out.push(channel);
    }
    return out;
  }, [channelQuery, channels]);

  const channelPageCount = Math.max(1, Math.ceil(filteredChannels.length / PLAYLIST_PAGE_SIZE));
  const channelRows = useMemo(
    () => filteredChannels.slice(channelPage * PLAYLIST_PAGE_SIZE, channelPage * PLAYLIST_PAGE_SIZE + PLAYLIST_PAGE_SIZE),
    [channelPage, filteredChannels],
  );
  const xmltvPageCount = Math.max(1, Math.ceil(xmltvTotal / XMLTV_PAGE_SIZE));

  useEffect(() => {
    setChannelPage((current) => Math.max(0, Math.min(channelPageCount - 1, current)));
  }, [channelPageCount]);

  const reloadXmltvPage = useCallback(async () => {
    const generation = ++queryGeneration.current;
    try {
      const page = await listNativeUserGuideChannels(xmltvQuery, xmltvPage * XMLTV_PAGE_SIZE, XMLTV_PAGE_SIZE);
      if (generation !== queryGeneration.current) return;
      setXmltvRows(page.rows || []);
      setXmltvTotal(Math.max(0, Number(page.total) || 0));
    } catch (error) {
      if (generation !== queryGeneration.current) return;
      setXmltvRows([]);
      setXmltvTotal(0);
      setStatus(error instanceof Error ? error.message : "Could not read custom EPG channels.");
    }
  }, [xmltvPage, xmltvQuery]);

  useEffect(() => {
    const timer = setTimeout(() => void reloadXmltvPage(), 180);
    return () => clearTimeout(timer);
  }, [reloadXmltvPage]);

  const applyOwnership = useCallback(async (
    primaryEnabled: boolean,
    userEnabled: boolean,
    userUrl: string,
    overrides = prefs.userOverrides,
  ) => {
    await configureNativeGuideOwnership(primaryEnabled, userEnabled, userUrl, overrides);
    invalidateGuideOwnershipCaches();
  }, [prefs.userOverrides]);

  const togglePrimary = useCallback(async () => {
    if (busy) return;
    const next = !prefs.primaryEnabled;
    setBusy(true);
    try {
      await applyOwnership(next, prefs.userEnabled, prefs.userUrl);
      prefs.setPrimaryEnabled(next);
      setStatus(next ? "Charm built-in EPG enabled." : "Charm built-in EPG disabled. It will no longer be queried or refreshed while off.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not change built-in EPG state.");
    } finally {
      setBusy(false);
    }
  }, [applyOwnership, busy, prefs]);

  const toggleUser = useCallback(async () => {
    if (busy) return;
    const next = !prefs.userEnabled;
    if (next && !validHttpUrl(prefs.userUrl || urlDraft)) {
      setStatus("Enter and save a valid http:// or https:// XMLTV URL first.");
      return;
    }
    const url = (prefs.userUrl || urlDraft).trim();
    setBusy(true);
    try {
      await applyOwnership(prefs.primaryEnabled, next, url);
      prefs.setUserEnabled(next);
      setStatus(next ? "Custom EPG enabled." : "Custom EPG disabled. Its database remains saved but is no longer queried.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not change custom EPG state.");
    } finally {
      setBusy(false);
    }
  }, [applyOwnership, busy, prefs, urlDraft]);

  const saveUrl = useCallback(async () => {
    if (busy) return;
    const url = urlDraft.trim();
    if (!validHttpUrl(url)) {
      setStatus("Enter a valid http:// or https:// XMLTV URL.");
      return;
    }
    setBusy(true);
    try {
      await applyOwnership(prefs.primaryEnabled, prefs.userEnabled, url);
      prefs.setUserName(nameDraft);
      prefs.setUserUrl(url);
      setUrlTouched(false);
      setStatus(`${nameDraft.trim() || "Custom EPG"} saved.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save custom EPG URL.");
    } finally {
      setBusy(false);
    }
  }, [applyOwnership, busy, nameDraft, prefs, urlDraft]);

  const refreshUserGuide = useCallback(async () => {
    if (busy) return;
    const url = (urlDraft || prefs.userUrl).trim();
    if (!validHttpUrl(url)) {
      setStatus("Enter a valid custom XMLTV URL before refreshing.");
      return;
    }
    setBusy(true);
    setStatus("Downloading and indexing custom XMLTV…");
    try {
      await configureNativeGuideOwnership(prefs.primaryEnabled, true, url, prefs.userOverrides);
      prefs.setUserUrl(url);
      if (!prefs.userEnabled) prefs.setUserEnabled(true);
      const result = await refreshNativeUserGuide(url);
      invalidateGuideOwnershipCaches();
      setXmltvPage(0);
      const firstPage = await listNativeUserGuideChannels(xmltvQuery, 0, XMLTV_PAGE_SIZE);
      setXmltvRows(firstPage.rows || []);
      setXmltvTotal(Math.max(0, Number(firstPage.total) || 0));
      const programmeCount = Math.max(0, Math.round(result.count || 0));
      const message = result.programmeSwapSucceeded === false
        ? `Custom EPG returned no usable new programme data. Keeping the previous guide (${programmeCount} programmes).`
        : `Custom EPG indexed ${programmeCount} programmes.`;
      if (result.programmeSwapSucceeded !== false) prefs.setUserRefreshStatus(Date.now(), message);
      setStatus(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Custom EPG refresh failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, prefs, urlDraft, xmltvQuery]);

  const clearUserGuide = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearNativeUserGuide();
      invalidateGuideOwnershipCaches();
      setXmltvRows([]);
      setXmltvTotal(0);
      prefs.setUserRefreshStatus(0, "EPG data cleared");
      setStatus("Custom EPG programme data cleared. The saved source, URL, and channel assignments were kept.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear custom EPG data.");
    } finally {
      setBusy(false);
    }
  }, [busy, prefs]);

  const assign = useCallback(async (xmltvId: string) => {
    const channel = selectedChannel;
    if (!channel || busy) return;
    setBusy(true);
    try {
      await setNativeGuideChannelBinding(channel.id, xmltvId);
      prefs.setUserOverride(channel.id, xmltvId);
      invalidateGuideOwnershipCaches();
      void Haptics.selectionAsync().catch(() => undefined);
      setStatus(`${channel.name} now uses custom EPG channel ${xmltvId}. Guide data will update without blocking navigation.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not assign custom EPG channel.");
    } finally {
      setBusy(false);
    }
  }, [busy, prefs, selectedChannel]);

  const clearAssignment = useCallback(async () => {
    const channel = selectedChannel;
    if (!channel || busy) return;
    setBusy(true);
    try {
      await setNativeGuideChannelBinding(channel.id, null);
      prefs.setUserOverride(channel.id, null);
      invalidateGuideOwnershipCaches();
      setStatus(
        prefs.primaryEnabled
          ? `${channel.name} returned to Charm EPG matching.`
          : `${channel.name} has no EPG source while Charm EPG is disabled.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear custom EPG assignment.");
    } finally {
      setBusy(false);
    }
  }, [busy, prefs, selectedChannel]);

  const quickTvgId = selectedChannel?.raw_tvg_id || selectedChannel?.tvg_id || "";
  const currentOverride = selectedChannel ? prefs.userOverrides[selectedChannel.id] || "" : "";

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>PHASE 9 · GUIDE SOURCES</Text>
            <Text style={styles.title}>{prefs.userName}</Text>
          </View>
          <Pressable hasTVPreferredFocus={preferBackFocus} onFocus={() => setPreferBackFocus(false)} onPress={() => router.replace("/epg-sources" as any)} style={({ focused }: any) => [styles.back, focused && styles.focused]}>
            <Ionicons name="arrow-back" size={14} color="#fff" />
            <Text style={styles.backText}>EPG Settings</Text>
          </Pressable>
        </View>

        <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.scrollWrap}>
          <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} scrollEnabled nestedScrollEnabled contentInsetAdjustmentBehavior="never">
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Guide ownership</Text>
              <Text style={styles.help}>Each playlist channel resolves to one Guide owner. A custom assignment overrides Charm EPG for that channel; the primary source is not queried for an overridden channel.</Text>
              <Pressable onPress={togglePrimary} style={({ focused }: any) => [styles.row, focused && styles.focused]}>
                <Text style={styles.rowText}>Charm built-in EPG</Text><Text style={styles.value}>{prefs.primaryEnabled ? "On" : "Off"}</Text>
              </Pressable>
              <Pressable onPress={toggleUser} style={({ focused }: any) => [styles.row, focused && styles.focused]}>
                <Text style={styles.rowText}>Custom EPG</Text><Text style={styles.value}>{prefs.userEnabled ? "On" : "Off"}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Saved EPG source · Custom XMLTV URL</Text>
              <Text style={styles.help}>This source remains saved when disabled. Open it here at any time to change its URL, refresh it, or manage channel assignments.</Text>
              <TextInput value={nameDraft} onChangeText={setNameDraft} placeholder="EPG source name" placeholderTextColor={tvColors.textMuted} maxLength={60} style={styles.input} />
              <TextInput value={urlDraft} onChangeText={(value) => { setUrlTouched(true); setUrlDraft(value); }} placeholder="http://server/path/guide.xml or .xml.gz" placeholderTextColor={tvColors.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
              <View style={styles.actions}>
                <Pressable disabled={busy} onPress={saveUrl} style={({ focused }: any) => [styles.action, busy && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Save name & URL</Text></Pressable>
                <Pressable disabled={busy} onPress={refreshUserGuide} style={({ focused }: any) => [styles.action, busy && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>{busy ? "Working…" : "Refresh Custom EPG"}</Text></Pressable>
                <Pressable disabled={busy} onPress={clearUserGuide} style={({ focused }: any) => [styles.action, busy && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Clear EPG data</Text></Pressable>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Update & retention settings</Text>
              <Text style={styles.help}>These controls use the same single background refresh owner as the provided guide, so custom and provided EPG updates cannot overlap or fight for SQLite/RAM.</Text>
              <CycleSetting<SourceRefreshIntervalHours> label="Update interval" value={refreshPrefs.epgHours} values={[0, 2, 4, 6, 12, 24]} format={(value) => value === 0 ? "Manual only" : `${value} hours`} onChange={refreshPrefs.setEpgHours} />
              <CycleSetting<1 | 3 | 7 | 14> label="Past days to keep EPG" value={refreshPrefs.epgPastDays} values={[1, 3, 7, 14]} format={(value) => `${value} day${value === 1 ? "" : "s"}`} onChange={refreshPrefs.setEpgPastDays} />
              <Pressable onPress={() => refreshPrefs.setUpdateEpgOnAppStart(!refreshPrefs.updateEpgOnAppStart)} style={({ focused }: any) => [styles.row, focused && styles.focused]}><Text style={styles.rowText}>Update on app start</Text><Text style={styles.value}>{refreshPrefs.updateEpgOnAppStart ? "On" : "Off"}</Text></Pressable>
              <Pressable onPress={() => refreshPrefs.setUpdateEpgOnPlaylistChange(!refreshPrefs.updateEpgOnPlaylistChange)} style={({ focused }: any) => [styles.row, focused && styles.focused]}><Text style={styles.rowText}>Update on playlist change</Text><Text style={styles.value}>{refreshPrefs.updateEpgOnPlaylistChange ? "On" : "Off"}</Text></Pressable>
              <Text style={styles.help}>Latest update: {prefs.userLastRefreshAt ? formatRelativeAge(prefs.userLastRefreshAt) : "Never"}</Text>
              <Text style={styles.help}>Status: {prefs.userLastStatus}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>1 · Choose playlist channel</Text>
              <TextInput value={channelQuery} onChangeText={(value) => { setChannelQuery(value); setChannelPage(0); }} placeholder="Search playlist channels" placeholderTextColor={tvColors.textMuted} style={styles.input} />
              <View style={styles.pager}>
                <Pressable disabled={channelPage <= 0} onPress={() => setChannelPage((value) => Math.max(0, value - 1))} style={({ focused }: any) => [styles.small, channelPage <= 0 && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Previous</Text></Pressable>
                <Text style={styles.value}>Page {channelPage + 1}/{channelPageCount} · {filteredChannels.length}</Text>
                <Pressable disabled={channelPage + 1 >= channelPageCount} onPress={() => setChannelPage((value) => Math.min(channelPageCount - 1, value + 1))} style={({ focused }: any) => [styles.small, channelPage + 1 >= channelPageCount && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Next</Text></Pressable>
              </View>
              {channelRows.map((channel) => {
                const selected = channel.id === selectedChannelId;
                const mapped = prefs.userOverrides[channel.id];
                return (
                  <Pressable key={channel.id} onPress={() => setSelectedChannelId(channel.id)} style={({ focused }: any) => [styles.row, selected && styles.selected, focused && styles.focused]}>
                    <View style={styles.flex}><Text numberOfLines={1} style={styles.rowText}>{channel.name}</Text><Text numberOfLines={1} style={styles.sub}>{channel.group || "Live TV"}</Text></View>
                    <Text numberOfLines={1} style={styles.value}>{mapped ? `Custom · ${mapped}` : prefs.primaryEnabled ? "Charm EPG" : "No EPG"}</Text>
                  </Pressable>
                );
              })}
            </View>

            {selectedChannel ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>2 · Assign XMLTV channel to {selectedChannel.name}</Text>
                <Text style={styles.help}>Current owner: {currentOverride ? `Custom EPG · ${currentOverride}` : prefs.primaryEnabled ? "Charm EPG" : "No EPG"}</Text>
                <View style={styles.actions}>
                  {quickTvgId ? <Pressable disabled={busy} onPress={() => void assign(quickTvgId)} style={({ focused }: any) => [styles.action, focused && styles.focused]}><Text style={styles.actionText}>Try playlist tvg-id: {quickTvgId}</Text></Pressable> : null}
                  <Pressable disabled={!currentOverride || busy} onPress={clearAssignment} style={({ focused }: any) => [styles.action, (!currentOverride || busy) && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Clear Override</Text></Pressable>
                </View>
                <TextInput value={xmltvQuery} onChangeText={(value) => { setXmltvQuery(value); setXmltvPage(0); }} placeholder="Search custom XMLTV channels" placeholderTextColor={tvColors.textMuted} style={styles.input} />
                <View style={styles.pager}>
                  <Pressable disabled={xmltvPage <= 0} onPress={() => setXmltvPage((value) => Math.max(0, value - 1))} style={({ focused }: any) => [styles.small, xmltvPage <= 0 && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Previous</Text></Pressable>
                  <Text style={styles.value}>Page {xmltvPage + 1}/{xmltvPageCount} · {xmltvTotal} XMLTV channels</Text>
                  <Pressable disabled={xmltvPage + 1 >= xmltvPageCount} onPress={() => setXmltvPage((value) => Math.min(xmltvPageCount - 1, value + 1))} style={({ focused }: any) => [styles.small, xmltvPage + 1 >= xmltvPageCount && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Next</Text></Pressable>
                </View>
                {xmltvRows.map((row) => (
                  <Pressable key={row.id} disabled={busy} onPress={() => void assign(row.id)} style={({ focused }: any) => [styles.row, currentOverride === row.id && styles.selected, focused && styles.focused]}>
                    <View style={styles.flex}><Text numberOfLines={1} style={styles.rowText}>{row.name || row.id}</Text><Text numberOfLines={1} style={styles.sub}>{row.id}</Text></View>
                    <Text style={styles.value}>{currentOverride === row.id ? "Assigned" : "Assign"}</Text>
                  </Pressable>
                ))}
                {!xmltvRows.length ? <Text style={styles.help}>Refresh the custom EPG first, or change the XMLTV search.</Text> : null}
              </View>
            ) : null}

            {status ? <Text style={styles.status}>{status}</Text> : null}
          </ScrollView>
        </FocusGuide>
      </View>
    </PurpleTvShell>
  );
}

function CycleSetting<T extends string | number>({ label, value, values, format, onChange }: { label: string; value: T; values: readonly T[]; format: (value: T) => string; onChange: (value: T) => void }) {
  const cycle = () => {
    const index = Math.max(0, values.indexOf(value));
    onChange(values[(index + 1) % values.length] ?? values[0]);
  };
  return <Pressable onPress={cycle} style={({ focused }: any) => [styles.row, focused && styles.focused]}><Text style={styles.rowText}>{label}</Text><Text style={styles.value}>{format(value)}</Text></Pressable>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: tvColors.canvas, padding: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.1 },
  title: { color: tvColors.text, fontFamily: fonts.bold, fontSize: 22, marginTop: 2 },
  back: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  scrollWrap: { flex: 1 },
  content: { gap: 12, paddingBottom: 50 },
  card: { backgroundColor: tvColors.panel, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.md, padding: 12, gap: 6 },
  cardTitle: { color: tvColors.text, fontFamily: fonts.bold, fontSize: 14 },
  help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15 },
  row: { minHeight: 42, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: "transparent", flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { color: tvColors.text, fontFamily: fonts.medium, fontSize: 10.5 },
  sub: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, marginTop: 2 },
  value: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 9.5, maxWidth: 260 },
  flex: { flex: 1, minWidth: 0 },
  selected: { backgroundColor: "rgba(120,80,210,0.22)", borderColor: "rgba(168,132,245,0.30)" },
  focused: { borderColor: tvColors.purpleBright, backgroundColor: "rgba(126,84,218,0.32)" },
  input: { minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line, color: tvColors.text, paddingHorizontal: 10, fontFamily: fonts.regular, fontSize: 10.5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  action: { minHeight: 36, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line },
  small: { minHeight: 32, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line },
  actionText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginVertical: 3 },
  disabled: { opacity: 0.35 },
  status: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 10.5, paddingHorizontal: 3 },
});
