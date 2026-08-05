import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  findNodeHandle,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import dayjs from "dayjs";
import { colors, fonts, tvColors } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";

const HEADER_H = 30;
const ACCENT = "#8B5CF6";
const ACCENT_SOFT = "#F5F3FF";
const MINUTE_MS = 60_000;

function mins(a: string, b: string) {
  return dayjs(a).diff(dayjs(b), "minute");
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours >= 12 ? "PM" : "AM";
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes.toString().padStart(2, "0")} ${suffix}`;
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

type TimelineRowProps = {
  row: PreparedRow;
  index: number;
  rowHeight: number;
  logoWidth: number;
  logoSize: number;
  timelineWidth: number;
  scrollX: Animated.Value;
  showChannelNumbers: boolean;
  channelNumberById?: Record<string, number>;
  showChannelLogos: boolean;
  onChannelPress: (channel: Channel) => void;
  onChannelFocus?: (channel: Channel) => void;
  onChannelLongPress?: (channel: Channel) => void;
  onProgramPress: (program: Program, channel: Channel) => void;
  onProgramFocus: (program: PreparedProgram, channel: Channel) => void;
};

const TimelineRow = memo(function TimelineRow({
  row,
  index,
  rowHeight,
  logoWidth,
  logoSize,
  timelineWidth,
  scrollX,
  showChannelNumbers,
  channelNumberById,
  showChannelLogos,
  onChannelPress,
  onChannelFocus,
  onChannelLongPress,
  onProgramPress,
  onProgramFocus,
}: TimelineRowProps) {
  const item = row.channel;
  const preferred = row.programs.find((program) => program.isLive) || row.programs[0];
  const [preferredHandle, setPreferredHandle] = useState<number | undefined>();

  const capturePreferred = useCallback((node: any) => {
    if (!node) return;
    const handle = findNodeHandle(node) || undefined;
    setPreferredHandle((current) => (current === handle ? current : handle));
  }, []);

  useEffect(() => {
    setPreferredHandle(undefined);
  }, [item.id, preferred?.key]);

  return (
    <View style={[styles.row, { height: rowHeight }]}>
      <Animated.View
        style={[
          styles.logoCol,
          {
            width: logoWidth,
            minWidth: logoWidth,
            maxWidth: logoWidth,
            height: rowHeight,
            transform: [{ translateX: scrollX }],
          },
        ]}
      >
        <Pressable
          style={({ focused }: any) => [styles.logoCell, focused && styles.logoCellFocused]}
          focusable
          {...(preferredHandle ? ({ nextFocusRight: preferredHandle } as any) : {})}
          onFocus={() => onChannelFocus?.(item)}
          onPress={() => onChannelPress(item)}
          onLongPress={() => onChannelLongPress?.(item)}
          testID={`epg-channel-${item.id}`}
        >
          {showChannelNumbers && (
            <Text style={styles.channelNumber}>{channelNumberById?.[item.id] || index + 1}</Text>
          )}
          <ChannelLogo name={item.name} logo={item.logo} disabled={!showChannelLogos} size={logoSize} />
          <Text numberOfLines={1} style={styles.logoName}>{item.name}</Text>
        </Pressable>
      </Animated.View>

      <View style={{ width: timelineWidth, height: rowHeight }}>
        {row.programs.map((prepared, programIndex) => {
          const isPreferred = prepared.key === preferred?.key;
          return (
            <Pressable
              key={prepared.key}
              ref={isPreferred ? capturePreferred : undefined}
              onFocus={() => onProgramFocus(prepared, item)}
              onPress={() => onProgramPress(prepared.program, item)}
              onLongPress={() => onChannelLongPress?.(item)}
              focusable
              style={({ focused }: any) => [
                styles.progCell,
                { left: prepared.left, width: prepared.width },
                prepared.isLive && styles.progLive,
                focused && styles.programCellFocused,
              ]}
              testID={`epg-prog-${item.id}-${programIndex}`}
            >
              <Text numberOfLines={1} style={styles.progTitle}>{prepared.program.title}</Text>
              <Text numberOfLines={1} style={styles.progTime}>{prepared.timeLabel}</Text>
            </Pressable>
          );
        })}
        {row.programs.length === 0 && (
          <View style={[styles.progCell, { left: 0, width: Math.max(24, timelineWidth - 6) }]}>
            <Text style={styles.noData}>No guide data</Text>
          </View>
        )}
      </View>
    </View>
  );
});

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
  const [programViewportW, setProgramViewportW] = useState(0);
  const listRef = useRef<any>(null);
  const horizontalRef = useRef<ScrollView>(null);
  const focusRegionRef = useRef<"channel" | "program">("program");
  const scrollXRef = useRef(0);

  const totalMin = mins(windowEnd, windowStart);
  const longGuideWindow = totalMin >= 20 * 60;
  const PX_PER_MIN = longGuideWindow ? (big ? 2.25 : 1.75) : big ? 4.4 : 3.4;
  const timelineWidth = Math.max(1, totalMin * PX_PER_MIN);
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
      const tickMs = t.valueOf();
      out.push({
        key: t.toISOString(),
        label: formatTime(tickMs),
        left: ((tickMs - windowStartMs) / MINUTE_MS) * PX_PER_MIN,
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
      for (const program of channel.programs || []) {
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
    try {
      horizontalRef.current?.scrollTo({ x: 0, animated: true });
      scrollXRef.current = 0;
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

  const keepProgramVisible = useCallback((prepared: PreparedProgram, channel: Channel) => {
    focusRegionRef.current = "program";
    onChannelFocus?.(channel);
    if (!programViewportW) return;

    const margin = 10;
    const currentX = scrollXRef.current;
    const leftEdge = prepared.left;
    const rightEdge = prepared.left + prepared.width;
    let target = currentX;

    if (leftEdge < currentX + margin) {
      target = Math.max(0, leftEdge - margin);
    } else if (rightEdge > currentX + programViewportW - margin) {
      target = Math.max(0, rightEdge - programViewportW + margin);
    }

    const maxX = Math.max(0, timelineWidth - programViewportW);
    target = Math.min(maxX, target);
    if (Math.abs(target - currentX) > 1) {
      scrollXRef.current = target;
      horizontalRef.current?.scrollTo({ x: target, animated: true });
    }
  }, [onChannelFocus, programViewportW, timelineWidth]);

  return (
    <View style={styles.wrap} testID="epg-timeline-grid">
      <View style={styles.headerRow}>
        <View style={[styles.corner, { width: LOGO_W }]}>
          <Text style={styles.cornerText}>{dayjs(windowStart).format("MMM D")}</Text>
        </View>
        <View style={styles.headerTrack} onLayout={(event) => setProgramViewportW(event.nativeEvent.layout.width)}>
          <Animated.View style={{ width: timelineWidth, height: HEADER_H, transform: [{ translateX: negScrollX }] }}>
            {ticks.map((tick) => (
              <Text key={tick.key} style={[styles.tickLabel, { left: tick.left }]}>{tick.label}</Text>
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
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            {
              useNativeDriver: false,
              listener: (event: any) => {
                scrollXRef.current = event?.nativeEvent?.contentOffset?.x || 0;
              },
            },
          )}
        >
          <View style={{ width: LOGO_W + timelineWidth, height: bodyH }}>
            {bodyH > 0 && (
              <FlashList
                data={preparedRows}
                ref={listRef}
                keyExtractor={(row) => row.channel.id}
                drawDistance={Math.max(720, ROW_H * 16)}
                removeClippedSubviews={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 120 }}
                refreshControl={
                  onRefresh ? (
                    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={ACCENT} colors={[ACCENT]} />
                  ) : undefined
                }
                renderItem={({ item: row, index }) => (
                  <TimelineRow
                    row={row}
                    index={index}
                    rowHeight={ROW_H}
                    logoWidth={LOGO_W}
                    logoSize={LOGO_SIZE}
                    timelineWidth={timelineWidth}
                    scrollX={scrollX}
                    showChannelNumbers={showChannelNumbers}
                    channelNumberById={channelNumberById}
                    showChannelLogos={showChannelLogos}
                    onChannelPress={onChannelPress}
                    onChannelFocus={(channel) => {
                      focusRegionRef.current = "channel";
                      onChannelFocus?.(channel);
                    }}
                    onChannelLongPress={onChannelLongPress}
                    onProgramPress={onProgramPress}
                    onProgramFocus={keepProgramVisible}
                  />
                )}
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
  wrap: { flex: 1, overflow: "hidden" },
  body: { flex: 1, overflow: "hidden" },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: tvColors.line,
    backgroundColor: "rgba(9,8,20,0.98)",
  },
  corner: {
    height: HEADER_H,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
    backgroundColor: "#070711",
    zIndex: 20,
    elevation: 8,
    overflow: "hidden",
  },
  cornerText: { color: ACCENT_SOFT, fontFamily: fonts.bold, fontSize: 11 },
  headerTrack: { flex: 1, height: HEADER_H, overflow: "hidden" },
  tickLabel: {
    position: "absolute",
    top: 7,
    color: ACCENT_SOFT,
    fontFamily: fonts.semibold,
    fontSize: 10.5,
    width: 100,
  },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.055)", overflow: "hidden" },
  logoCol: {
    zIndex: 20,
    elevation: 8,
    flexShrink: 0,
    overflow: "hidden",
    backgroundColor: "#0A0916",
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
  },
  logoCell: {
    flex: 1,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: 6,
    gap: 6,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#0A0916",
    overflow: "hidden",
  },
  logoCellFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "#2E1065",
  },
  channelNumber: {
    minWidth: 25,
    color: ACCENT_SOFT,
    fontFamily: fonts.bold,
    fontSize: 10,
    textAlign: "right",
  },
  logoName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10.5, textAlign: "left", flex: 1 },
  progCell: {
    position: "absolute",
    top: 3,
    bottom: 3,
    backgroundColor: "rgba(24,23,42,0.88)",
    borderRadius: 3,
    borderWidth: 2,
    borderColor: "transparent",
    paddingHorizontal: 6,
    justifyContent: "center",
    overflow: "hidden",
  },
  progLive: { borderColor: "rgba(168,85,247,0.50)", backgroundColor: "rgba(59,23,104,0.60)" },
  programCellFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(91,33,182,0.92)",
  },
  progTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 10 },
  progTime: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.regular, fontSize: 8, marginTop: 1 },
  noData: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 9 },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: ACCENT, zIndex: 3, pointerEvents: "none" },
});