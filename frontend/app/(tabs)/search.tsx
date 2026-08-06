import React, { useDeferredValue, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useStore } from "@/src/store";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "@/src/components/ChannelLogo";

type SearchRow =
  | { type: "section"; key: string; title: string }
  | { type: "channel"; key: string; channel: Channel }
  | { type: "program"; key: string; program: Program; channel: Channel }
  | { type: "empty"; key: string; message: string };

export default function SearchScreen() {
  const router = useRouter();
  const { channels, addRecent, openProgram, channelLogos, favorites } = useStore();
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const rows = useMemo<SearchRow[]>(() => {
    const ql = deferredQ.toLowerCase().trim();
    if (!ql) {
      return [{ type: "empty", key: "hint", message: "Search channels and upcoming programs" }];
    }

    const chResults = channels.filter((c) => c.name.toLowerCase().includes(ql)).slice(0, 40);
    const now = Date.now();
    const progResults: { p: Program; c: Channel }[] = [];
    for (const c of channels) {
      for (const p of c.programs || []) {
        const end = p.stop ? Date.parse(p.stop) : Date.parse(p.start);
        if (!Number.isFinite(end) || end < now) continue;
        if ((p.title || "").toLowerCase().includes(ql)) progResults.push({ p, c });
        if (progResults.length >= 60) break;
      }
      if (progResults.length >= 60) break;
    }
    progResults.sort((a, b) => a.p.start.localeCompare(b.p.start));

    if (!chResults.length && !progResults.length) {
      return [{ type: "empty", key: "none", message: `No results for “${deferredQ.trim()}”` }];
    }

    const next: SearchRow[] = [];
    if (chResults.length) {
      next.push({ type: "section", key: "ch-section", title: "Channels" });
      for (const channel of chResults) {
        next.push({ type: "channel", key: `ch-${channel.id}`, channel });
      }
    }
    if (progResults.length) {
      next.push({ type: "section", key: "prog-section", title: "Upcoming Programs" });
      progResults.forEach(({ p, c }, i) => {
        next.push({ type: "program", key: `prog-${c.id}-${p.start}-${i}`, program: p, channel: c });
      });
    }
    return next;
  }, [deferredQ, channels]);

  const play = (c: Channel) => {
    void Haptics.selectionAsync().catch(() => {});
    addRecent(c);
    router.push({ pathname: "/player", params: { channelId: c.id } });
  };

  return (
    <KeyboardAvoidingView style={styles.container}>
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

      <FlashList
        data={rows}
        keyExtractor={(item) => item.key}
        drawDistance={480}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130 }}
        renderItem={({ item }) => {
          if (item.type === "section") {
            return <Text style={styles.section}>{item.title}</Text>;
          }
          if (item.type === "empty") {
            return (
              <View style={styles.empty}>
                {item.key === "hint" ? (
                  <Ionicons name="search" size={36} color={colors.onSurfaceTertiary} />
                ) : null}
                <Text style={styles.emptyText}>{item.message}</Text>
              </View>
            );
          }
          if (item.type === "channel") {
            const c = item.channel;
            return (
              <Pressable
                style={({ focused }: any) => [styles.row, focused && styles.rowFocused]}
                onPress={() => play(c)}
                testID={`search-ch-${c.id}`}
              >
                <ChannelLogo
                  name={c.name}
                  logo={c.logo}
                  disabled={!channelLogos}
                  size={40}
                  favorite={favoriteSet.has(c.id)}
                />
                <Text numberOfLines={1} style={styles.rowName}>{c.name}</Text>
                <Ionicons name="play-circle" size={22} color={colors.brand} />
              </Pressable>
            );
          }
          const { program: p, channel: c } = item;
          return (
            <Pressable
              style={({ focused }: any) => [styles.row, focused && styles.rowFocused]}
              onPress={() => openProgram(p, c)}
              testID={`search-prog-${c.id}-${p.start}`}
            >
              <ChannelLogo
                name={c.name}
                logo={c.logo}
                disabled={!channelLogos}
                size={40}
                favorite={favoriteSet.has(c.id)}
              />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.rowName}>{p.title}</Text>
                <Text numberOfLines={1} style={styles.rowSub}>
                  {c.name} · {dayjs(p.start).format("ddd h:mm A")}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
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
  rowFocused: { borderColor: colors.brand, borderWidth: 2, backgroundColor: "#2a121b" },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 14, textAlign: "center" },
});
