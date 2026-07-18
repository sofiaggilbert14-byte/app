import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  RefreshControl,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from "react-native";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";

const PX_PER_MIN = 3.4;
const ROW_H = 66;
const LOGO_W = 76;
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
  const headerRef = useRef<ScrollView>(null);
  const leftRef = useRef<FlatList<Channel>>(null);
  const rightRef = useRef<FlatList<Channel>>(null);
  const scrollSource = useRef<"left" | "right" | null>(null);
  const [bodyH, setBodyH] = useState(0);

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

  const onHScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    headerRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false });
  };

  const syncFrom = (which: "left" | "right", y: number) => {
    if (scrollSource.current && scrollSource.current !== which) return;
    if (which === "left") rightRef.current?.scrollToOffset({ offset: y, animated: false });
    else leftRef.current?.scrollToOffset({ offset: y, animated: false });
  };

  const getItemLayout = (_: any, index: number) => ({
    length: ROW_H,
    offset: ROW_H * index,
    index,
  });

  return (
    <View style={styles.wrap} testID="epg-timeline-grid">
      {/* time header */}
      <View style={styles.headerRow}>
        <View style={[styles.corner, { width: LOGO_W }]}>
          <Text style={styles.cornerText}>{dayjs(windowStart).format("MMM D")}</Text>
        </View>
        <ScrollView ref={headerRef} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false}>
          <View style={{ width: timelineWidth, height: HEADER_H }}>
            {ticks.map((t) => (
              <Text key={t} style={[styles.tickLabel, { left: mins(t, windowStart) * PX_PER_MIN }]}>
                {dayjs(t).format("h:mm A")}
              </Text>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* body */}
      <View style={styles.body} onLayout={(e: LayoutChangeEvent) => setBodyH(e.nativeEvent.layout.height)}>
        {/* sticky logo column (virtualized) */}
        <FlatList
          ref={leftRef}
          data={channels}
          keyExtractor={(c) => c.id}
          style={{ width: LOGO_W }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          getItemLayout={getItemLayout}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onScrollBeginDrag={() => (scrollSource.current = "left")}
          onMomentumScrollEnd={() => (scrollSource.current = null)}
          onScrollEndDrag={() => (scrollSource.current = null)}
          onScroll={(e) => syncFrom("left", e.nativeEvent.contentOffset.y)}
          renderItem={({ item, index }) => (
            <Pressable
              style={({ focused }: any) => [styles.logoCell, focused && styles.cellFocused]}
              hasTVPreferredFocus={index === 0}
              onPress={() => onChannelPress(item)}
              testID={`epg-channel-${item.id}`}
            >
              <ChannelLogo name={item.name} logo={item.logo} size={40} />
              <Text numberOfLines={1} style={styles.logoName}>
                {item.name}
              </Text>
            </Pressable>
          )}
        />

        {/* horizontally scrolling program area */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={16} onScroll={onHScroll}>
          <View style={{ width: timelineWidth, height: bodyH }}>
            <FlatList
              ref={rightRef}
              data={channels}
              keyExtractor={(c) => c.id}
              style={{ height: bodyH }}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              getItemLayout={getItemLayout}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews
              refreshControl={
                onRefresh ? (
                  <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
                ) : undefined
              }
              onScrollBeginDrag={() => (scrollSource.current = "right")}
              onMomentumScrollEnd={() => (scrollSource.current = null)}
              onScrollEndDrag={() => (scrollSource.current = null)}
              onScroll={(e) => syncFrom("right", e.nativeEvent.contentOffset.y)}
              contentContainerStyle={{ paddingBottom: 120 }}
              renderItem={({ item }) => (
                <View style={[styles.progRow, { width: timelineWidth }]}>
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
              )}
            />
            {showNow && bodyH > 0 && <View style={[styles.nowLine, { left: nowOffset, pointerEvents: "none" }]} />}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { flex: 1, flexDirection: "row" },
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
  },
  cornerText: { color: colors.onSurfaceTertiary, fontFamily: fonts.semibold, fontSize: 11 },
  tickLabel: {
    position: "absolute",
    top: 9,
    color: colors.onSurfaceTertiary,
    fontFamily: fonts.medium,
    fontSize: 11,
    width: 100,
  },
  logoCell: {
    height: ROW_H,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: 4,
    gap: 2,
  },
  logoName: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 9, textAlign: "center" },
  progRow: { height: ROW_H, borderBottomWidth: 1, borderBottomColor: colors.divider },
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
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: colors.brand },
});
