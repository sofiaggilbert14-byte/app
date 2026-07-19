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
import { FlashList } from "@shopify/flash-list";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";
import { AZRail } from "./AZRail";

const HEADER_H = 34;

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
  refreshing,
  onRefresh,
}: {
  channels: Channel[];
  windowStart: string;
  windowEnd: string;
  now: string;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelPress: (c: Channel) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { width } = useWindowDimensions();
  // Scale up for tablets / TVs so it stays readable on large landscape screens.
  const big = width >= 900;
  const ROW_H = big ? 84 : 66;
  const LOGO_W = big ? 108 : 76;
  const LOGO_SIZE = big ? 54 : 40;
  const PX_PER_MIN = big ? 4.4 : 3.4;

  const scrollX = useRef(new Animated.Value(0)).current;
  const negScrollX = useMemo(() => Animated.multiply(scrollX, -1), [scrollX]);
  const [bodyH, setBodyH] = useState(0);
  const listRef = useRef<FlashList<Channel>>(null);

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
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        >
          <View style={{ width: LOGO_W + timelineWidth, height: bodyH }}>
            {bodyH > 0 && (
              <FlashList
                data={channels}
                ref={listRef}
                keyExtractor={(c) => c.id}
                drawDistance={2000}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 120 }}
                refreshControl={
                  onRefresh ? (
                    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
                  ) : undefined
                }
                renderItem={({ item, index }) => (
                  <View style={[styles.row, { height: ROW_H }]}>
                    {/* sticky logo — translated with horizontal scroll to stay pinned left */}
                    <Animated.View style={[styles.logoCol, { width: LOGO_W, height: ROW_H, transform: [{ translateX: scrollX }] }]}>
                      <Pressable
                        style={({ focused }: any) => [styles.logoCell, focused && styles.cellFocused]}
                        hasTVPreferredFocus={index === 0}
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
                        const left = Math.max(0, mins(p.start, windowStart) * PX_PER_MIN);
                        const end = p.stop || dayjs(p.start).add(30, "minute").toISOString();
                        const w = Math.max(24, mins(end, p.start) * PX_PER_MIN - 3);
                        const isLive = dayjs(now).isAfter(p.start) && dayjs(now).isBefore(end);
                        return (
                          <Pressable
                            key={i}
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
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  corner: {
    height: HEADER_H,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
    zIndex: 5,
  },
  cornerText: { color: colors.onSurfaceTertiary, fontFamily: fonts.semibold, fontSize: 11 },
  headerTrack: { flex: 1, height: HEADER_H, overflow: "hidden" },
  tickLabel: {
    position: "absolute",
    top: 9,
    color: colors.onSurfaceTertiary,
    fontFamily: fonts.medium,
    fontSize: 11,
    width: 100,
  },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.divider },
  logoCol: {
    zIndex: 5,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  logoCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    gap: 2,
  },
  logoName: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 9, textAlign: "center" },
  progCell: {
    position: "absolute",
    top: 5,
    bottom: 5,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    borderWidth: 0.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  progLive: { borderColor: colors.brand, backgroundColor: "#241018" },
  cellFocused: {
    borderColor: colors.brand,
    borderWidth: 2,
    backgroundColor: "#2a121b",
  },
  progTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 12 },
  progTime: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 10, marginTop: 2 },
  noData: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 11 },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: colors.brand, zIndex: 3, pointerEvents: "none" },
});
