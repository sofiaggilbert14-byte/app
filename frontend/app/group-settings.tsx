import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { useStore } from "@/src/store";
import { useCustomGuideGroups } from "@/src/core/customGuideGroups";
import { CURATED_GROUPS, SMART_GROUPS } from "@/src/core/guideGroups";
import { GUIDE_START_LAST_USED, useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { applyGuideGroupOrder, getGuideGroupDisplayName } from "@/src/core/guideGroupTabPreferences";
import { useGuideGroupTabPreferences } from "@/src/core/guideGroupTabPersistence";
import { fonts, radius, tvColors } from "@/src/theme";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";

const PAGE_SIZE = 100;
const BUILT_INS = ["Favorites", ...SMART_GROUPS, ...CURATED_GROUPS] as string[];
const BUILT_IN_SET = new Set(["All", ...BUILT_INS]);

function cleanGroupName(raw: string): string {
  return String(raw || "").replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
}

export default function GroupSettingsScreen() {
  const router = useRouter();
  const { channels } = useStore();
  const guideUi = useGuideUiPreferences();
  const tabPrefs = useGuideGroupTabPreferences();
  const custom = useCustomGuideGroups();
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(custom.groups[0]?.id || null);
  const [renameDraft, setRenameDraft] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerRenameDraft, setProviderRenameDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [preferBackFocus, setPreferBackFocus] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setPreferBackFocus(false), 180);
    return () => clearTimeout(timer);
  }, []);

  const returnToSettings = useCallback(() => {
    router.replace("/settings" as any);
  }, [router]);

  useTvBackHandler(useCallback(() => {
    returnToSettings();
    return true;
  }, [returnToSettings]));

  const selected = custom.groups.find((group) => group.id === selectedId) || null;
  useEffect(() => {
    if (selectedId && !custom.groups.some((group) => group.id === selectedId)) {
      setSelectedId(custom.groups[0]?.id || null);
      setPage(0);
    }
  }, [custom.groups, selectedId]);

  const providerGroups = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const channel of channels) {
      const raw = String(channel.group || "").trim();
      if (!raw || BUILT_IN_SET.has(raw) || seen.has(raw)) continue;
      seen.add(raw);
      out.push(raw);
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [channels]);

  const orderedProviderGroups = useMemo(
    () => applyGuideGroupOrder(providerGroups, tabPrefs.order),
    [providerGroups, tabPrefs.order],
  );

  const groupNameCollides = useCallback((rawName: string, options?: { customId?: string; providerId?: string }) => {
    const name = cleanGroupName(rawName);
    if (!name) return true;
    const key = name.toLocaleLowerCase();
    if (["All", ...BUILT_INS].some((item) => item.toLocaleLowerCase() === key)) return true;
    if (providerGroups.some((id) => id !== options?.providerId && id.toLocaleLowerCase() === key)) return true;
    if (custom.groups.some((group) => group.id !== options?.customId && group.name.toLocaleLowerCase() === key)) return true;
    return Object.entries(tabPrefs.aliases).some(
      ([id, label]) => id !== options?.providerId && label.toLocaleLowerCase() === key,
    );
  }, [custom.groups, providerGroups, tabPrefs.aliases]);

  const memberSet = useMemo(() => new Set(selected?.channelIds || []), [selected?.channelIds]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    const out = [];
    for (const channel of channels) {
      const text = `${channel.name || ""} ${channel.group || ""} ${channel.tvg_id || ""}`.toLowerCase();
      if (text.includes(q)) out.push(channel);
    }
    return out;
  }, [channels, query]);
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  useEffect(() => {
    setPage((current) => Math.max(0, Math.min(maxPage, current)));
  }, [maxPage]);
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const toggleBuiltIn = (name: string) => {
    const hidden = new Set(guideUi.hiddenGroups);
    if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
    guideUi.setHiddenGroups(Array.from(hidden));
  };

  const toggleCustomVisible = (name: string) => {
    const hidden = new Set(guideUi.hiddenGroups);
    if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
    guideUi.setHiddenGroups(Array.from(hidden));
  };

  const createCustomGroup = useCallback(() => {
    const name = cleanGroupName(draft);
    if (!name || groupNameCollides(name)) return;
    if (custom.createGroup(name)) setDraft("");
  }, [custom, draft, groupNameCollides]);

  const renameSelectedGroup = useCallback(() => {
    if (!selected) return;
    const oldName = selected.name;
    const nextName = cleanGroupName(renameDraft);
    if (!nextName || groupNameCollides(nextName, { customId: selected.id }) || !custom.renameGroup(selected.id, nextName)) return;
    if (guideUi.startGroup === oldName) guideUi.setStartGroup(nextName);
    if (guideUi.pinnedGroups.includes(oldName)) {
      guideUi.setPinnedGroups(guideUi.pinnedGroups.map((name) => name === oldName ? nextName : name));
    }
    if (guideUi.hiddenGroups.includes(oldName)) {
      guideUi.setHiddenGroups(guideUi.hiddenGroups.map((name) => name === oldName ? nextName : name));
    }
    setRenameDraft(nextName);
  }, [custom, groupNameCollides, guideUi, renameDraft, selected]);

  const deleteSelectedGroup = useCallback((groupId: string, groupName: string) => {
    custom.deleteGroup(groupId);
    if (guideUi.startGroup === groupName) guideUi.setStartGroup(GUIDE_START_LAST_USED);
    if (guideUi.pinnedGroups.includes(groupName)) {
      guideUi.setPinnedGroups(guideUi.pinnedGroups.filter((name) => name !== groupName));
    }
    if (guideUi.hiddenGroups.includes(groupName)) {
      guideUi.setHiddenGroups(guideUi.hiddenGroups.filter((name) => name !== groupName));
    }
    setSelectedId(null);
    setPage(0);
  }, [custom, guideUi]);

  const commitProviderRename = useCallback(() => {
    if (!selectedProvider) return;
    const next = cleanGroupName(providerRenameDraft);
    if (!next || groupNameCollides(next, { providerId: selectedProvider })) return;
    if (tabPrefs.rename(selectedProvider, next)) setProviderRenameDraft(next);
  }, [groupNameCollides, providerRenameDraft, selectedProvider, tabPrefs]);

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>PHASE 9</Text>
            <Text style={styles.title}>Guide Groups & Tabs</Text>
          </View>
          <Pressable hasTVPreferredFocus={preferBackFocus} onFocus={() => setPreferBackFocus(false)} onPress={returnToSettings} style={({ focused }: any) => [styles.back, focused && styles.focused]}>
            <Ionicons name="arrow-back" size={14} color="#fff" />
            <Text style={styles.backText}>Settings</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Provider group tabs</Text>
            <Text style={styles.help}>TiViMate-style metadata: provider names stay untouched for playlist matching while your display name, visibility, and order are saved separately.</Text>
            <Pressable onPress={() => guideUi.setShowProviderGroups(!guideUi.showProviderGroups)} style={({ focused }: any) => [styles.row, focused && styles.focused]}>
              <Text style={styles.rowText}>Show provider groups in Guide</Text>
              <Text style={styles.value}>{guideUi.showProviderGroups ? "On" : "Off"}</Text>
            </Pressable>
            {orderedProviderGroups.map((groupId) => {
              const visible = !tabPrefs.hiddenSet.has(groupId);
              const display = getGuideGroupDisplayName(groupId, tabPrefs.aliases);
              const selectedProviderRow = selectedProvider === groupId;
              return (
                <View key={groupId} style={styles.groupBlock}>
                  <Pressable onPress={() => { setSelectedProvider(groupId); setProviderRenameDraft(display); }} style={({ focused }: any) => [styles.row, selectedProviderRow && styles.selected, focused && styles.focused]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowText}>{display}</Text>
                      {display !== groupId ? <Text style={styles.sub}>Provider: {groupId}</Text> : null}
                    </View>
                    <Text style={styles.value}>{visible ? "Visible" : "Hidden"}</Text>
                  </Pressable>
                  {selectedProviderRow ? (
                    <View style={styles.providerEdit}>
                      <View style={styles.inputRow}>
                        <TextInput value={providerRenameDraft} onChangeText={setProviderRenameDraft} placeholder={groupId} placeholderTextColor={tvColors.textMuted} style={styles.input} maxLength={48} />
                        <Pressable onPress={commitProviderRename} style={({ focused }: any) => [styles.action, focused && styles.focused]}><Text style={styles.actionText}>Rename</Text></Pressable>
                      </View>
                      <View style={styles.groupActions}>
                        <Pressable onPress={() => tabPrefs.move(groupId, -1, providerGroups)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Up</Text></Pressable>
                        <Pressable onPress={() => tabPrefs.move(groupId, 1, providerGroups)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Down</Text></Pressable>
                        <Pressable onPress={() => tabPrefs.setVisible(groupId, !visible)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>{visible ? "Hide" : "Show"}</Text></Pressable>
                        <Pressable onPress={() => tabPrefs.rename(groupId, groupId)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Reset name</Text></Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Built-in tabs</Text>
            <Text style={styles.help}>Hide any built-in tab you do not want. All remains the permanent safety fallback.</Text>
            {BUILT_INS.map((name) => {
              const visible = !guideUi.hiddenGroups.includes(name);
              return (
                <Pressable key={name} onPress={() => toggleBuiltIn(name)} style={({ focused }: any) => [styles.row, focused && styles.focused]}>
                  <Text style={styles.rowText}>{name}</Text>
                  <Text style={styles.value}>{visible ? "Visible" : "Hidden"}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Custom tabs</Text>
            <Text style={styles.help}>Custom groups store channel IDs only. Rename, visibility, and position are user-owned; stream URLs, logos, and EPG rows stay in the provider/native stores.</Text>
            <View style={styles.inputRow}>
              <TextInput value={draft} onChangeText={setDraft} placeholder="New group name" placeholderTextColor={tvColors.textMuted} style={styles.input} maxLength={48} />
              <Pressable onPress={createCustomGroup} style={({ focused }: any) => [styles.action, focused && styles.focused]}>
                <Text style={styles.actionText}>Add</Text>
              </Pressable>
            </View>
            {custom.groups.map((group) => {
              const visible = !guideUi.hiddenGroups.includes(group.name);
              return (
                <View key={group.id} style={styles.groupBlock}>
                  <Pressable onPress={() => { setSelectedId(group.id); setRenameDraft(group.name); setPage(0); }} style={({ focused }: any) => [styles.row, selectedId === group.id && styles.selected, focused && styles.focused]}>
                    <Text style={styles.rowText}>{group.name}</Text>
                    <Text style={styles.value}>{visible ? `${group.channelIds.length} · Visible` : `${group.channelIds.length} · Hidden`}</Text>
                  </Pressable>
                  {selectedId === group.id ? (
                    <View style={styles.groupActions}>
                      <Pressable onPress={() => custom.moveGroup(group.id, -1)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Up</Text></Pressable>
                      <Pressable onPress={() => custom.moveGroup(group.id, 1)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Down</Text></Pressable>
                      <Pressable onPress={() => toggleCustomVisible(group.name)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>{visible ? "Hide" : "Show"}</Text></Pressable>
                      <Pressable onPress={() => deleteSelectedGroup(group.id, group.name)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Delete</Text></Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {selected ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Edit {selected.name}</Text>
              <View style={styles.inputRow}>
                <TextInput value={renameDraft} onChangeText={setRenameDraft} placeholder={selected.name} placeholderTextColor={tvColors.textMuted} style={styles.input} maxLength={48} />
                <Pressable onPress={renameSelectedGroup} style={({ focused }: any) => [styles.action, focused && styles.focused]}><Text style={styles.actionText}>Rename</Text></Pressable>
              </View>
              <TextInput value={query} onChangeText={(value) => { setQuery(value); setPage(0); }} placeholder="Search channels" placeholderTextColor={tvColors.textMuted} style={styles.input} />
              <View style={styles.pager}>
                <Pressable disabled={page <= 0} onPress={() => setPage((value) => Math.max(0, value - 1))} style={({ focused }: any) => [styles.mini, page <= 0 && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Previous 100</Text></Pressable>
                <Text style={styles.value}>Page {page + 1} / {maxPage + 1} · {filtered.length} channels</Text>
                <Pressable disabled={page >= maxPage} onPress={() => setPage((value) => Math.min(maxPage, value + 1))} style={({ focused }: any) => [styles.mini, page >= maxPage && styles.disabled, focused && styles.focused]}><Text style={styles.actionText}>Next 100</Text></Pressable>
              </View>
              {pageRows.map((channel) => {
                const included = memberSet.has(channel.id);
                return (
                  <Pressable key={channel.id} onPress={() => custom.setChannelMembership(selected.id, channel.id, !included)} style={({ focused }: any) => [styles.row, included && styles.selected, focused && styles.focused]}>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.rowText}>{channel.name}</Text>
                      <Text numberOfLines={1} style={styles.sub}>{channel.group || "Unsorted provider group"}</Text>
                    </View>
                    <Text style={styles.value}>{included ? "Added" : "Add"}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: tvColors.canvas, padding: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  title: { color: tvColors.text, fontFamily: fonts.bold, fontSize: 24 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 11 },
  content: { gap: 12, paddingBottom: 40 },
  card: { backgroundColor: tvColors.panel, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.md, padding: 12, gap: 6 },
  cardTitle: { color: tvColors.text, fontFamily: fonts.bold, fontSize: 14 },
  help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, marginBottom: 4 },
  row: { minHeight: 40, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: "transparent", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  selected: { backgroundColor: "rgba(120,80,210,0.22)", borderColor: "rgba(168,132,245,0.24)" },
  focused: { borderColor: tvColors.purpleBright, backgroundColor: "rgba(126,84,218,0.32)" },
  rowText: { color: tvColors.text, fontFamily: fonts.medium, fontSize: 11 },
  sub: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, marginTop: 2 },
  value: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 10 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minHeight: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line, color: tvColors.text, paddingHorizontal: 10, fontFamily: fonts.regular, fontSize: 11 },
  action: { minHeight: 38, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line },
  actionText: { color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  groupBlock: { gap: 4 },
  providerEdit: { gap: 6, paddingHorizontal: 10, paddingBottom: 4 },
  groupActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 10 },
  mini: { minHeight: 32, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginVertical: 4 },
  disabled: { opacity: 0.35 },
});