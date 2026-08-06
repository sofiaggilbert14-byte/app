import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  RefreshControl,
  Animated,
  Easing,
  useWindowDimensions,
  LayoutChangeEvent,
  useTVEventHandler,
  findNodeHandle,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import { colors, fonts, tvColors } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";
import { reminderKey } from "@/src/utils/time";

const HEADER_H = 30;
const ACCENT = "#8B5CF6";
const ACCENT_SOFT = "#F5F3FF";
const REMINDER_BELL = "#FACC15";
const MINUTE_MS = 60_000;
const GUIDE_ESCAPE_GUARD_MS = 220;
const RAPID_VERTICAL_MS = 320;
const HORIZONTAL_PAN_MS = 110;

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
  /** Negated horizontal pan — applied only to the program track, never logos. */
  negScrollX: Animated.AnimatedMultiplication<number> | Animated.AnimatedInterpolation<number>;
  /** Current timeline pan (px) — used to limit which program cells are TV-focusable. */
  panX: number;
  programViewportW: number;
  showChannelNumbers: boolean;
  channelNumberById?: Record<string, number>;
  showChannelLogos: boolean;
  reminderKeys?: ReadonlySet<string>;
  onChannelPress: (channel: Channel) => void;
  onChannelFocus?: (channel: Channel) => void;
  onChannelLongPress?: (channel: Channel) => void;
  onProgramPress: (program: Program, channel: Channel) => void;
  onProgramFocus: (program: PreparedProgram, channel: Channel, rowIndex: number) => void;
  onRowChannelFocus: (channel: Channel, rowIndex: number) => void;
  preferInitialFocus?: boolean;
};

type ProgramCellProps = {
  prepared: PreparedProgram;
  programIndex: number;
  channel: Channel;
  isPreferred: boolean;
  preferInitialFocus: boolean;
  hasReminder: boolean;
  tvFocusable: boolean;
  capturePreferred: (node: any) => void;
  onProgramFocus: (program: PreparedProgram, channel: Channel) => void;
  onProgramPress: (program: Program, channel: Channel) => void;
  onChannelLongPress?: (channel: Channel) => void;
};

function programNearViewport(prepared: PreparedProgram, panX: number, viewportW: number) {
  // Keep about one screen of runway on each side so Left/Right still finds neighbors,
  // without leaving the entire multi-hour timeline focusable (that lags TV focus search).
  const pad = Math.max(160, viewportW > 0 ? viewportW * 0.55 : 220);
  const left = panX - pad;
  const right = panX + Math.max(viewportW, 280) + pad;
  return prepared.left < right && prepared.left + prepared.width > left;
}

const ProgramCell = memo(function ProgramCell({
  prepared,
  programIndex,
  channel,
  isPreferred,
  preferInitialFocus,
  hasReminder,
  tvFocusable,
  capturePreferred,
  onProgramFocus,
  onProgramPress,
  onChannelLongPress,
}: ProgramCellProps) {
  const handleProgramFocus = useCallback(
    () => onProgramFocus(prepared, channel),
    [onProgramFocus, prepared, channel],
  );
  const handleProgramPress = useCallback(
    () => onProgramPress(prepared.program, channel),
    [onProgramPress, prepared, channel],
  );
  const handleChannelLongPress = useCallback(
    () => onChannelLongPress?.(channel),
    [onChannelLongPress, channel],
  );

  return (
    <Pressable
      key={prepared.key}
      ref={isPreferred ? capturePreferred : undefined}
      onFocus={handleProgramFocus}
      onPress={handleProgramPress}
      onLongPress={handleChannelLongPress}
      delayLongPress={450}
      focusable={tvFocusable}
      hasTVPreferredFocus={preferInitialFocus && isPreferred && tvFocusable}
      style={({ focused }: any) => [
        styles.progCell,
        { left: prepared.left, width: prepared.width },
        prepared.isLive && styles.progLive,
        hasReminder && styles.progReminded,
        focused && styles.programCellFocused,
      ]}
      testID={`epg-prog-${channel.id}-${programIndex}`}
    >
      {hasReminder ? (
        <View style={styles.reminderBadge} pointerEvents="none">
          <Ionicons name="notifications" size={11} color={REMINDER_BELL} />
        </View>
      ) : null}
      <Text numberOfLines={1} style={styles.progTitle}>{prepared.program.title}</Text>
      <Text numberOfLines={1} style={styles.progTime}>{prepared.timeLabel}</Text>
    </Pressable>
  );
});

const TimelineRow = memo(function TimelineRow({
  row,
  index,
  rowHeight,
  logoWidth,
  logoSize,
  timelineWidth,
  negScrollX,
  panX,
  programViewportW,
  showChannelNumbers,
  channelNumberById,
  showChannelLogos,
  reminderKeys,
  onChannelPress,
  onChannelLongPress,
  onProgramPress,
  onProgramFocus,
  onRowChannelFocus,
  preferInitialFocus = false,
}: TimelineRowProps) {
  const item = row.channel;
  const preferred = row.programs.find((program) => program.isLive) || row.programs[0];
  const preferredHandleRef = useRef<number | undefined>(undefined);
  const [preferredHandle, setPreferredHandle] = useState<number | undefined>();

  const capturePreferred = useCallback((node: any) => {
    if (!node) return;
    const handle = findNodeHandle(node) || undefined;
    if (preferredHandleRef.current === handle) return;
    preferredHandleRef.current = handle;
    setPreferredHandle(handle);
  }, []);

  const handleChannelPress = useCallback(() => onChannelPress(item), [onChannelPress, item]);
  const handleChannelFocus = useCallback(() => onRowChannelFocus(item, index), [onRowChannelFocus, item, index]);
  const handleChannelLongPress = useCallback(() => onChannelLongPress?.(item), [onChannelLongPress, item]);
  const handleProgramFocus = useCallback(
    (prepared: PreparedProgram, channel: Channel) => onProgramFocus(prepared, channel, index),
    [onProgramFocus, index],
  );

  return (
    <View style={[styles.row, { height: rowHeight }]}>
      {/* Logos stay layout-fixed in the row — never translated with the timeline pan. */}
      <View
        style={[
          styles.logoCol,
          {
            width: logoWidth,
            minWidth: logoWidth,
            maxWidth: logoWidth,
            height: rowHeight,
          },
        ]}
      >
        <Pressable
          style={({ focused }: any) => [styles.logoCell, focused && styles.logoCellFocused]}
          focusable
          hasTVPreferredFocus={preferInitialFocus && !preferred}
          {...(preferredHandle ? ({ nextFocusRight: preferredHandle } as any) : {})}
          onFocus={handleChannelFocus}
          onPress={handleChannelPress}
          onLongPress={handleChannelLongPress}
          delayLongPress={450}
          testID={`epg-channel-${item.id}`}
        >
          {showChannelNumbers && (
            <Text style={styles.channelNumber}>{channelNumberById?.[item.id] || index + 1}</Text>
          )}
          <ChannelLogo name={item.name} logo={item.logo} disabled={!showChannelLogos} size={logoSize} />
          <Text numberOfLines={1} style={styles.logoName}>{item.name}</Text>
        </Pressable>
      </View>

      <View style={styles.timelineClip}>
        <Animated.View
          style={[
            styles.timelineTrack,
            {
              width: timelineWidth,
              height: rowHeight,
              transform: [{ translateX: negScrollX }],
            },
          ]}
        >
          {row.programs.map((prepared, programIndex) => {
            const near = programNearViewport(prepared, panX, programViewportW);
            const isPreferred = prepared.key === preferred?.key;
            return (
              <ProgramCell
                key={prepared.key}
                prepared={prepared}
                programIndex={programIndex}
                channel={item}
                isPreferred={isPreferred}
                preferInitialFocus={preferInitialFocus}
                hasReminder={!!reminderKeys?.has(reminderKey(item.id, prepared.program.start))}
                tvFocusable={near || (preferInitialFocus && isPreferred)}
                capturePreferred={capturePreferred}
                onProgramFocus={handleProgramFocus}
                onProgramPress={onProgramPress}
                onChannelLongPress={onChannelLongPress}
              />
            );
          })}
          {row.programs.length === 0 && (
            <View style={[styles.progCell, { left: 0, width: Math.max(24, timelineWidth - 6) }]}>
              <Text style={styles.noData}>No guide data</Text>
            </View>
          )}
        </Animated.View>
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
  reminderKeys,
  resetToken = 0,
  active = true,
  onLeftBoundary,
  onUpBoundary,
  onFocusedRowChange,
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
  reminderKeys?: ReadonlySet<string>;
  resetToken?: number;
  active?: boolean;
  onLeftBoundary?: () => void;
  /** Fired when Up is pressed on the first guide row so focus can exit to group chips. */
  onUpBoundary?: () => void;
  /** Reports the currently focused row index so the parent can relax trapFocusUp on row 0. */
  onFocusedRowChange?: (index: number) => void;
}) {
  const { width } = useWindowDimensions();
  const big = width >= 900;
  const ROW_H = density === "large" ? (big ? 60 : 56) : density === "compact" ? (big ? 42 : 40) : big ? 48 : 46;
  const LOGO_W = big ? 112 : 86;
  const LOGO_SIZE = density === "large" ? (big ? 34 : 30) : density === "compact" ? (big ? 24 : 22) : big ? 28 : 26;
  const scrollX = useRef(new Animated.Value(0)).current;
  const negScrollX = useMemo(() => Animated.multiply(scrollX, -1), [scrollX]);
  const panAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const [bodyH, setBodyH] = useState(0);
  const [programViewportW, setProgramViewportW] = useState(0);
  // Mirror of scroll offset for focus culling (Animated.Value can't drive React props).
  const [panX, setPanX] = useState(0);
  const [preferFirstRow, setPreferFirstRow] = useState(true);
  const listRef = useRef<any>(null);
  const focusRegionRef = useRef<"channel" | "program">("program");
  const focusedRowRef = useRef(0);
  const lastReportedDeepRef = useRef(false);
  const guideEscapeInFlight = useRef(false);
  const escapeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollXRef = useRef(0);
  const lastAxisRef = useRef<"v" | "h" | null>(null);
  const lastAxisAtRef = useRef(0);

  const reportFocusedRow = useCallback(
    (index: number) => {
      focusedRowRef.current = index;
      const deep = index > 0;
      if (lastReportedDeepRef.current === deep) return;
      lastReportedDeepRef.current = deep;
      onFocusedRowChange?.(index);
    },
    [onFocusedRowChange],
  );

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

  const setHorizontalOffset = useCallback(
    (target: number, animated: boolean) => {
      const next = Math.max(0, target);
      scrollXRef.current = next;
      // Update focus window immediately so neighbor cells are focusable before pan settles.
      setPanX(next);
      panAnimRef.current?.stop();
      // JS driver: safer with FlashList recycling than native-driver multiply transforms.
      if (!animated) {
        scrollX.setValue(next);
        return;
      }
      panAnimRef.current = Animated.timing(scrollX, {
        toValue: next,
        duration: HORIZONTAL_PAN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      });
      panAnimRef.current.start(() => {
        panAnimRef.current = null;
      });
    },
    [scrollX],
  );

  useEffect(() => {
    setPreferFirstRow(true);
    lastReportedDeepRef.current = false;
    focusedRowRef.current = 0;
    const clearPreferred = setTimeout(() => setPreferFirstRow(false), 420);
    if (!resetToken) return () => clearTimeout(clearPreferred);
    try {
      setHorizontalOffset(0, false);
      listRef.current?.scrollToIndex({ index: 0, animated: false, viewPosition: 0 });
      onFocusedRowChange?.(0);
    } catch {}
    return () => clearTimeout(clearPreferred);
  }, [onFocusedRowChange, resetToken, setHorizontalOffset]);

  useEffect(
    () => () => {
      if (escapeTimer.current) clearTimeout(escapeTimer.current);
      panAnimRef.current?.stop();
    },
    [],
  );

  useTVEventHandler(
    useCallback(
      (event) => {
        if (!active) return;
        const type = event?.eventType;
        if (type === "up" || type === "down") {
          lastAxisRef.current = "v";
          lastAxisAtRef.current = Date.now();
        } else if (type === "left" || type === "right") {
          lastAxisRef.current = "h";
          lastAxisAtRef.current = Date.now();
        }
        if (type === "left" && focusRegionRef.current === "channel") {
          onLeftBoundary?.();
          return;
        }
        // Single-owner Up escape: parent focuses the chip. Do NOT also moveNativeFocus.
        if (type === "up" && focusedRowRef.current <= 0) {
          if (guideEscapeInFlight.current) return;
          guideEscapeInFlight.current = true;
          onUpBoundary?.();
          if (escapeTimer.current) clearTimeout(escapeTimer.current);
          escapeTimer.current = setTimeout(() => {
            guideEscapeInFlight.current = false;
          }, GUIDE_ESCAPE_GUARD_MS);
        }
      },
      [active, onLeftBoundary, onUpBoundary],
    ),
  );

  const keepProgramVisible = useCallback((prepared: PreparedProgram, channel: Channel) => {
    focusRegionRef.current = "program";
    onChannelFocus?.(channel);
    if (!programViewportW) return;

    // During rapid vertical surfing, never chase horizontally — that drifts focus right.
    const rapidVertical =
      lastAxisRef.current === "v" && Date.now() - lastAxisAtRef.current < RAPID_VERTICAL_MS;
    if (rapidVertical) return;

    const margin = 18;
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
    if (Math.abs(target - currentX) <= 8) return;

    const animated = lastAxisRef.current !== "h" || Date.now() - lastAxisAtRef.current > RAPID_VERTICAL_MS;
    setHorizontalOffset(target, animated);
  }, [onChannelFocus, programViewportW, setHorizontalOffset, timelineWidth]);

  const onRowChannelFocus = useCallback(
    (channel: Channel, rowIndex: number) => {
      focusRegionRef.current = "channel";
      reportFocusedRow(rowIndex);
      onChannelFocus?.(channel);
      if (preferFirstRow && rowIndex !== 0) setPreferFirstRow(false);
    },
    [onChannelFocus, preferFirstRow, reportFocusedRow],
  );

  const onRowProgramFocus = useCallback(
    (prepared: PreparedProgram, channel: Channel, rowIndex: number) => {
      reportFocusedRow(rowIndex);
      keepProgramVisible(prepared, channel);
      if (preferFirstRow && rowIndex !== 0) setPreferFirstRow(false);
    },
    [keepProgramVisible, preferFirstRow, reportFocusedRow],
  );

  const renderRow = useCallback(
    ({ item: row, index }: { item: PreparedRow; index: number }) => (
      <TimelineRow
        row={row}
        index={index}
        rowHeight={ROW_H}
        logoWidth={LOGO_W}
        logoSize={LOGO_SIZE}
        timelineWidth={timelineWidth}
        negScrollX={negScrollX}
        panX={panX}
        programViewportW={programViewportW}
        showChannelNumbers={showChannelNumbers}
        channelNumberById={channelNumberById}
        showChannelLogos={showChannelLogos}
        reminderKeys={reminderKeys}
        onChannelPress={onChannelPress}
        onChannelLongPress={onChannelLongPress}
        onProgramPress={onProgramPress}
        onProgramFocus={onRowProgramFocus}
        onRowChannelFocus={onRowChannelFocus}
        preferInitialFocus={preferFirstRow && index === 0}
      />
    ),
    [ROW_H, LOGO_W, LOGO_SIZE, timelineWidth, negScrollX, panX, programViewportW, showChannelNumbers, channelNumberById, showChannelLogos, reminderKeys, onChannelPress, onChannelLongPress, onProgramPress, onRowProgramFocus, onRowChannelFocus, preferFirstRow],
  );

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

      {/*
        No horizontal ScrollView around the body. Logos are layout siblings of a
        clipped timeline track that pans via translateX only — so Left/Right never
        slides the channel column over show blocks.
      */}
      <View style={styles.body} onLayout={(e: LayoutChangeEvent) => setBodyH(e.nativeEvent.layout.height)}>
        {bodyH > 0 && (
          <FlashList
            data={preparedRows}
            ref={listRef}
            keyExtractor={(row) => row.channel.id}
            drawDistance={Math.max(480, ROW_H * 8)}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120 }}
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={ACCENT} colors={[ACCENT]} />
              ) : undefined
            }
            renderItem={renderRow}
          />
        )}
        {showNow && bodyH > 0 && (
          <View style={[styles.nowOverlay, { left: LOGO_W }]} pointerEvents="none">
            <Animated.View
              style={{
                width: timelineWidth,
                height: bodyH,
                transform: [{ translateX: negScrollX }],
              }}
            >
              <View style={[styles.nowLine, { left: nowOffset }]} />
            </Animated.View>
          </View>
        )}
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
  timelineClip: {
    flex: 1,
    overflow: "hidden",
    height: "100%",
  },
  timelineTrack: {
    position: "relative",
  },
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
  progReminded: { borderColor: "rgba(250,204,21,0.55)" },
  reminderBadge: {
    position: "absolute",
    top: 2,
    right: 3,
    zIndex: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  programCellFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(91,33,182,0.92)",
  },
  progTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 10 },
  progTime: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.regular, fontSize: 8, marginTop: 1 },
  noData: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 9 },
  nowOverlay: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    zIndex: 3,
  },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: ACCENT, zIndex: 3, pointerEvents: "none" },
});
