import React, { useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  NativeSyntheticEvent,
  NativeScrollEvent,
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
}: {
  channels: Channel[];
  windowStart: string;
  windowEnd: string;
  now: string;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelPress: (c: Channel) => void;
}) {
  const headerRef = useRef<ScrollView>(null);
  const totalMin = mins(windowEnd, windowStart);
  const timelineWidth = totalMin * PX_PER_MIN;

  const ticks = useMemo(() => {
    const out: string[] = [];
    let t = dayjs(windowStart);
    const end = dayjs(windowEnd);
    // align to next 30 min
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

  const onBodyScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    headerRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false });
  };

  return (
    <View style={styles.wrap} testID="epg-timeline-grid">
      {/* time header */}
      <View style={styles.headerRow}>
        <View style={[styles.corner, { width: LOGO_W }]}>
          <Text style={styles.cornerText}>{dayjs(now).format("MMM D")}</Text>
        </View>
        <ScrollView
          ref={headerRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
        >
          <View style={{ width: timelineWidth, height: HEADER_H }}>
            {ticks.map((t) => (
              <Text
                key={t}
                style={[styles.tickLabel, { left: mins(t, windowStart) * PX_PER_MIN }]}
              >
                {dayjs(t).format("h:mm A")}
              </Text>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* body: vertical scroll wraps left column + horizontal program area */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.bodyRow}>
          {/* sticky channel column */}
          <View style={{ width: LOGO_W }}>
            {channels.map((c) => (
              <Pressable
                key={c.id}
                style={styles.logoCell}
                onPress={() => onChannelPress(c)}
                testID={`epg-channel-${c.id}`}
              >
                <ChannelLogo name={c.name} logo={c.logo} size={40} />
                <Text numberOfLines={1} style={styles.logoName}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* horizontally scrolling program blocks */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onBodyScroll}
          >
            <View style={{ width: timelineWidth }}>
              {channels.map((c) => (
                <View key={c.id} style={styles.progRow}>
                  {(c.programs || []).map((p, i) => {
                    const left = Math.max(0, mins(p.start, windowStart) * PX_PER_MIN);
                    const end = p.stop || dayjs(p.start).add(30, "minute").toISOString();
                    const w = Math.max(24, mins(end, p.start) * PX_PER_MIN - 3);
                    const isLive =
                      dayjs(now).isAfter(p.start) && dayjs(now).isBefore(end);
                    return (
                      <Pressable
                        key={i}
                        onPress={() => onProgramPress(p, c)}
                        style={[
                          styles.progCell,
                          { left, width: w },
                          isLive && styles.progLive,
                        ]}
                        testID={`epg-prog-${c.id}-${i}`}
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
                  {(!c.programs || c.programs.length === 0) && (
                    <View style={[styles.progCell, { left: 0, width: timelineWidth - 6 }]}>
                      <Text style={styles.noData}>No guide data</Text>
                    </View>
                  )}
                </View>
              ))}
              {showNow && <View style={[styles.nowLine, { left: nowOffset }]} />}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
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
  bodyRow: { flexDirection: "row" },
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
  progRow: {
    height: ROW_H,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
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
  progTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 12 },
  progTime: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 10, marginTop: 2 },
  noData: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 11 },
  nowLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.brand,
    pointerEvents: "none",
  },
});
