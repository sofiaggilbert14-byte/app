import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { useStore } from "@/src/store";
import { DEFAULT_CHANNEL_FOLDERS } from "@/src/core/channelFolderClassifier";
import { SMART_GROUPS } from "@/src/core/guideGroups";
import { useChannelGroupPreferences } from "@/src/core/channelGroupPreferences";
import { fonts, radius, tvColors } from "@/src/theme";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";

const PAGE_SIZE = 100;
const SYSTEM_OPTIONAL = ["Recently Watched", ...SMART_GROUPS, ...DEFAULT_CHANNEL_FOLDERS] as const;

export default function GroupSettingsScreen() {
  const router = useRouter();
  const { channels } = useStore();
  const groups = useChannelGroupPreferences();
  const [newName, setNewName] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(groups.customGroups[0]?.id || null);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);

  useTvBackHandler(useCallback(() => {
    router.replace("/settings" as any);
    return true;
  }, [router]));

  const selected = useMemo(
    () => groups.customGroups.find((group) => group.id === selectedGroupId) || null,
    [groups.customGroups, selectedGroupId],
  );
  const membership = useMemo(() => new Set(selected?.channelIds || []), [selected?.channelIds]);
  const pageCount = Math.max(1, Math.ceil(channels.length / PAGE_SIZE));
  const boundedPage = Math.min(page, pageCount - 1);
  const start = boundedPage * PAGE_SIZE;
  const rows = useMemo(() => channels.slice(start, start + PAGE_SIZE), [channels, start]);

  const selectCustom = useCallback((id: string, name: string) => {
    setSelectedGroupId(id);
    setRenameDraft(name);
    setPage(0);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  }, []);

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>CHANNEL NAVIGATION</Text>
            <Text style={styles.title}>Groups & Tabs</Text>
          </View>
          <Pressable onPress={() => router.replace("/settings" as any)} style={({ focused }: any) => [styles.back, focused && styles.focused]}>
            <Ionicons name="arrow-back" size={14} color="#fff" />
            <Text style={styles.backText}>All Settings</Text>
          </Pressable>
        </View>

        <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.body}>
          <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Card title="Provider Groups">
              <ToggleRow
                label="Show groups supplied by M3U"
                value={groups.showProviderGroups}
                onChange={groups.setShowProviderGroups}
              />
              <Text style={styles.help}>
                Off is recommended. Provider group-title values are still used as classification hints, but CharmIPTV shows one primary folder per channel instead of dozens of duplicate provider tabs.
              </Text>
            </Card>

            <Card title="CharmIPTV Folders">
              <Text style={styles.help}>Hide any automatic folder you do not want in the Groups drawer. All and Favorites remain core navigation groups.</Text>
              {SYSTEM_OPTIONAL.map((name) => {
                const visible = !groups.hiddenBuiltInGroups.includes(name);
                return <ToggleRow key={name} label={name} value={visible} onChange={(next) => groups.setBuiltInVisible(name, next)} />;
              })}
            </Card>

            <Card title="Custom Groups">
              <View style={styles.inputRow}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="New group name"
                  placeholderTextColor={tvColors.textMuted}
                  maxLength={48}
                  style={styles.input}
                  testID="group-settings-new-name"
                />
                <Pressable
                  onPress={() => {
                    const name = newName.trim();
                    if (!name) return;
                    groups.addCustomGroup(name);
                    setNewName("");
                    void Haptics.selectionAsync().catch(() => undefined);
                  }}
                  style={({ focused }: any) => [styles.action, focused && styles.focused]}
                >
                  <Text style={styles.actionText}>Add Group</Text>
                </Pressable>
              </View>

              {groups.customGroups.length ? groups.customGroups.map((group, index) => (
                <View key={group.id} style={[styles.customRow, selectedGroupId === group.id && styles.customRowSelected]}>
                  <Pressable
                    onPress={() => selectCustom(group.id, group.name)}
                    style={({ focused }: any) => [styles.customNameButton, focused && styles.focused]}
                  >
                    <Text numberOfLines={1} style={styles.settingLabel}>{group.name}</Text>
                    <Text style={styles.meta}>{group.channelIds.length} channels</Text>
                  </Pressable>
                  <Pressable onPress={() => groups.setCustomGroupVisible(group.id, !group.visible)} style={({ focused }: any) => [styles.mini, focused && styles.focused]}>
                    <Text style={styles.miniText}>{group.visible ? "Visible" : "Hidden"}</Text>
                  </Pressable>
                  <Pressable disabled={index === 0} onPress={() => groups.reorderCustomGroups(index, index - 1)} style={({ focused }: any) => [styles.mini, index === 0 && styles.disabled, focused && styles.focused]}>
                    <Text style={styles.miniText}>Up</Text>
                  </Pressable>
                  <Pressable disabled={index === groups.customGroups.length - 1} onPress={() => groups.reorderCustomGroups(index, index + 1)} style={({ focused }: any) => [styles.mini, index === groups.customGroups.length - 1 && styles.disabled, focused && styles.focused]}>
                    <Text style={styles.miniText}>Down</Text>
                  </Pressable>
                </View>
              )) : <Text style={styles.help}>No custom groups yet.</Text>}

              {selected ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.settingLabel}>Edit “{selected.name}”</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      value={renameDraft}
                      onChangeText={setRenameDraft}
                      placeholder={selected.name}
                      placeholderTextColor={tvColors.textMuted}
                      maxLength={48}
                      style={styles.input}
                    />
                    <Pressable onPress={() => groups.renameCustomGroup(selected.id, renameDraft)} style={({ focused }: any) => [styles.action, focused && styles.focused]}>
                      <Text style={styles.actionText}>Rename</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        groups.removeCustomGroup(selected.id);
                        setSelectedGroupId(null);
                        setRenameDraft("");
                      }}
                      style={({ focused }: any) => [styles.deleteAction, focused && styles.focused]}
                    >
                      <Text style={styles.actionText}>Delete</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.help}>Assign channels without duplicating stream/EPG objects. The group stores only channel IDs.</Text>
                  <View style={styles.pager}>
                    <Pressable disabled={boundedPage === 0} onPress={() => setPage((value) => Math.max(0, value - 1))} style={({ focused }: any) => [styles.action, boundedPage === 0 && styles.disabled, focused && styles.focused]}>
                      <Text style={styles.actionText}>Previous 100</Text>
                    </Pressable>
                    <Text style={styles.meta}>Page {boundedPage + 1} / {pageCount}</Text>
                    <Pressable disabled={boundedPage >= pageCount - 1} onPress={() => setPage((value) => Math.min(pageCount - 1, value + 1))} style={({ focused }: any) => [styles.action, boundedPage >= pageCount - 1 && styles.disabled, focused && styles.focused]}>
                      <Text style={styles.actionText}>Next 100</Text>
                    </Pressable>
                  </View>
                  {rows.map((channel, index) => {
                    const included = membership.has(channel.id);
                    return (
                      <Pressable
                        key={channel.id}
                        onPress={() => groups.setChannelInCustomGroup(selected.id, channel.id, !included)}
                        style={({ focused }: any) => [styles.channelRow, included && styles.channelIncluded, focused && styles.focused]}
                      >
                        <Text numberOfLines={1} style={styles.channelName}>{start + index + 1}. {channel.name}</Text>
                        <Text style={styles.meta}>{included ? "In group" : "Add"}</Text>
                      </Pressable>
                    );
                  })}
                </>
              ) : null}
            </Card>
          </ScrollView>
        </FocusGuide>
      </View>
    </PurpleTvShell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{children}</View>;
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={({ focused }: any) => [styles.settingRow, focused && styles.focused]}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.meta}>{value ? "On" : "Off"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 18, gap: 12 },
  header: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1.2 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 20 },
  back: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 2, borderColor: "transparent", borderRadius: radius.sm, paddingHorizontal: 10 },
  backText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  body: { flex: 1, minHeight: 0 },
  content: { gap: 12, paddingBottom: 28 },
  card: { backgroundColor: tvColors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: tvColors.line, padding: 12, gap: 7 },
  cardTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 12 },
  help: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5, lineHeight: 13 },
  settingRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, borderWidth: 2, borderColor: "transparent", borderRadius: radius.sm },
  settingLabel: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  meta: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  input: { flex: 1, minHeight: 36, color: "#fff", backgroundColor: tvColors.panelRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.lineStrong, paddingHorizontal: 9, fontFamily: fonts.medium, fontSize: 9 },
  action: { minHeight: 34, justifyContent: "center", borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purpleDeep, paddingHorizontal: 10 },
  deleteAction: { minHeight: 34, justifyContent: "center", borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: "#5f1f2a", paddingHorizontal: 10 },
  actionText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8 },
  customRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line, padding: 4 },
  customRowSelected: { backgroundColor: tvColors.purpleDeep },
  customNameButton: { flex: 1, minWidth: 0, minHeight: 30, justifyContent: "center", paddingHorizontal: 6, borderWidth: 2, borderColor: "transparent", borderRadius: radius.sm },
  mini: { minHeight: 30, justifyContent: "center", borderWidth: 2, borderColor: "transparent", borderRadius: radius.sm, paddingHorizontal: 7, backgroundColor: tvColors.panelRaised },
  miniText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.5 },
  disabled: { opacity: 0.35 },
  divider: { height: 1, backgroundColor: tvColors.line, marginVertical: 5 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  channelRow: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 8 },
  channelIncluded: { backgroundColor: tvColors.purpleDeep },
  channelName: { flex: 1, color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  focused: { borderColor: tvColors.purpleSoft },
});
