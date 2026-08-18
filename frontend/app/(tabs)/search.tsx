import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { PurpleDrawerButton } from "@/src/components/PurpleDrawerButton";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { Channel, Program } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { requestGuideJump } from "@/src/core/guideSearchJump";
import { searchNativeEpg } from "@/src/nativeEpg";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { addTvKeyListener } from "@/src/utils/tvRemote";

const KEYS = ["Q","W","E","R","T","Y","U","I","O","P","A","S","D","F","G","H","J","K","L","Z","X","C","V","B","N","M"];
const DIGITS = ["1","2","3","4","5","6","7","8","9","0"];
const SUGGESTIONS = ["News", "Sports", "Movies", "Kids", "Discovery"];

type FocusZone = "keyboard" | "results" | "header" | null;

export default function SearchScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { openDrawer } = usePurpleTvDrawer();
  const { channels, addRecent, channelLogos } = useStore();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [preferKeyFocus, setPreferKeyFocus] = useState(true);
  const [nativePrograms, setNativePrograms] = useState<{ channel: Channel; program: Program }[]>([]);
  const firstResultRef = useRef<unknown>(null);
  const firstKeyRef = useRef<unknown>(null);
  const focusResultsWhenReadyRef = useRef(false);
  const focusZoneRef = useRef<FocusZone>(null);
  const keyboardIndexRef = useRef(0);
  const isTV = Platform.OS !== "web" && Platform.isTV;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const value = debouncedQuery.trim();
    if (value.length < 2) {
      setNativePrograms([]);
      return;
    }
    void searchNativeEpg(value, 24)
      .then((rows) => {
        if (cancelled) return;
        const wanted = new Set(rows.map((row) => row.channelId).filter(Boolean));
        const byEpgId = new Map<string, Channel>();
        if (wanted.size) {
          for (const channel of channels) {
            if (channel.id && wanted.has(channel.id)) byEpgId.set(channel.id, channel);
            if (channel.tvg_id && wanted.has(channel.tvg_id)) byEpgId.set(channel.tvg_id, channel);
            if (channel.raw_tvg_id && wanted.has(channel.raw_tvg_id)) byEpgId.set(channel.raw_tvg_id, channel);
            if (byEpgId.size >= wanted.size) break;
          }
        }
        const next: { channel: Channel; program: Program }[] = [];
        for (const { channelId, program } of rows) {
          const channel = byEpgId.get(channelId);
          if (channel) next.push({ channel, program });
        }
        setNativePrograms(next);
      })
      .catch(() => { if (!cancelled) setNativePrograms([]); });
    return () => { cancelled = true; };
  }, [channels, debouncedQuery]);

  // Search is a persistent tab. Explicitly reclaim a known key on every entry;
  // returning from Guide/player must never inherit a detached Android focus node.
  useFocusEffect(
    useCallback(() => {
      focusZoneRef.current = null;
      setPreferKeyFocus(true);
      const clearPreferred = setTimeout(() => setPreferKeyFocus(false), 180);
      const cancelFocus = requestNativeFocusWithRetry(firstKeyRef.current, [0, 80, 180, 320]);
      return () => {
        clearTimeout(clearPreferred);
        cancelFocus?.();
      };
    }, []),
  );

  useEffect(() => {
    if (!isTV || !isFocused) return;
    return addTvKeyListener((key) => {
      if (key !== "LEFT") return;
      // Ten fixed-width normal keys fit each TV keyboard row. At the first
      // column, Left is a navigation-boundary action: open Drawer instead of
      // letting Android search outside the React focus tree.
      if (focusZoneRef.current === "keyboard" && keyboardIndexRef.current % 10 === 0) {
        openDrawer({ focusTop: true });
      }
    });
  }, [isFocused, isTV, openDrawer]);

  // Keep cursor in range if query is replaced (suggestions / clear).
  useEffect(() => {
    setCursor((value) => Math.max(0, Math.min(value, query.length)));
  }, [query]);

  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return { channels: [] as Channel[], programs: [] as { channel: Channel; program: Program }[] };
    // Bound channel results while scanning instead of filter(...).slice(0,18),
    // which materialized every matching channel before discarding the tail.
    const channelMatches: Channel[] = [];
    for (const channel of channels) {
      const haystack = `${channel.name || ""} ${channel.group || ""}`.toLowerCase();
      if (!haystack.includes(q)) continue;
      channelMatches.push(channel);
      if (channelMatches.length >= 18) break;
    }
    const programs: { channel: Channel; program: Program }[] = [];
    // Android programme search is native FTS. The new Guide architecture keeps
    // programme rows outside Channel objects, so walking all 6k channels looking
    // for legacy nested arrays is wasted TV-thread work. Preserve that fallback
    // only for web/non-native development.
    if (Platform.OS === "web") {
      const now = Date.now();
      for (const channel of channels) {
        const nested = channel.programs;
        if (!nested?.length) continue;
        for (const program of nested) {
          const stop = program.stop ? Date.parse(program.stop) : Date.parse(program.start);
          if (Number.isFinite(stop) && stop < now) continue;
          if ((program.title || "").toLowerCase().includes(q)) programs.push({ channel, program });
          if (programs.length >= 24) break;
        }
        if (programs.length >= 24) break;
      }
    }
    const mergedPrograms = nativePrograms.length ? nativePrograms : programs;
    return { channels: channelMatches, programs: mergedPrograms };
  }, [channels, debouncedQuery, nativePrograms]);

  useEffect(() => {
    if (!focusResultsWhenReadyRef.current || !debouncedQuery.trim()) return;
    if (!results.channels.length && !results.programs.length) return;
    focusResultsWhenReadyRef.current = false;
    return requestNativeFocusWithRetry(firstResultRef.current, [0, 80, 180, 320, 520]);
  }, [debouncedQuery, results.channels.length, results.programs.length]);

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    openFullscreenPlayer(router, channel.id);
  }, [addRecent, router]);

  const jumpToGuide = useCallback(
    (channel: Channel, opts?: { program?: Program; programStart?: string }) => {
      void Haptics.selectionAsync().catch(() => undefined);
      requestGuideJump({
        channelId: channel.id,
        // Provider/M3U groups can be hidden in Phase 9. Anchor the exact
        // channel through All so Search never targets an invisible raw group.
        group: "All",
        programStart: opts?.programStart || opts?.program?.start,
      });
      router.replace("/guide" as any);
    },
    [router],
  );

  const replaceQuery = useCallback((next: string) => {
    setQuery(next);
    setCursor(next.length);
  }, []);

  const chooseSuggestion = useCallback((next: string) => {
    focusResultsWhenReadyRef.current = true;
    replaceQuery(next);
  }, [replaceQuery]);

  const insertAtCursor = useCallback((chunk: string) => {
    setQuery((value) => {
      const at = Math.max(0, Math.min(cursor, value.length));
      return `${value.slice(0, at)}${chunk}${value.slice(at)}`;
    });
    setCursor((value) => value + chunk.length);
  }, [cursor]);

  const backspaceAtCursor = useCallback(() => {
    setQuery((value) => {
      const at = Math.max(0, Math.min(cursor, value.length));
      if (at <= 0) return value;
      return `${value.slice(0, at - 1)}${value.slice(at)}`;
    });
    setCursor((value) => Math.max(0, value - 1));
  }, [cursor]);

  const moveCursor = useCallback((delta: -1 | 1) => {
    setCursor((value) => Math.max(0, Math.min(query.length, value + delta)));
  }, [query.length]);

  const noteKeyboardFocus = useCallback((index: number) => {
    focusZoneRef.current = "keyboard";
    keyboardIndexRef.current = index;
  }, []);
  const noteResultsFocus = useCallback(() => { focusZoneRef.current = "results"; }, []);

  const before = query.slice(0, cursor);
  const after = query.slice(cursor);

  return (
    <PurpleTvShell active="/search">
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View onFocus={() => { focusZoneRef.current = "header"; }}>
              <PurpleDrawerButton testID="search-open-drawer" />
            </View>
            <View>
              <Text style={styles.kicker}>FIND CHANNELS & PROGRAMS</Text>
              <Text style={styles.title}>Search</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.keyboardPanel}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={15} color={tvColors.textMuted} />
              {isTV ? (
                <View style={styles.caretField} testID="search-input">
                  {!query ? (
                    <Text style={styles.placeholder}>Search…</Text>
                  ) : (
                    <Text numberOfLines={1} style={styles.caretText}>
                      <Text style={styles.caretText}>{before}</Text>
                      <Text style={styles.caret}>|</Text>
                      <Text style={styles.caretText}>{after}</Text>
                    </Text>
                  )}
                </View>
              ) : (
                <TextInput
                  value={query}
                  onChangeText={(value) => {
                    setQuery(value);
                    setCursor(value.length);
                  }}
                  onSelectionChange={(event) => {
                    setCursor(event.nativeEvent.selection.start);
                  }}
                  placeholder="Search…"
                  placeholderTextColor={tvColors.textMuted}
                  style={styles.input}
                  autoCorrect={false}
                  showSoftInputOnFocus
                  editable
                  focusable
                  testID="search-input"
                />
              )}
              {query ? (
                <Pressable onPress={() => replaceQuery("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={15} color={tvColors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.keys}>
              {KEYS.map((key, index) => (
                <Pressable
                  key={key}
                  ref={(node) => { if (index === 0) firstKeyRef.current = node; }}
                  hasTVPreferredFocus={preferKeyFocus && index === 0}
                  onFocus={() => noteKeyboardFocus(index)}
                  onPress={() => insertAtCursor(key)}
                  style={({ focused }: any) => [styles.key, focused && styles.focused]}
                >
                  <Text style={styles.keyText}>{key}</Text>
                </Pressable>
              ))}
              {DIGITS.map((key, index) => {
                const focusIndex = KEYS.length + index;
                return (
                  <Pressable key={key} onFocus={() => noteKeyboardFocus(focusIndex)} onPress={() => insertAtCursor(key)} style={({ focused }: any) => [styles.key, focused && styles.focused]}>
                    <Text style={styles.keyText}>{key}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onFocus={() => noteKeyboardFocus(KEYS.length + DIGITS.length)}
                onPress={() => moveCursor(-1)}
                style={({ focused }: any) => [styles.key, styles.navKey, focused && styles.focused]}
                testID="search-cursor-left"
              >
                <Ionicons name="arrow-back" size={14} color="#fff" />
              </Pressable>
              <Pressable
                onFocus={() => noteKeyboardFocus(KEYS.length + DIGITS.length + 1)}
                onPress={() => moveCursor(1)}
                style={({ focused }: any) => [styles.key, styles.navKey, focused && styles.focused]}
                testID="search-cursor-right"
              >
                <Ionicons name="arrow-forward" size={14} color="#fff" />
              </Pressable>
              <Pressable
                onFocus={() => noteKeyboardFocus(KEYS.length + DIGITS.length + 2)}
                onPress={backspaceAtCursor}
                style={({ focused }: any) => [styles.key, styles.wideKey, focused && styles.focused]}
                testID="search-backspace"
              >
                <Ionicons name="backspace-outline" size={14} color="#fff" />
              </Pressable>
              <Pressable onFocus={() => noteKeyboardFocus(KEYS.length + DIGITS.length + 3)} onPress={() => insertAtCursor(" ")} style={({ focused }: any) => [styles.key, styles.spaceKey, focused && styles.focused]}>
                <Text style={styles.keyText}>Space</Text>
              </Pressable>
              <Pressable
                onFocus={() => noteKeyboardFocus(KEYS.length + DIGITS.length + 4)}
                onPress={() => replaceQuery(query.trim())}
                style={({ focused }: any) => [styles.key, styles.searchKey, focused && styles.focused]}
              >
                <Ionicons name="search" size={15} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.resultsPanel}>
            {!debouncedQuery.trim() ? (
              <>
                <Text style={styles.resultsTitle}>Suggested</Text>
                {SUGGESTIONS.map((item) => (
                  <Pressable key={item} onFocus={noteResultsFocus} onPress={() => chooseSuggestion(item)} style={({ focused }: any) => [styles.suggestion, focused && styles.focused]}>
                    <Text style={styles.suggestionText}>{item}</Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.resultsScroll}>
                {results.channels.length ? <Text style={styles.resultsTitle}>Channels</Text> : null}
                {results.channels.map((channel, index) => (
                  <FocusGuide key={channel.id} style={styles.resultBlock} trapFocusRight>
                    <Pressable
                      ref={(node) => { if (index === 0) firstResultRef.current = node; }}
                      onFocus={noteResultsFocus}
                      onPress={() => play(channel)}
                      onLongPress={() => jumpToGuide(channel)}
                      delayLongPress={420}
                      style={({ focused }: any) => [styles.resultRow, focused && styles.focused]}
                    >
                      <ChannelLogo name={channel.name} logo={channel.logo} disabled={!isFocused || !channelLogos} size={28} />
                      <Text numberOfLines={1} style={styles.resultName}>{channel.name}</Text>
                      <Ionicons name="play" size={13} color={tvColors.purpleSoft} />
                    </Pressable>
                    <Pressable
                      onFocus={noteResultsFocus}
                      onPress={() => jumpToGuide(channel)}
                      style={({ focused }: any) => [styles.guideAction, focused && styles.focused]}
                      testID={`search-guide-${channel.id}`}
                    >
                      <Ionicons name="grid-outline" size={12} color="#fff" />
                      <Text style={styles.guideActionText}>Open in Guide</Text>
                    </Pressable>
                  </FocusGuide>
                ))}
                {results.programs.length ? <Text style={styles.resultsTitle}>Programs</Text> : null}
                {results.programs.map(({ channel, program }, index) => (
                  <FocusGuide key={`${channel.id}-${program.start}-${index}`} style={styles.resultBlock} trapFocusRight>
                    <Pressable
                      ref={(node) => { if (!results.channels.length && index === 0) firstResultRef.current = node; }}
                      onFocus={noteResultsFocus}
                      onPress={() => jumpToGuide(channel, { program, programStart: program.start })}
                      onLongPress={() => play(channel)}
                      delayLongPress={420}
                      style={({ focused }: any) => [styles.resultRow, focused && styles.focused]}
                    >
                      <ChannelLogo name={channel.name} logo={channel.logo} disabled={!isFocused || !channelLogos} size={28} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.resultName}>{program.title}</Text>
                        <Text numberOfLines={1} style={styles.resultSub}>{channel.name}</Text>
                      </View>
                      <Ionicons name="grid-outline" size={13} color={tvColors.purpleSoft} />
                    </Pressable>
                    <Pressable
                      onFocus={noteResultsFocus}
                      onPress={() => play(channel)}
                      style={({ focused }: any) => [styles.guideAction, focused && styles.focused]}
                    >
                      <Ionicons name="play" size={12} color="#fff" />
                      <Text style={styles.guideActionText}>Play</Text>
                    </Pressable>
                  </FocusGuide>
                ))}
                {!results.channels.length && !results.programs.length ? (
                  <View style={styles.noResults}>
                    <Ionicons name="search-outline" size={28} color={tvColors.purpleSoft} />
                    <Text style={styles.noResultsText}>No matches for “{debouncedQuery}”</Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14 },
  header: { minHeight: 50, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  body: { flex: 1, flexDirection: "row", gap: 16, paddingTop: 18 },
  keyboardPanel: { flex: 1.15, maxWidth: 520 },
  searchBox: { height: 42, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: tvColors.lineStrong, borderRadius: radius.sm, paddingHorizontal: 10, backgroundColor: tvColors.panel },
  input: { flex: 1, color: "#fff", fontFamily: fonts.regular, fontSize: 11, padding: 0 },
  caretField: { flex: 1, minWidth: 0, justifyContent: "center" },
  caretText: { color: "#fff", fontFamily: fonts.regular, fontSize: 11 },
  caret: { color: tvColors.purpleBright, fontFamily: fonts.bold, fontSize: 12 },
  placeholder: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 11 },
  keys: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  key: { width: 42, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  navKey: { backgroundColor: "rgba(124,58,237,0.35)" },
  wideKey: { width: 58 },
  spaceKey: { width: 110 },
  searchKey: { backgroundColor: tvColors.purple, width: 52 },
  keyText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9 },
  resultsPanel: { flex: 0.85, borderLeftWidth: 1, borderLeftColor: tvColors.line, paddingLeft: 18 },
  resultsTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10.5, marginBottom: 7, marginTop: 4 },
  suggestion: { minHeight: 31, justifyContent: "center", paddingHorizontal: 8, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  suggestionText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9 },
  resultsScroll: { paddingBottom: 20 },
  resultBlock: { marginBottom: 6, gap: 5, flexDirection: "row", alignItems: "stretch" },
  resultRow: { flex: 1, minWidth: 0, minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 6, backgroundColor: tvColors.panel },
  guideAction: {
    width: 104,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 7,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panelRaised,
  },
  guideActionText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8, textAlign: "center" },
  resultName: { flex: 1, color: "#fff", fontFamily: fonts.medium, fontSize: 9 },
  resultSub: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, marginTop: 2 },
  noResults: { alignItems: "center", gap: 8, paddingTop: 45 },
  noResultsText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
