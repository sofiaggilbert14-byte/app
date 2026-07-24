import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { useTvBackToGuide } from "@/src/hooks/use-tv-back-to-guide";

function byChannelName(a: Channel, b: Channel): number {
  return (a.name || "").localeCompare(b.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export default function SearchScreen() {
  const router = useRouter();
  const { channels, addRecent, openProgram, favorites, recent, lastChannelId, channelById } = useStore();
  const [q, setQ] = useState("");
  useTvBackToGuide();

  const { chResults, progResults } = useMemo(() => {
    const ql = q.toLowerCase().trim();
    if (!ql) return { chResults: [], progResults: [] as { p: Program; c: Channel }[] };
    const chResults = channels
      .filter((c) => {
        const haystack = `${c.name} ${c.group} ${c.tvg_id}`.toLowerCase();
        return haystack.includes(ql);
      })
      .sort(byChannelName)
      .slice(0, 50);
    const now = Date.now();
    const progResults: { p: Program; c: Channel }[] = [];
    for (const c of channels) {
      for (const p of c.programs || []) {
        const end = p.stop ? new Date(p.stop).getTime() : new Date(p.start).getTime();
        if (end < now) continue;
        const haystack = `${p.title} ${p.desc || ""} ${p.category || ""} ${c.name}`.toLowerCase();
        if (haystack.includes(ql)) progResults.push({ p, c });
        if (progResults.length >= 80) break;
      }
      if (progResults.length >= 80) break;
    }
    progResults.sort((a, b) => a.p.start.localeCompare(b.p.start));
    return { chResults, progResults };
  }, [q, channels]);

  const quickChannels = useMemo(() => {
    const seen = new Set<string>();
    const out: Channel[] = [];
    const add = (c?: Channel | null) => {
      if (!c || seen.has(c.id)) return;
      seen.add(c.id);
      out.push(c);
    };
    add(lastChannelId ? channelById(lastChannelId) : null);
    recent.forEach((c) => add(channelById(c.id) || c));
    channels.filter((c) => favorites.includes(c.id)).sort(byChannelName).forEach(add);
    channels.slice(0, 12).forEach(add);
    return out.slice(0, 12);
  }, [channels, channelById, favorites, lastChannelId, recent]);

  const play = (c: Channel) => {
    Haptics.selectionAsync();
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ paddingTop: spacing.md }}>
        <View style={styles.header}>
          <Text style={styles.brand}>Find anything</Text>
          <Text style={styles.title}>Search</Text>
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Channels or programs…"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            autoCorrect={false}
            testID="search-input"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} hitSlop={8} testID="search-clear">
              <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130 }}
      >
        {q.trim().length === 0 ? (
          <>
            <View style={styles.empty}>
              <Ionicons name="search" size={36} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Search channels, categories, and upcoming programs</Text>
            </View>
            {quickChannels.length > 0 && (
              <>
                <Text style={styles.section}>Quick Picks</Text>
                {quickChannels.map((c) => (
                  <Pressable
                    key={c.id}
                    style={({ focused }: any) => [styles.row, focused && styles.rowFocused]}
                    onPress={() => play(c)}
                    testID={`search-quick-${c.id}`}
                  >
                    <ChannelLogo name={c.name} logo={c.logo} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.rowName}>{c.name}</Text>
                      <Text numberOfLines={1} style={styles.rowSub}>{c.group || "Channel"}</Text>
                    </View>
                    <Ionicons name="play-circle" size={22} color={colors.brand} />
                  </Pressable>
                ))}
              </>
            )}
          </>
        ) : chResults.length === 0 && progResults.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No results for “{q}”</Text>
          </View>
        ) : (
          <>
            {chResults.length > 0 && <Text style={styles.section}>Channels</Text>}
            {chResults.map((c) => (
              <Pressable key={c.id} style={({ focused }: any) => [styles.row, focused && styles.rowFocused]} onPress={() => play(c)} testID={`search-ch-${c.id}`}>
                <ChannelLogo name={c.name} logo={c.logo} size={40} />
                <Text numberOfLines={1} style={styles.rowName}>{c.name}</Text>
                <Ionicons name="play-circle" size={22} color={colors.brand} />
              </Pressable>
            ))}

            {progResults.length > 0 && <Text style={styles.section}>Upcoming Programs</Text>}
            {progResults.map(({ p, c }, i) => (
              <Pressable
                key={`${c.id}-${i}`}
                style={({ focused }: any) => [styles.row, focused && styles.rowFocused]}
                onPress={() => openProgram(p, c)}
                testID={`search-prog-${c.id}-${i}`}
              >
                <ChannelLogo name={c.name} logo={c.logo} size={40} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.rowName}>{p.title}</Text>
                  <Text numberOfLines={1} style={styles.rowSub}>
                    {c.name} · {dayjs(p.start).format("ddd h:mm A")}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  brand: { color: colors.brandSecondary, fontFamily: fonts.semibold, fontSize: 12 },
  title: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 28 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 48,
    borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.onSurface, fontFamily: fonts.regular, fontSize: 15 },
  section: {
    color: colors.onSurface,
    fontFamily: fonts.display,
    fontSize: 18,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowName: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14, flex: 1 },
  rowSub: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  rowFocused: { borderColor: "#fff", borderWidth: 2, backgroundColor: "#2a121b" },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 14, textAlign: "center" },
});
