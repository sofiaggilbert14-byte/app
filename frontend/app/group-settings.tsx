import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { useStore } from "@/src/store";
import { useCustomGuideGroups } from "@/src/core/customGuideGroups";
import { CURATED_GROUPS, SMART_GROUPS } from "@/src/core/guideGroups";
import { useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { fonts, radius, tvColors } from "@/src/theme";

const PAGE_SIZE = 100;
const BUILT_INS = ["Favorites", ...SMART_GROUPS, ...CURATED_GROUPS] as string[];

export default function GroupSettingsScreen() {
  const router = useRouter();
  const { channels } = useStore();
  const guideUi = useGuideUiPreferences();
  const custom = useCustomGuideGroups();
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(custom.groups[0]?.id || null);
  const [renameDraft, setRenameDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const selected = custom.groups.find((group) => group.id === selectedId) || null;
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
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const toggleBuiltIn = (name: string) => {
    const hidden = new Set(guideUi.hiddenGroups);
    if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
    guideUi.setHiddenGroups(Array.from(hidden));
  };

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>PHASE 9</Text>
            <Text style={styles.title}>Guide Groups & Tabs</Text>
          </View>
          <Pressable hasTVPreferredFocus onPress={() => router.replace("/settings" as any)} style={({ focused }: any) => [styles.back, focused && styles.focused]}>
            <Ionicons name="arrow-back" size={14} color="#fff" />
            <Text style={styles.backText}>Settings</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Provider group visibility</Text>
            <Text style={styles.help}>Provider/M3U group names can stay hidden while Charm still uses their text internally to classify channels into the cleaner folders below.</Text>
            <Pressable onPress={() => guideUi.setShowProviderGroups(!guideUi.showProviderGroups)} style={({ focused }: any) => [styles.row, focused && styles.focused]}>
              <Text style={styles.rowText}>Show raw M3U/provider groups</Text>
              <Text style={styles.value}>{guideUi.showProviderGroups ? "On" : "Off"}</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Built-in tabs</Text>
            <Text style={styles.help}>Hide any built-in tab you do not want. All remains available as the safety fallback.</Text>
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
            <Text style={styles.help}>Custom groups store only channel IDs. Stream URLs, logos, and EPG rows are never duplicated.</Text>
            <View style={styles.inputRow}>
              <TextInput value={draft} onChangeText={setDraft} placeholder="New group name" placeholderTextColor={tvColors.textMuted} style={styles.input} maxLength={48} />
              <Pressable onPress={() => { if (custom.createGroup(draft)) { setDraft(""); } }} style={({ focused }: any) => [styles.action, focused && styles.focused]}>
                <Text style={styles.actionText}>Add</Text>
              </Pressable>
            </View>
            {custom.groups.map((group) => (
              <View key={group.id} style={styles.groupBlock}>
                <Pressable onPress={() => { setSelectedId(group.id); setRenameDraft(group.name); setPage(0); }} style={({ focused }: any) => [styles.row, selectedId === group.id && styles.selected, focused && styles.focused]}>
                  <Text style={styles.rowText}>{group.name}</Text>
                  <Text style={styles.value}>{group.channelIds.length}</Text>
                </Pressable>
                {selectedId === group.id ? (
                  <View style={styles.groupActions}>
                    <Pressable onPress={() => custom.moveGroup(group.id, -1)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Up</Text></Pressable>
                    <Pressable onPress={() => custom.moveGroup(group.id, 1)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Down</Text></Pressable>
                    <Pressable onPress={() => { custom.deleteGroup(group.id); setSelectedId(null); }} style={({ focused }: any) => [styles.mini, focused && styles.focused]}><Text style={styles.actionText}>Delete</Text></Pressable>
                  </View>
                ) : null}
              </View>
            ))}
          </View>

          {selected ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Edit {selected.name}</Text>
              <View style={styles.inputRow}>
                <TextInput value={renameDraft} onChangeText={setRenameDraft} placeholder={selected.name} placeholderTextColor={tvColors.textMuted} style={styles.input} maxLength={48} />
                <Pressable onPress={() => custom.renameGroup(selected.id, renameDraft)} style={({ focused }: any) => [styles.action, focused && styles.focused]}><Text style={styles.actionText}>Rename</Text></Pressable>
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
  page: { flex: 1, backgroundColor: tvColors.background, padding: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  title: { color: tvColors.text, fontFamily: fonts.bold, fontSize: 24 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.border },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 11 },
  content: { gap: 12, paddingBottom: 40 },
  card: { backgroundColor: tvColors.card, borderWidth: 1, borderColor: tvColors.border, borderRadius: radius.md, padding: 12, gap: 6 },
  cardTitle: { color: tvColors.text, fontFamily: fonts.bold, fontSize: 14 },
  help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, marginBottom: 4 },
  row: { minHeight: 40, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: "transparent", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  selected: { backgroundColor: "rgba(120,80,210,0.22)", borderColor: "rgba(168,132,245,0.24)" },
  focused: { borderColor: tvColors.purpleBright, backgroundColor: "rgba(126,84,218,0.32)" },
  rowText: { color: tvColors.text, fontFamily: fonts.medium, fontSize: 11 },
  sub: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, marginTop: 2 },
  value: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 10 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minHeight: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.border, color: tvColors.text, paddingHorizontal: 10, fontFamily: fonts.regular, fontSize: 11 },
  action: { minHeight: 38, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.border },
  actionText: { color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  groupBlock: { gap: 4 },
  groupActions: { flexDirection: "row", gap: 6, paddingLeft: 10 },
  mini: { minHeight: 32, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.border },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginVertical: 4 },
  disabled: { opacity: 0.35 },
});
