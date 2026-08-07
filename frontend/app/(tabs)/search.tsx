import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel, Program } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";

const KEYS = ["Q","W","E","R","T","Y","U","I","O","P","A","S","D","F","G","H","J","K","L","Z","X","C","V","B","N","M"];
const DIGITS = ["1","2","3","4","5","6","7","8","9","0"];
const SUGGESTIONS = ["News", "Sports", "Movies", "Kids", "Discovery"];

export default function SearchScreen() {
  const router = useRouter();
  const { channels, addRecent, openProgram, channelLogos } = useStore();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [preferKeyFocus, setPreferKeyFocus] = useState(true);
  const isTV = Platform.OS !== "web" && Platform.isTV;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!preferKeyFocus) return;
    const timer = setTimeout(() => setPreferKeyFocus(false), 700);
    return () => clearTimeout(timer);
  }, [preferKeyFocus]);

  // Keep cursor in range if query is replaced (suggestions / clear).
  useEffect(() => {
    setCursor((value) => Math.max(0, Math.min(value, query.length)));
  }, [query]);

  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return { channels: [] as Channel[], programs: [] as { channel: Channel; program: Program }[] };
    const channelMatches = channels
      .filter((channel) => {
        const haystack = `${channel.name || ""} ${channel.group || ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 18);
    const programs: { channel: Channel; program: Program }[] = [];
    const now = Date.now();
    for (const channel of channels) {
      for (const program of channel.programs || []) {
        const stop = program.stop ? Date.parse(program.stop) : Date.parse(program.start);
        if (Number.isFinite(stop) && stop < now) continue;
        if ((program.title || "").toLowerCase().includes(q)) programs.push({ channel, program });
        if (programs.length >= 24) break;
      }
      if (programs.length >= 24) break;
    }
    return { channels: channelMatches, programs };
  }, [channels, debouncedQuery]);

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    openFullscreenPlayer(router, channel.id);
  }, [addRecent, router]);

  const replaceQuery = useCallback((next: string) => {
    setQuery(next);
    setCursor(next.length);
  }, []);

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

  const before = query.slice(0, cursor);
  const after = query.slice(cursor);

  return (
    <PurpleTvShell active="/search">
      <View style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.kicker}>FIND CHANNELS & PROGRAMS</Text>
          <Text style={styles.title}>Search</Text>
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
                  hasTVPreferredFocus={preferKeyFocus && index === 0}
                  onPress={() => insertAtCursor(key)}
                  style={({ focused }: any) => [styles.key, focused && styles.focused]}
                >
                  <Text style={styles.keyText}>{key}</Text>
                </Pressable>
              ))}
              {DIGITS.map((key) => (
                <Pressable key={key} onPress={() => insertAtCursor(key)} style={({ focused }: any) => [styles.key, focused && styles.focused]}>
                  <Text style={styles.keyText}>{key}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => moveCursor(-1)}
                style={({ focused }: any) => [styles.key, styles.navKey, focused && styles.focused]}
                testID="search-cursor-left"
              >
                <Ionicons name="arrow-back" size={14} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => moveCursor(1)}
                style={({ focused }: any) => [styles.key, styles.navKey, focused && styles.focused]}
                testID="search-cursor-right"
              >
                <Ionicons name="arrow-forward" size={14} color="#fff" />
              </Pressable>
              <Pressable
                onPress={backspaceAtCursor}
                style={({ focused }: any) => [styles.key, styles.wideKey, focused && styles.focused]}
                testID="search-backspace"
              >
                <Ionicons name="backspace-outline" size={14} color="#fff" />
              </Pressable>
              <Pressable onPress={() => insertAtCursor(" ")} style={({ focused }: any) => [styles.key, styles.spaceKey, focused && styles.focused]}>
                <Text style={styles.keyText}>Space</Text>
              </Pressable>
              <Pressable
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
                  <Pressable key={item} onPress={() => replaceQuery(item)} style={({ focused }: any) => [styles.suggestion, focused && styles.focused]}>
                    <Text style={styles.suggestionText}>{item}</Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.resultsScroll}>
                {results.channels.length ? <Text style={styles.resultsTitle}>Channels</Text> : null}
                {results.channels.map((channel) => (
                  <Pressable key={channel.id} onPress={() => play(channel)} style={({ focused }: any) => [styles.resultRow, focused && styles.focused]}>
                    <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={28} />
                    <Text numberOfLines={1} style={styles.resultName}>{channel.name}</Text>
                    <Ionicons name="play" size={13} color={tvColors.purpleSoft} />
                  </Pressable>
                ))}
                {results.programs.length ? <Text style={styles.resultsTitle}>Programs</Text> : null}
                {results.programs.map(({ channel, program }, index) => (
                  <Pressable key={`${channel.id}-${program.start}-${index}`} onPress={() => openProgram(program, channel)} style={({ focused }: any) => [styles.resultRow, focused && styles.focused]}>
                    <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={28} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.resultName}>{program.title}</Text>
                      <Text numberOfLines={1} style={styles.resultSub}>{channel.name}</Text>
                    </View>
                  </Pressable>
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
  resultRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 6, marginBottom: 3, backgroundColor: tvColors.panel },
  resultName: { flex: 1, color: "#fff", fontFamily: fonts.medium, fontSize: 9 },
  resultSub: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, marginTop: 2 },
  noResults: { alignItems: "center", gap: 8, paddingTop: 45 },
  noResultsText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
