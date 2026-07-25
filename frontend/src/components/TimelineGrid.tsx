import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Animated,
  useWindowDimensions,
  LayoutChangeEvent,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";
import { AZRail } from "./AZRail";

const HEADER_H = 34;
const GOLD = "#F6B73C";
const GOLD_SOFT = "#FFE3A3";

function mins(a: string, b: string) {
  return dayjs(a).diff(dayjs(b), "minute");
}

export function TimelineGrid({
  channels,
  windowStart,
  windowEnd,
  now,
  onProgramPress,
  onChannelPress,
  onChannelFocus,
  refreshing,
  onRefresh,
  density = "normal",
}: {
  channels: Channel[];
  windowStart: string;
  windowEnd: string;
  now: string;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelPress: (c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  density?: "large" | "normal" | "compact";
}) {
  const { width } = useWindowDimensions();
  // Scale up for tablets / TVs so it stays readable on large landscape screens.
  const big = width >= 900;
  const ROW_H = density === "large" ? (big ? 76 : 66) : density === "compact" ? (big ? 52 : 48) : big ? 62 : 56;
  const LOGO_W = big ? 250 : 176;
  const LOGO_SIZE = density === "large" ? (big ? 44 : 36) : density === "compact" ? (big ? 30 : 26) : big ? 34 : 30;
  const PX_PER_MIN = big ? 4.4 : 3.4;

  const scrollX = useRef(new Animated.Value(0)).current;
  const negScrollX = useMemo(() => Animated.multiply(scrollX, -1), [scrollX]);
  const [bodyH, setBodyH] = useState(0);
  const listRef = useRef<FlashListRef<Channel>>(null);

  const totalMin = mins(windowEnd, windowStart);
  const timelineWidth = totalMin * PX_PER_MIN;

  const ticks = useMemo(() => {
    const out: string[] = [];
    let t = dayjs(windowStart);
    const end = dayjs(windowEnd);
    const m = t.minute();
    t = t.minute(m < 30 ? 30 : 0).second(0);
    if (m >= 30) t = t.add(1, "hour");
    while (t.isBefore(end)) {
      out.push(t.toISOString());
      t = t.add(30, "minute");
    }
    return out;
  }, [windowStart, windowEnd]);

  const nowOffset = mins(now, windowStart) * PX_PER_MIN;
  const showNow = dayjs(now).isAfter(windowStart) && dayjs(now).isBefore(windowEnd);

  return (
    <View style={styles.wrap} testID="epg-timeline-grid">
      {/* time header: sticky corner + horizontally-synced ticks */}
      <View style={styles.headerRow}>
        <View style={[styles.corner, { width: LOGO_W }]}>
          <Text style={styles.cornerText}>{dayjs(windowStart).format("MMM D")}</Text>
        </View>
        <View style={styles.headerTrack}>
          <Animated.View style={{ width: timelineWidth, height: HEADER_H, transform: [{ translateX: negScrollX }] }}>
            {ticks.map((t) => (
              <Text key={t} style={[styles.tickLabel, { left: mins(t, windowStart) * PX_PER_MIN }]}>
                {dayjs(t).format("h:mm A")}
              </Text>
            ))}
          </Animated.View>
        </View>
      </View>

      {/* body: one horizontal scroll wrapping ONE recycling vertical list. Each
          row holds the logo AND its programs, so they can never drift apart. */}
      <View style={styles.body} onLayout={(e: LayoutChangeEvent) => setBodyH(e.nativeEvent.layout.height)}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
        >
          <View style={{ width: LOGO_W + timelineWidth, height: bodyH }}>
            {bodyH > 0 && (
              <FlashList
                data={channels}
                ref={listRef}
                keyExtractor={(c) => c.id}
                drawDistance={big ? 600 : 400}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 120 }}
                refreshControl={
                  onRefresh ? (
                    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={GOLD} colors={[GOLD]} />
                  ) : undefined
                }
                renderItem={({ item, index }) => (
                  <View style={[styles.row, { height: ROW_H }]}>
                    {/* sticky logo — translated with horizontal scroll to stay pinned left */}
                    <Animated.View style={[styles.logoCol, { width: LOGO_W, height: ROW_H, transform: [{ translateX: scrollX }] }]}>
                      <Pressable
                        style={({ focused }: any) => [styles.logoCell, focused && styles.cellFocused]}
                        hasTVPreferredFocus={index === 0}
                        onFocus={() => onChannelFocus?.(item)}
                        onPress={() => onChannelPress(item)}
                        testID={`epg-channel-${item.id}`}
                      >
                        <ChannelLogo name={item.name} logo={item.logo} size={LOGO_SIZE} />
                        <Text numberOfLines={1} style={styles.logoName}>
                          {item.name}
                        </Text>
                      </Pressable>
                    </Animated.View>

                    {/* programs */}
                    <View style={{ width: timelineWidth, height: ROW_H }}>
                      {(item.programs || []).map((p, i) => {
                        const startMs = Date.parse(p.start);
                        const rawEndMs = p.stop ? Date.parse(p.stop) : startMs + 30 * 60 * 1000;
                        const windowStartMs = Date.parse(windowStart);
                        const windowEndMs = Date.parse(windowEnd);
                        if (!Number.isFinite(startMs) || !Number.isFinite(rawEndMs) || rawEndMs <= startMs) return null;
                        if (rawEndMs <= windowStartMs || startMs >= windowEndMs) return null;
                        const visibleStart = Math.max(startMs, windowStartMs);
                        const visibleEnd = Math.min(rawEndMs, windowEndMs);
                        const left = ((visibleStart - windowStartMs) / 60000) * PX_PER_MIN;
                        const w = Math.max(24, ((visibleEnd - visibleStart) / 60000) * PX_PER_MIN - 3);
                        const end = new Date(rawEndMs).toISOString();
                        const isLive = dayjs(now).isAfter(p.start) && dayjs(now).isBefore(end);
                        return (
                          <Pressable
                            key={`${item.id}:${p.start}:${p.stop || "open"}:${p.title}`}
                            onFocus={() => onChannelFocus?.(item)}
                            onPress={() => onProgramPress(p, item)}
                            style={({ focused }: any) => [
                              styles.progCell,
                              { left, width: w },
                              isLive && styles.progLive,
                              focused && styles.cellFocused,
                            ]}
                            testID={`epg-prog-${item.id}-${i}`}
                          >
                            <Text numberOfLines={1} style={styles.progTitle}>
                              {p.title}
                            </Text>
                            <Text numberOfLines={1} style={styles.progTime}>
                              {dayjs(p.start).format("h:mm A")}
                            </Text>
                          </Pressable>
                        );
                      })}
                      {(!item.programs || item.programs.length === 0) && (
                        <View style={[styles.progCell, { left: 0, width: timelineWidth - 6 }]}>
                          <Text style={styles.noData}>No guide data</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              />
            )}
            {showNow && bodyH > 0 && (
              <View style={[styles.nowLine, { left: LOGO_W + nowOffset }]} />
            )}
          </View>
        </ScrollView>
        <AZRail
          channels={channels}
          onSelect={(i) => {
            try {
              listRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0 });
            } catch {}
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(246,183,60,0.32)",
    backgroundColor: "rgba(10,7,4,0.96)",
  },
  corner: {
    height: HEADER_H,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "rgba(246,183,60,0.38)",
    backgroundColor: "rgba(0,0,0,0.72)",
    zIndex: 5,
  },
  cornerText: { color: GOLD_SOFT, fontFamily: fonts.bold, fontSize: 11 },
  headerTrack: { flex: 1, height: HEADER_H, overflow: "hidden" },
  tickLabel: {
    position: "absolute",
    top: 9,
    color: GOLD_SOFT,
    fontFamily: fonts.semibold,
    fontSize: 12,
    width: 100,
  },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(246,183,60,0.15)" },
  logoCol: {
    zIndex: 5,
    backgroundColor: "rgba(8,5,3,0.97)",
    borderRightWidth: 1,
    borderRightColor: "rgba(246,183,60,0.30)",
  },
  logoCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  logoName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12, textAlign: "left", flex: 1 },
  progCell: {
    position: "absolute",
    top: 5,
    bottom: 5,
    backgroundColor: "rgba(32,21,13,0.78)",
    borderRadius: radius.sm,
    borderWidth: 0.5,
    borderColor: "rgba(255,227,163,0.16)",
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  progLive: { borderColor: GOLD, backgroundColor: "rgba(246,183,60,0.18)" },
  cellFocused: {
    borderColor: GOLD_SOFT,
    borderWidth: 2,
    backgroundColor: "rgba(246,183,60,0.22)",
  },
  progTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 11 },
  progTime: { color: GOLD_SOFT, fontFamily: fonts.regular, fontSize: 9, marginTop: 1 },
  noData: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 10 },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: GOLD, zIndex: 3, pointerEvents: "none" },
});
