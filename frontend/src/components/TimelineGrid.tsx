import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  useTVEventHandler,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import dayjs from "dayjs";
import { colors, fonts } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";

const HEADER_H = 30;
const GOLD = "#E3262E";
const GOLD_SOFT = "#FFFFFF";
const MINUTE_MS = 60_000;

function mins(a: string, b: string) {
  return dayjs(a).diff(dayjs(b), "minute");
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? "PM" : "AM";
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
}

type PreparedProgram = {
  program: Program;
  key: string;
  left: number;
  width: number;
  isLive: boolean;
  timeLabel: string;
};

type PreparedRow = {
  channel: Channel;
  programs: PreparedProgram[];
};

export function TimelineGrid({
  channels,
  windowStart,
  windowEnd,
  now,
  onProgramPress,
  onChannelPress,
  onChannelFocus,
  onChannelLongPress,
  refreshing,
  onRefresh,
  density = "normal",
  showChannelNumbers = false,
  channelNumberById,
  showChannelLogos = true,
  resetToken = 0,
  active = true,
  onLeftBoundary,
}: {
  channels: Channel[];
  windowStart: string;
  windowEnd: string;
  now: string;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelPress: (c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  onChannelLongPress?: (c: Channel) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  density?: "large" | "normal" | "compact";
  showChannelNumbers?: boolean;
  channelNumberById?: Record<string, number>;
  showChannelLogos?: boolean;
  resetToken?: number;
  active?: boolean;
  onLeftBoundary?: () => void;
}) {
  const { width } = useWindowDimensions();
  const big = width >= 900;
  const ROW_H = density === "large" ? (big ? 60 : 56) : density === "compact" ? (big ? 42 : 40) : big ? 48 : 46;
  const LOGO_W = big ? 112 : 86;
  const LOGO_SIZE = density === "large" ? (big ? 34 : 30) : density === "compact" ? (big ? 24 : 22) : big ? 28 : 26;
  const scrollX = useRef(new Animated.Value(0)).current;
  const negScrollX = useMemo(() => Animated.multiply(scrollX, -1), [scrollX]);
  const [bodyH, setBodyH] = useState(0);
  const listRef = useRef<any>(null);
  const horizontalRef = useRef<ScrollView>(null);
  const focusRegionRef = useRef<"channel" | "program">("program");
  const [preferFirstChannel, setPreferFirstChannel] = useState(false);

  const totalMin = mins(windowEnd, windowStart);
  const longGuideWindow = totalMin >= 20 * 60;
  const PX_PER_MIN = longGuideWindow ? (big ? 2.25 : 1.75) : big ? 4.4 : 3.4;
  const timelineWidth = totalMin * PX_PER_MIN;
  const windowStartMs = useMemo(() => Date.parse(windowStart), [windowStart]);
  const windowEndMs = useMemo(() => Date.parse(windowEnd), [windowEnd]);
  const nowMs = useMemo(() => Date.parse(now), [now]);

  const ticks = useMemo(() => {
    const out: { key: string; label: string; left: number }[] = [];
    let t = dayjs(windowStart);
    const end = dayjs(windowEnd);
    const m = t.minute();
    t = t.minute(m < 30 ? 30 : 0).second(0);
    if (m >= 30) t = t.add(1, "hour");
    while (t.isBefore(end)) {
      const ms = t.valueOf();
      out.push({
        key: t.toISOString(),
        label: formatTime(ms),
        left: ((ms - windowStartMs) / MINUTE_MS) * PX_PER_MIN,
      });
      t = t.add(30, "minute");
    }
    return out;
  }, [windowStart, windowEnd, windowStartMs, PX_PER_MIN]);

  const preparedRows = useMemo<PreparedRow[]>(() => {
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) {
      return channels.map((channel) => ({ channel, programs: [] }));
    }
    return channels.map((channel) => {
      const programs: PreparedProgram[] = [];
      const source = channel.programs || [];
      for (let i = 0; i < source.length; i++) {
        const program = source[i];
        const startMs = Date.parse(program.start);
        const endMs = program.stop ? Date.parse(program.stop) : startMs + 30 * MINUTE_MS;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        if (endMs <= windowStartMs || startMs >= windowEndMs) continue;
        const visibleStart = Math.max(startMs, windowStartMs);
        const visibleEnd = Math.min(endMs, windowEndMs);
        programs.push({
          program,
          key: `${channel.id}:${program.start}:${program.stop || "open"}:${program.title}`,
          left: ((visibleStart - windowStartMs) / MINUTE_MS) * PX_PER_MIN,
          width: Math.max(24, ((visibleEnd - visibleStart) / MINUTE_MS) * PX_PER_MIN - 3),
          isLive: nowMs >= startMs && nowMs < endMs,
          timeLabel: formatTime(startMs),
        });
      }
      return { channel, programs };
    });
  }, [channels, nowMs, PX_PER_MIN, windowEndMs, windowStartMs]);

  const nowOffset = Number.isFinite(nowMs) && Number.isFinite(windowStartMs)
    ? ((nowMs - windowStartMs) / MINUTE_MS) * PX_PER_MIN
    : 0;
  const showNow = nowMs > windowStartMs && nowMs < windowEndMs;

  useEffect(() => {
    if (!resetToken) return;
    setPreferFirstChannel(true);
    try {
      horizontalRef.current?.scrollTo({ x: 0, animated: true });
      scrollX.setValue(0);
      listRef.current?.scrollToIndex({ index: 0, animated: true, viewPosition: 0 });
    } catch {}
  }, [resetToken, scrollX]);

  useTVEventHandler(
    useCallback(
      (event) => {
        if (active && event?.eventType === "left" && focusRegionRef.current === "channel") {
          onLeftBoundary?.();
        }
      },
      [active, onLeftBoundary],
    ),
  );

  return (
    <View style={styles.wrap} testID="epg-timeline-grid">
      <View style={styles.headerRow}>
        <View style={[styles.corner, { width: LOGO_W }]}>
          <Text style={styles.cornerText}>{dayjs(windowStart).format("MMM D")}</Text>
        </View>
        <View style={styles.headerTrack}>
          <Animated.View style={{ width: timelineWidth, height: HEADER_H, transform: [{ translateX: negScrollX }] }}>
            {ticks.map((tick) => (
              <Text key={tick.key} style={[styles.tickLabel, { left: tick.left }]}>
                {tick.label}
              </Text>
            ))}
          </Animated.View>
        </View>
      </View>

      <View style={styles.body} onLayout={(e: LayoutChangeEvent) => setBodyH(e.nativeEvent.layout.height)}>
        <ScrollView
          ref={horizontalRef}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
        >
          <View style={{ width: LOGO_W + timelineWidth, height: bodyH }}>
            {bodyH > 0 && (
              <FlashList
                data={preparedRows}
                ref={listRef}
                keyExtractor={(row) => row.channel.id}
                drawDistance={Math.max(1200, ROW_H * 28)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 120 }}
                refreshControl={
                  onRefresh ? (
                    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={GOLD} colors={[GOLD]} />
                  ) : undefined
                }
                renderItem={({ item: row, index }) => {
                  const item = row.channel;
                  return (
                    <View style={[styles.row, { height: ROW_H }]}>
                      <Animated.View style={[styles.logoCol, { width: LOGO_W, height: ROW_H, transform: [{ translateX: scrollX }] }]}>
                        <Pressable
                          style={({ focused }: any) => [styles.logoCell, focused && styles.cellFocused]}
                          focusable
                          hasTVPreferredFocus={index === 0 && preferFirstChannel}
                          onFocus={() => {
                            focusRegionRef.current = "channel";
                            if (index === 0 && preferFirstChannel) setPreferFirstChannel(false);
                            onChannelFocus?.(item);
                          }}
                          onPress={() => onChannelPress(item)}
                          onLongPress={() => onChannelLongPress?.(item)}
                          testID={`epg-channel-${item.id}`}
                        >
                          {showChannelNumbers && (
                            <Text style={styles.channelNumber}>{channelNumberById?.[item.id] || index + 1}</Text>
                          )}
                          <ChannelLogo name={item.name} logo={item.logo} disabled={!showChannelLogos} size={LOGO_SIZE} />
                          <Text numberOfLines={1} style={styles.logoName}>{item.name}</Text>
                        </Pressable>
                      </Animated.View>

                      <View style={{ width: timelineWidth, height: ROW_H }}>
                        {row.programs.map((prepared, i) => (
                          <Pressable
                            key={prepared.key}
                            onFocus={() => {
                              focusRegionRef.current = "program";
                              onChannelFocus?.(item);
                            }}
                            onPress={() => onProgramPress(prepared.program, item)}
                            onLongPress={() => onChannelLongPress?.(item)}
                            focusable
                            style={({ focused }: any) => [
                              styles.progCell,
                              { left: prepared.left, width: prepared.width },
                              prepared.isLive && styles.progLive,
                              focused && styles.cellFocused,
                            ]}
                            testID={`epg-prog-${item.id}-${i}`}
                          >
                            <Text numberOfLines={1} style={styles.progTitle}>{prepared.program.title}</Text>
                            <Text numberOfLines={1} style={styles.progTime}>{prepared.timeLabel}</Text>
                          </Pressable>
                        ))}
                        {row.programs.length === 0 && (
                          <View style={[styles.progCell, { left: 0, width: timelineWidth - 6 }]}>
                            <Text style={styles.noData}>No guide data</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                }}
              />
            )}
            {showNow && bodyH > 0 && <View style={[styles.nowLine, { left: LOGO_W + nowOffset }]} />}
          </View>
        </ScrollView>
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
    borderBottomColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(9,12,16,0.96)",
  },
  corner: {
    height: HEADER_H,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.72)",
    zIndex: 5,
  },
  cornerText: { color: GOLD_SOFT, fontFamily: fonts.bold, fontSize: 11 },
  headerTrack: { flex: 1, height: HEADER_H, overflow: "hidden" },
  tickLabel: {
    position: "absolute",
    top: 7,
    color: GOLD_SOFT,
    fontFamily: fonts.semibold,
    fontSize: 10.5,
    width: 100,
  },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.055)" },
  logoCol: {
    zIndex: 5,
    backgroundColor: "rgba(11,14,18,0.97)",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.09)",
  },
  logoCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: 6,
    gap: 6,
  },
  channelNumber: {
    minWidth: 25,
    color: GOLD_SOFT,
    fontFamily: fonts.bold,
    fontSize: 10,
    textAlign: "right",
  },
  logoName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10.5, textAlign: "left", flex: 1 },
  progCell: {
    position: "absolute",
    top: 3,
    bottom: 3,
    backgroundColor: "rgba(27,31,36,0.82)",
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 6,
    justifyContent: "center",
  },
  progLive: { borderColor: "rgba(227,38,46,0.24)", backgroundColor: "rgba(72,31,34,0.42)" },
  cellFocused: {
    borderColor: GOLD_SOFT,
    borderWidth: 2,
    backgroundColor: "rgba(126,22,28,0.72)",
  },
  progTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 10 },
  progTime: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.regular, fontSize: 8, marginTop: 1 },
  noData: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 9 },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: GOLD, zIndex: 3, pointerEvents: "none" },
});
