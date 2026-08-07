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
import { requestNativeFocus } from "@/src/utils/tvFocus";
import { armGuideBottomFocusLock } from "@/src/utils/tvGuideFocusLock";
import { CHANNEL_NAME_MAX_LINES, getGuideRailMetrics } from "@/src/core/guideLayoutPolicy";
import { evaluateGuideNavigation } from "@/src/core/guideNavigationPolicy";

const HEADER_H = 30;
const ACCENT = "#8B5CF6";
const ACCENT_SOFT = "#F5F3FF";
const REMINDER_BELL = "#FACC15";
const MINUTE_MS = 60_000;
const GUIDE_ESCAPE_GUARD_MS = 220;
const RAPID_VERTICAL_MS = 650;
const PAN_BUCKET_PX = 360;
const HORIZONTAL_PAN_MS = 110;

/** Pin Down on the last guide row so Fire TV can't leap to sidebar Exit. */
function applyDownFocusLock(node: any, locked: boolean) {
  if (!node) return;
  const handle = findNodeHandle(node);
  if (!handle) return;
  try {
    // -1 clears an explicit nextFocusDown after FlashList recycles the row upward.
    node.setNativeProps?.({ nextFocusDown: locked ? handle : -1 });
  } catch {
    /* native props optional on web */
  }
}

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
  numberWidth: number;
  nameFontSize: number;
  nameLineHeight: number;
  horizontalPadding: number;
  itemGap: number;
  timelineWidth: number;
  /** Negated horizontal pan — applied only to the program track, never logos. */
  negScrollX: Animated.AnimatedMultiplication<number> | Animated.AnimatedInterpolation<number>;
  /** Coarse pan bucket (px) — limits which program cells are TV-focusable without per-frame re-renders. */
  panBucket: number;
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
  onFocusNode?: (node: unknown) => void;
  preferInitialFocus?: boolean;
  lockFocusDown?: boolean;
  /** While rapid vertical surfing, keep all program cells focusable (prevents blank/cull thrash). */
  disableProgramCull?: boolean;
  focusedProgramKey?: string | null;
};

type ProgramCellProps = {
  prepared: PreparedProgram;
  programIndex: number;
  channel: Channel;
  isPreferred: boolean;
  preferInitialFocus: boolean;
  hasReminder: boolean;
  tvFocusable: boolean;
  lockFocusDown: boolean;
  capturePreferred: (node: any) => void;
  onFocusNode?: (node: unknown) => void;
  onProgramFocus: (program: PreparedProgram, channel: Channel) => void;
  onProgramPress: (program: Program, channel: Channel) => void;
  onChannelLongPress?: (channel: Channel) => void;
};

function programNearViewport(prepared: PreparedProgram, panBucket: number, viewportW: number) {
  // Keep runway around the current pan bucket so Left/Right still finds neighbors,
  // without leaving the entire multi-hour timeline focusable (that lags TV focus search).
  const pad = Math.max(PAN_BUCKET_PX, viewportW > 0 ? viewportW : 280);
  const left = Math.max(0, panBucket - pad);
  const right = panBucket + Math.max(viewportW, 280) + pad;
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
  lockFocusDown,
  capturePreferred,
  onFocusNode,
  onProgramFocus,
  onProgramPress,
  onChannelLongPress,
}: ProgramCellProps) {
  const cellRef = useRef<any>(null);

  const setRef = useCallback(
    (node: any) => {
      cellRef.current = node;
      if (isPreferred) capturePreferred(node);
      applyDownFocusLock(node, lockFocusDown);
    },
    [capturePreferred, isPreferred, lockFocusDown],
  );

  useEffect(() => {
    applyDownFocusLock(cellRef.current, lockFocusDown);
  }, [lockFocusDown]);

  const handleProgramFocus = useCallback(() => {
    onFocusNode?.(cellRef.current);
    onProgramFocus(prepared, channel);
  }, [onFocusNode, onProgramFocus, prepared, channel]);
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
      ref={setRef}
      onFocus={handleProgramFocus}
      onPress={handleProgramPress}
      onLongPress={handleChannelLongPress}
      delayLongPress={450}
      focusable={tvFocusable}
      hasTVPreferredFocus={false}
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
  numberWidth,
  nameFontSize,
  nameLineHeight,
  horizontalPadding,
  itemGap,
  timelineWidth,
  negScrollX,
  panBucket,
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
  onFocusNode,
  preferInitialFocus = false,
  lockFocusDown = false,
  disableProgramCull = false,
  focusedProgramKey = null,
}: TimelineRowProps) {
  const item = row.channel;
  const preferred = row.programs.find((program) => program.isLive) || row.programs[0];
  const preferredHandleRef = useRef<number | undefined>(undefined);
  const logoPressableRef = useRef<any>(null);

  const capturePreferred = useCallback((node: any) => {
    if (!node) return;
    const handle = findNodeHandle(node) || undefined;
    if (!handle || preferredHandleRef.current === handle) return;
    preferredHandleRef.current = handle;
    // Avoid React setState on every FlashList recycle — poke native props directly.
    try {
      logoPressableRef.current?.setNativeProps?.({ nextFocusRight: handle });
    } catch {}
  }, []);

  const setLogoRef = useCallback(
    (node: any) => {
      logoPressableRef.current = node;
      applyDownFocusLock(node, lockFocusDown);
      if (preferredHandleRef.current) {
        try {
          node?.setNativeProps?.({ nextFocusRight: preferredHandleRef.current });
        } catch {}
      }
    },
    [lockFocusDown],
  );

  useEffect(() => {
    applyDownFocusLock(logoPressableRef.current, lockFocusDown);
  }, [lockFocusDown]);

  const handleChannelPress = useCallback(() => onChannelPress(item), [onChannelPress, item]);
  const handleChannelFocus = useCallback(() => {
    onFocusNode?.(logoPressableRef.current);
    onRowChannelFocus(item, index);
  }, [onFocusNode, onRowChannelFocus, item, index]);
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
          ref={setLogoRef}
          style={({ focused }: any) => [
            styles.logoCell,
            { paddingHorizontal: horizontalPadding, gap: itemGap },
            focused && styles.logoCellFocused,
          ]}
          focusable
          // Prefer the channel logo (left edge) so Right from Live TV lands beside the sidebar,
          // not mid-timeline on the live show cell.
          hasTVPreferredFocus={preferInitialFocus}
          onFocus={handleChannelFocus}
          onPress={handleChannelPress}
          onLongPress={handleChannelLongPress}
          delayLongPress={450}
          testID={`epg-channel-${item.id}`}
        >
          {showChannelNumbers && (
            <Text style={[styles.channelNumber, { width: numberWidth, minWidth: numberWidth }]}>
              {channelNumberById?.[item.id] || index + 1}
            </Text>
          )}
          <ChannelLogo name={item.name} logo={item.logo} disabled={!showChannelLogos} size={logoSize} />
          <Text
            numberOfLines={CHANNEL_NAME_MAX_LINES}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            style={[styles.logoName, { fontSize: nameFontSize, lineHeight: nameLineHeight }]}
          >
            {item.name}
          </Text>
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
            const near = programNearViewport(prepared, panBucket, programViewportW);
            const isPreferred = prepared.key === preferred?.key;
            const keepFocused = focusedProgramKey === prepared.key;
            return (
              <ProgramCell
                key={prepared.key}
                prepared={prepared}
                programIndex={programIndex}
                channel={item}
                isPreferred={isPreferred}
                preferInitialFocus={false}
                hasReminder={!!reminderKeys?.has(reminderKey(item.id, prepared.program.start))}
                tvFocusable={disableProgramCull || near || keepFocused}
                lockFocusDown={lockFocusDown}
                capturePreferred={capturePreferred}
                onFocusNode={onFocusNode}
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

export const TimelineGrid = memo(function TimelineGrid({
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
  onGuideFocusNode,
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
  /** Parent can restore focus after modal close. */
  onGuideFocusNode?: (node: unknown) => void;
}) {
  const { width } = useWindowDimensions();
  const big = width >= 900;
  const railMetrics = getGuideRailMetrics(width, density, showChannelNumbers, showChannelLogos);
  const ROW_H = railMetrics.rowHeight;
  const LOGO_W = railMetrics.railWidth;
  const LOGO_SIZE = railMetrics.logoSize;
  const scrollX = useRef(new Animated.Value(0)).current;
  const negScrollX = useMemo(() => Animated.multiply(scrollX, -1), [scrollX]);
  const panAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const [bodyH, setBodyH] = useState(0);
  const [programViewportW, setProgramViewportW] = useState(0);
  // Coarse pan bucket only — avoids re-rendering every row on each pixel of horizontal pan.
  const [panBucket, setPanBucket] = useState(0);
  // Preferred focus is mount-once only. Group changes must NOT reclaim it (steals chip focus).
  const hasClaimedFocusRef = useRef(false);
  const [preferFirstRow, setPreferFirstRow] = useState(() => !hasClaimedFocusRef.current);
  const listRef = useRef<any>(null);
  const focusRegionRef = useRef<"channel" | "program">("program");
  const focusedRowRef = useRef(0);
  const focusedNodeRef = useRef<unknown>(null);
  const lastRowIndexRef = useRef(0);
  const gridOwnsFocusRef = useRef(false);
  const lastReportedDeepRef = useRef(false);
  const guideEscapeInFlight = useRef(false);
  const escapeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollXRef = useRef(0);
  const lastAxisRef = useRef<"v" | "h" | null>(null);
  const lastAxisAtRef = useRef(0);
  const cullResumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [disableProgramCull, setDisableProgramCull] = useState(false);
  const [focusedProgramKey, setFocusedProgramKey] = useState<string | null>(null);
  const rememberFocusNode = useCallback((node: unknown) => {
    if (node) focusedNodeRef.current = node;
    onGuideFocusNode?.(node);
  }, [onGuideFocusNode]);

  const reportFocusedRow = useCallback(
    (index: number) => {
      focusedRowRef.current = index;
      gridOwnsFocusRef.current = true;
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

  // Geometry is independent of the ticking clock — only live styling needs `now`.
  const preparedRows = useMemo<PreparedRow[]>(() => {
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) {
      return channels.map((channel) => ({ channel, programs: [] }));
    }
    const liveNow = Date.now();
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
          key: `${channel.id}:${program.start}:${program.stop || "open"}`,
          left: ((visibleStart - windowStartMs) / MINUTE_MS) * PX_PER_MIN,
          width: Math.max(24, ((visibleEnd - visibleStart) / MINUTE_MS) * PX_PER_MIN - 3),
          isLive: liveNow >= startMs && liveNow < endMs,
          timeLabel: formatTime(startMs),
        });
      }
      return { channel, programs };
    });
    // Intentionally omit nowMs — a 60s tick must not rebuild the whole guide.
  }, [channels, PX_PER_MIN, windowEndMs, windowStartMs]);

  const nowOffset = Number.isFinite(nowMs) && Number.isFinite(windowStartMs)
    ? ((nowMs - windowStartMs) / MINUTE_MS) * PX_PER_MIN
    : 0;
  const showNow = nowMs > windowStartMs && nowMs < windowEndMs;

  const setHorizontalOffset = useCallback(
    (target: number, animated: boolean) => {
      const next = Math.max(0, target);
      scrollXRef.current = next;
      const bucket = Math.floor(next / PAN_BUCKET_PX) * PAN_BUCKET_PX;
      setPanBucket((prev) => (prev === bucket ? prev : bucket));
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

  // Mount-once preferred focus only — never reclaim on group/reset (that steals chip focus).
  useEffect(() => {
    if (hasClaimedFocusRef.current) return;
    hasClaimedFocusRef.current = true;
    setPreferFirstRow(true);
    const clearPreferred = setTimeout(() => setPreferFirstRow(false), 360);
    return () => clearTimeout(clearPreferred);
  }, []);

  // Group/filter changes: reset scroll position only. Do not touch preferred focus.
  useEffect(() => {
    if (!resetToken) return;
    lastReportedDeepRef.current = false;
    focusedRowRef.current = 0;
    try {
      setHorizontalOffset(0, false);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    } catch {}
  }, [resetToken, setHorizontalOffset]);

  useEffect(
    () => () => {
      if (escapeTimer.current) clearTimeout(escapeTimer.current);
      if (cullResumeTimer.current) clearTimeout(cullResumeTimer.current);
      panAnimRef.current?.stop();
    },
    [],
  );

  useTVEventHandler(
    useCallback(
      (event) => {
        if (!active) return;
        const type = event?.eventType;
        const decision = evaluateGuideNavigation({
          active,
          key: type,
          gridOwnsFocus: gridOwnsFocusRef.current,
          focusRegion: focusRegionRef.current,
          focusedRow: focusedRowRef.current,
          lastRow: lastRowIndexRef.current,
        });
        if (decision.axis === "vertical") {
          lastAxisRef.current = "v";
          lastAxisAtRef.current = Date.now();
          // Keep every on-screen program focusable while holding Up/Down so FlashList
          // culling cannot blank the grid or drop focus mid-surf.
          setDisableProgramCull(true);
          if (cullResumeTimer.current) clearTimeout(cullResumeTimer.current);
          cullResumeTimer.current = setTimeout(() => setDisableProgramCull(false), RAPID_VERTICAL_MS + 80);
        } else if (decision.axis === "horizontal") {
          lastAxisRef.current = "h";
          lastAxisAtRef.current = Date.now();
        }
        if (decision.boundary === "left-boundary") {
          onLeftBoundary?.();
          return;
        }
        // Bottom of guide: keep focus in-grid. Holding Down must never land on Exit.
        if (
          decision.boundary === "bottom-lock"
        ) {
          armGuideBottomFocusLock(focusedNodeRef.current);
          requestNativeFocus(focusedNodeRef.current);
          return;
        }
        // Only escape when the grid currently owns focus — never yank chips/sidebar.
        if (decision.boundary === "top-boundary") {
          if (guideEscapeInFlight.current) return;
          guideEscapeInFlight.current = true;
          gridOwnsFocusRef.current = false;
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
      setFocusedProgramKey(prepared.key);
      keepProgramVisible(prepared, channel);
      if (preferFirstRow && rowIndex !== 0) setPreferFirstRow(false);
    },
    [keepProgramVisible, preferFirstRow, reportFocusedRow],
  );

  const lastRowIndex = Math.max(0, preparedRows.length - 1);
  lastRowIndexRef.current = lastRowIndex;

  const renderRow = useCallback(
    ({ item: row, index }: { item: PreparedRow; index: number }) => (
      <TimelineRow
        row={row}
        index={index}
        rowHeight={ROW_H}
        logoWidth={LOGO_W}
        logoSize={LOGO_SIZE}
        numberWidth={railMetrics.numberWidth}
        nameFontSize={railMetrics.nameFontSize}
        nameLineHeight={railMetrics.nameLineHeight}
        horizontalPadding={railMetrics.horizontalPadding}
        itemGap={railMetrics.itemGap}
        timelineWidth={timelineWidth}
        negScrollX={negScrollX}
        panBucket={panBucket}
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
        onFocusNode={rememberFocusNode}
        preferInitialFocus={preferFirstRow && index === 0}
        lockFocusDown={index >= lastRowIndex}
        disableProgramCull={disableProgramCull}
        focusedProgramKey={focusedProgramKey}
      />
    ),
    [ROW_H, LOGO_W, LOGO_SIZE, railMetrics.numberWidth, railMetrics.nameFontSize, railMetrics.nameLineHeight, railMetrics.horizontalPadding, railMetrics.itemGap, timelineWidth, negScrollX, panBucket, programViewportW, showChannelNumbers, channelNumberById, showChannelLogos, reminderKeys, onChannelPress, onChannelLongPress, onProgramPress, onRowProgramFocus, onRowChannelFocus, preferFirstRow, rememberFocusNode, lastRowIndex, disableProgramCull, focusedProgramKey],
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
            drawDistance={Math.max(360, ROW_H * 6)}
            removeClippedSubviews={false}
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
});

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
    color: ACCENT_SOFT,
    fontFamily: fonts.bold,
    fontSize: 10,
    textAlign: "right",
  },
  logoName: { color: "#fff", fontFamily: fonts.semibold, textAlign: "left", flex: 1, minWidth: 0 },
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
