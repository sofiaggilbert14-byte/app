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
import {
  applyLeftFocusLock,
  armGuideBottomFocusLock,
  armGuideLeftFocusLock,
  focusGuideSurfaceWhenMounted,
  noteGuideChannelFocus,
  registerGuideChannelNode,
} from "@/src/utils/tvGuideFocusLock";
import { getGuideRailMetrics } from "@/src/core/guideLayoutPolicy";
import { evaluateGuideNavigation } from "@/src/core/guideNavigationPolicy";
import { getGuideProgramRowState, useGuidePrograms } from "@/src/core/guideProgramsStore";
import { channelHasEpgMatch } from "@/src/core/epgUserOverrides";
import {
  buildGuideRunwayIds,
  type GuideScanDirection,
} from "@/src/core/guideRunwayPolicy";
import { buildVisibleGuideCellSlice } from "@/src/core/guideCellCulling";
import { createDpadDoubleTapDetector } from "@/src/core/dpadDoubleTap";
import { subscribeVerticalDpadTaps } from "@/src/utils/tvDpadTap";
import { noteGuideRowSlice, noteProgramCellMounted } from "@/src/utils/guidePerfMetrics";

const HEADER_H = 30;
const ACCENT = "#8B5CF6";
const ACCENT_SOFT = "#F5F3FF";
const REMINDER_BELL = "#FACC15";
const MINUTE_MS = 60_000;
const GUIDE_ESCAPE_GUARD_MS = 220;
const RAPID_VERTICAL_MS = 400;
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
  /** 0–1 how far the show has progressed (live cells only; refreshed with channel data). */
  progressRatio: number;
  timeLabel: string;
};

type TimelineRowProps = {
  channel: Channel;
  index: number;
  rowHeight: number;
  logoWidth: number;
  logoSize: number;
  numberWidth: number;
  nameFontSize: number;
  nameLineHeight: number;
  nameMaxLines: 1 | 2;
  horizontalPadding: number;
  itemGap: number;
  timelineWidth: number;
  windowStartMs: number;
  windowEndMs: number;
  currentTimeMs: number;
  pxPerMinute: number;
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
  onRowChannelFocus: (channel: Channel, rowIndex: number, logoNode?: unknown) => void;
  onFocusNode?: (node: unknown) => void;
  preferInitialFocus?: boolean;
  lockFocusDown?: boolean;
  lockFocusLeft?: boolean;
  /** Ref-style getter so FlashList renderItem does not rebuild on every cell focus. */
  getFocusedProgramKey?: () => string | null;
};

type ProgramCellProps = {
  prepared: PreparedProgram;
  programIndex: number;
  channel: Channel;
  isPreferred: boolean;
  hasReminder: boolean;
  tvFocusable: boolean;
  extraCompact: boolean;
  lockFocusDown: boolean;
  capturePreferred: (node: any) => void;
  onFocusNode?: (node: unknown) => void;
  onProgramFocus: (program: PreparedProgram, channel: Channel) => void;
  onProgramBlur?: (programKey: string) => void;
  onProgramPress: (program: Program, channel: Channel) => void;
  onChannelLongPress?: (channel: Channel) => void;
};

function programNearViewport(
  prepared: PreparedProgram,
  panBucket: number,
  viewportW: number,
) {
  // Rendering and focus runways are intentionally separate. FlashList keeps a
  // deep vertical render runway, while Android focus-search sees only the
  // viewport plus a modest horizontal neighbor pad. Making every cell in a
  // six/eight-hour row focusable causes held-D-pad search to stall.
  const viewport = Math.max(280, viewportW || 0);
  const pad = Math.max(PAN_BUCKET_PX / 2, Math.min(360, viewport * 0.3));
  const left = Math.max(0, panBucket - pad);
  const right = panBucket + viewport + pad;
  return prepared.left < right && prepared.left + prepared.width > left;
}

const ProgramCell = memo(function ProgramCell({
  prepared,
  programIndex,
  channel,
  isPreferred,
  hasReminder,
  tvFocusable,
  extraCompact,
  lockFocusDown,
  capturePreferred,
  onFocusNode,
  onProgramFocus,
  onProgramBlur,
  onProgramPress,
  onChannelLongPress,
}: ProgramCellProps) {
  const cellRef = useRef<any>(null);
  useEffect(() => noteProgramCellMounted(), []);

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
    noteGuideChannelFocus(channel.id, cellRef.current);
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
      onBlur={() => onProgramBlur?.(prepared.key)}
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
      {prepared.isLive && prepared.progressRatio > 0 ? (
        <View
          pointerEvents="none"
          style={[styles.progProgressFill, { width: `${Math.round(prepared.progressRatio * 100)}%` }]}
        />
      ) : null}
      <Text numberOfLines={1} style={[styles.progTitle, extraCompact && styles.progTitleExtraCompact]}>{prepared.program.title}</Text>
      <Text numberOfLines={1} style={[styles.progTime, extraCompact && styles.progTimeExtraCompact]}>{prepared.timeLabel}</Text>
    </Pressable>
  );
});

const TimelineRow = memo(function TimelineRow({
  channel: item,
  index,
  rowHeight,
  logoWidth,
  logoSize,
  numberWidth,
  nameFontSize,
  nameLineHeight,
  nameMaxLines,
  horizontalPadding,
  itemGap,
  timelineWidth,
  windowStartMs,
  windowEndMs,
  currentTimeMs,
  pxPerMinute,
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
  lockFocusLeft = true,
  getFocusedProgramKey,
}: TimelineRowProps) {
  const programs = useGuidePrograms(item.id);
  const programRowState = getGuideProgramRowState(item.id);
  const preparedPrograms = useMemo<PreparedProgram[]>(() => {
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) return [];
    const liveNow = currentTimeMs;
    const result: PreparedProgram[] = [];
    for (const program of programs) {
      const startMs = Date.parse(program.start);
      const endMs = program.stop ? Date.parse(program.stop) : startMs + 30 * MINUTE_MS;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
      if (endMs <= windowStartMs || startMs >= windowEndMs) continue;
      const visibleStart = Math.max(startMs, windowStartMs);
      const visibleEnd = Math.min(endMs, windowEndMs);
      const isLive = liveNow >= startMs && liveNow < endMs;
      // Programme times and titles can be corrected by a silent provider
      // refresh. Keep the native Pressable identity tied to its ordered row
      // slot so those metadata corrections do not unmount the focused cell.
      const logicalSlot = result.length;
      result.push({
        program,
        key: `${item.id}:slot:${logicalSlot}`,
        left: ((visibleStart - windowStartMs) / MINUTE_MS) * pxPerMinute,
        width: Math.max(24, ((visibleEnd - visibleStart) / MINUTE_MS) * pxPerMinute - 3),
        isLive,
        progressRatio: isLive ? Math.max(0, Math.min(1, (liveNow - startMs) / (endMs - startMs))) : 0,
        timeLabel: formatTime(startMs),
      });
    }
    return result;
  }, [currentTimeMs, item.id, programs, pxPerMinute, windowEndMs, windowStartMs]);
  const focusedProgramKey = getFocusedProgramKey?.() || null;
  const previousPreparedByKeyRef = useRef(new Map<string, PreparedProgram>());
  const releasedOrphanKeyRef = useRef<string | null>(null);
  const lastFocusedKeyRef = useRef<string | null>(null);
  const [, forceOrphanRelease] = useState(0);
  if (lastFocusedKeyRef.current !== focusedProgramKey) {
    lastFocusedKeyRef.current = focusedProgramKey;
    releasedOrphanKeyRef.current = null;
  }
  const cellOverscan = Math.max(PAN_BUCKET_PX / 2, Math.min(360, Math.max(280, programViewportW) * 0.3));
  const visiblePrograms = useMemo(
    () => buildVisibleGuideCellSlice(
      preparedPrograms,
      panBucket,
      programViewportW || 1,
      cellOverscan,
      focusedProgramKey,
    ),
    [cellOverscan, focusedProgramKey, panBucket, preparedPrograms, programViewportW],
  );
  const orphanedFocusedProgram = focusedProgramKey &&
    !preparedPrograms.some((program) => program.key === focusedProgramKey) &&
    releasedOrphanKeyRef.current !== focusedProgramKey
      ? previousPreparedByKeyRef.current.get(focusedProgramKey)
      : undefined;
  const renderedPrograms = useMemo(() => {
    if (!orphanedFocusedProgram) return visiblePrograms;
    return [...visiblePrograms, { item: orphanedFocusedProgram, sourceIndex: -1 }]
      .sort((a, b) => a.item.left - b.item.left);
  }, [orphanedFocusedProgram, visiblePrograms]);
  for (const program of preparedPrograms) previousPreparedByKeyRef.current.set(program.key, program);
  const preferred =
    renderedPrograms.find(({ item: program }) => program.isLive)?.item ||
    renderedPrograms[0]?.item;
  useEffect(() => {
    noteGuideRowSlice(preparedPrograms.length, renderedPrograms.length);
  }, [preparedPrograms.length, renderedPrograms.length]);
  const preferredHandleRef = useRef<number | undefined>(undefined);
  const logoPressableRef = useRef<any>(null);
  const pendingPressableRef = useRef<any>(null);
  // If EPG arrives while the placeholder owns native focus, preserve that exact
  // Pressable until focus leaves. Replacing a focused native node is the blank /
  // reload / crash chain seen during rapid surfing.
  const [preservePendingFocus, setPreservePendingFocus] = useState(false);

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
      // When unlocked, Left from the logo column must hand off to Play/actions.
      registerGuideChannelNode(item.id, node, { handOffLeftToPreview: !lockFocusLeft });
      // Proactive self-target means the very first Left cannot escape into the
      // closed drawer before the JS boundary handler runs.
      applyLeftFocusLock(node, lockFocusLeft);
      applyDownFocusLock(node, lockFocusDown);
      if (preferredHandleRef.current) {
        try {
          node?.setNativeProps?.({ nextFocusRight: preferredHandleRef.current });
        } catch {}
      }
    },
    [item.id, lockFocusDown, lockFocusLeft],
  );

  useEffect(() => {
    applyLeftFocusLock(logoPressableRef.current, lockFocusLeft);
    applyDownFocusLock(logoPressableRef.current, lockFocusDown);
    applyDownFocusLock(pendingPressableRef.current, lockFocusDown);
  }, [lockFocusDown, lockFocusLeft]);

  const handleChannelPress = useCallback(() => onChannelPress(item), [onChannelPress, item]);
  const handleChannelFocus = useCallback(() => {
    noteGuideChannelFocus(item.id, logoPressableRef.current);
    // Re-wire Left → preview after recycle; Play may have mounted after this row.
    if (!lockFocusLeft) applyLeftFocusLock(logoPressableRef.current, false);
    onFocusNode?.(logoPressableRef.current);
    onRowChannelFocus(item, index, logoPressableRef.current);
  }, [lockFocusLeft, onFocusNode, onRowChannelFocus, item, index]);
  const handleChannelLongPress = useCallback(() => onChannelLongPress?.(item), [onChannelLongPress, item]);
  const handleProgramFocus = useCallback(
    (prepared: PreparedProgram, channel: Channel) => onProgramFocus(prepared, channel, index),
    [onProgramFocus, index],
  );
  const handleProgramBlur = useCallback((programKey: string) => {
    if (programKey !== orphanedFocusedProgram?.key) return;
    releasedOrphanKeyRef.current = programKey;
    forceOrphanRelease((value) => value + 1);
  }, [orphanedFocusedProgram?.key]);
  const setPendingRef = useCallback(
    (node: any) => {
      pendingPressableRef.current = node;
      applyDownFocusLock(node, lockFocusDown);
      const handle = findNodeHandle(node);
      if (handle) {
        try {
          logoPressableRef.current?.setNativeProps?.({ nextFocusRight: handle });
        } catch {}
      }
    },
    [lockFocusDown],
  );
  const handlePendingFocus = useCallback(() => {
    if (preparedPrograms.length === 0) setPreservePendingFocus(true);
    noteGuideChannelFocus(item.id, pendingPressableRef.current);
    onFocusNode?.(pendingPressableRef.current);
    // Keep a stable focus target in the programme column while a row's EPG
    // request is pending. Android can then continue vertical movement instead
    // of losing focus because the destination has no programme Pressable.
    onRowChannelFocus(item, index, pendingPressableRef.current);
  }, [index, item, onFocusNode, onRowChannelFocus, preparedPrograms.length]);
  const handlePendingBlur = useCallback(() => {
    if (preparedPrograms.length > 0) setPreservePendingFocus(false);
  }, [preparedPrograms.length]);

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
            numberOfLines={nameMaxLines}
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
          {renderedPrograms.map(({ item: prepared, sourceIndex: programIndex }) => {
            const near = programNearViewport(
              prepared,
              panBucket,
              programViewportW,
            );
            const isPreferred = prepared.key === preferred?.key;
            const keepFocused = getFocusedProgramKey?.() === prepared.key;
            return (
              <ProgramCell
                key={prepared.key}
                prepared={prepared}
                programIndex={programIndex}
                channel={item}
                isPreferred={isPreferred}
                hasReminder={!!reminderKeys?.has(reminderKey(item.id, prepared.program.start))}
                tvFocusable={near || keepFocused}
                extraCompact={nameMaxLines === 1}
                lockFocusDown={lockFocusDown}
                capturePreferred={capturePreferred}
                onFocusNode={onFocusNode}
                onProgramFocus={handleProgramFocus}
                onProgramBlur={handleProgramBlur}
                onProgramPress={onProgramPress}
                onChannelLongPress={onChannelLongPress}
              />
            );
          })}
          {(preparedPrograms.length === 0 || preservePendingFocus) && (
            <Pressable
              ref={setPendingRef}
              focusable
              onFocus={handlePendingFocus}
              onBlur={handlePendingBlur}
              onPress={handleChannelPress}
              onLongPress={handleChannelLongPress}
              delayLongPress={450}
              style={({ focused }: any) => [
                styles.progCell,
                styles.pendingProgramCell,
                { left: 0, width: Math.max(24, timelineWidth - 6) },
                focused && styles.programCellFocused,
              ]}
              testID={`epg-pending-${item.id}`}
            >
              <Text style={styles.noData}>
                {preparedPrograms.length > 0
                  ? "Guide ready"
                  : programRowState === "loading"
                    ? "Loading programme data"
                    : !channelHasEpgMatch(item)
                      ? "Channel not matched to XMLTV"
                      : "No programme supplied"}
              </Text>
            </Pressable>
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
  onProgramFocus,
  onChannelPress,
  onChannelFocus,
  onChannelLongPress,
  refreshing,
  onRefresh,
  density = "extra_compact",
  showChannelNumbers = false,
  channelNumberById,
  showChannelLogos = true,
  reminderKeys,
  resetToken = 0,
  active = true,
  lockLeftEdge = true,
  onUpBoundary,
  onLeftBoundary,
  onFocusedRowChange,
  onViewportChannelIds,
  onBackTargetChange,
  restoreChannelId,
  focusClaimNonce = 0,
  reduceMotion = false,
}: {
  channels: Channel[];
  windowStart: string;
  windowEnd: string;
  now: string;
  onProgramPress: (p: Program, c: Channel) => void;
  /** Metadata focus is immediate; decoder preview remains parent-delayed. */
  onProgramFocus?: (p: Program, c: Channel) => void;
  onChannelPress: (c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  onChannelLongPress?: (c: Channel) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  density?: "large" | "normal" | "compact" | "extra_compact";
  showChannelNumbers?: boolean;
  channelNumberById?: Record<string, number>;
  showChannelLogos?: boolean;
  reminderKeys?: ReadonlySet<string>;
  resetToken?: number;
  active?: boolean;
  lockLeftEdge?: boolean;
  /** Fired when Up is pressed on the first guide row so focus can exit to group chips. */
  onUpBoundary?: () => void;
  /** Fired when Left is pressed on the channel rail so the preview/actions panel can take focus. */
  onLeftBoundary?: () => void;
  /** Reports the currently focused row index so the parent can relax trapFocusUp on row 0. */
  onFocusedRowChange?: (index: number) => void;
  /** Visible-ish channel ids around the focused row (viewport + overscan) for EPG query scoping. */
  onViewportChannelIds?: (ids: string[], priorityIds?: string[], pageSize?: number) => void;
  /** Tell parent whether focus is on channel logo vs programme (for Back step-left). */
  onBackTargetChange?: (region: "channel" | "program", logoNode: unknown) => void;
  /** Session-only row restore after returning from fullscreen player. */
  restoreChannelId?: string | null;
  /** Bumped after drawer close when restore may have missed — re-prefer guide row. */
  focusClaimNonce?: number;
  /** Snap expensive Guide motion while keeping focus/metadata immediate. */
  reduceMotion?: boolean;
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
  const bodyHRef = useRef(0);
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
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
  const lastViewportBucketRef = useRef("");
  const lastPrefetchIndexRef = useRef(0);
  const scanDirectionRef = useRef<GuideScanDirection>(1);
  const guideEscapeInFlight = useRef(false);
  const escapeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollXRef = useRef(0);
  const lastAxisRef = useRef<"v" | "h" | null>(null);
  const lastAxisAtRef = useRef(0);
  // Ref-only: putting focused key in renderItem deps rebuilt every FlashList row on each cell focus.
  const focusedProgramKeyRef = useRef<string | null>(null);
  const pageJumpDetectorRef = useRef(createDpadDoubleTapDetector());
  const pageJumpAnchorRef = useRef(0);
  const lastGridOwnedAtRef = useRef(0);
  const rememberFocusNode = useCallback((node: unknown) => {
    if (node) focusedNodeRef.current = node;
  }, []);

  const reportFocusedRow = useCallback(
    (index: number) => {
      focusedRowRef.current = index;
      gridOwnsFocusRef.current = true;
      lastGridOwnedAtRef.current = Date.now();
      const rows = channelsRef.current;
      const deep = index > 0;
      if (lastReportedDeepRef.current !== deep) {
        lastReportedDeepRef.current = deep;
        onFocusedRowChange?.(index);
      } else if (index === 0) {
        onFocusedRowChange?.(index);
      }
      if (onViewportChannelIds && rows.length) {
        const visibleRows = Math.max(6, Math.ceil((bodyHRef.current || ROW_H * 6) / ROW_H));
        if (index > lastPrefetchIndexRef.current) scanDirectionRef.current = 1;
        else if (index < lastPrefetchIndexRef.current) scanDirectionRef.current = -1;
        lastPrefetchIndexRef.current = index;
        // Half-page buckets so held surfing refreshes the runway before the
        // focused page fully exits the previous prefetch window.
        const halfPage = Math.max(1, Math.floor(visibleRows / 2));
        const viewportBucket = `${Math.floor(Math.max(0, index) / halfPage)}:${scanDirectionRef.current}`;
        if (lastViewportBucketRef.current === viewportBucket) return;
        lastViewportBucketRef.current = viewportBucket;
        const runway = buildGuideRunwayIds(rows, index, visibleRows, scanDirectionRef.current);
        const pageStart = Math.floor(Math.max(0, index) / visibleRows) * visibleRows;
        const visiblePageIds = rows
          .slice(pageStart, pageStart + visibleRows)
          .map((row) => row.id);
        const priorityIds = [
          rows[index]?.id,
          rows[index + scanDirectionRef.current]?.id,
          rows[index + scanDirectionRef.current * 2]?.id,
          rows[index + scanDirectionRef.current * 3]?.id,
          rows[index + scanDirectionRef.current * 4]?.id,
          ...visiblePageIds,
        ].filter((id): id is string => !!id);
        onViewportChannelIds(runway, priorityIds, visibleRows);
      }
    },
    [ROW_H, onFocusedRowChange, onViewportChannelIds],
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

  useEffect(() => {
    bodyHRef.current = bodyH;
  }, [bodyH]);

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
      if (!animated || reduceMotion) {
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
    [reduceMotion, scrollX],
  );

  // Mount-once preferred focus only — restore the last watched row when tabs
  // were detached by fullscreen navigation.
  useEffect(() => {
    if (hasClaimedFocusRef.current) return;
    if (!channels.length) return;
    hasClaimedFocusRef.current = true;
    const restoreIndex = restoreChannelId
      ? channels.findIndex((channel) => channel.id === restoreChannelId)
      : -1;
    if (restoreIndex >= 0) {
      try {
        listRef.current?.scrollToIndex({ index: restoreIndex, animated: false, viewPosition: 0.45 });
      } catch {}
    }
    setPreferFirstRow(true);
    const clearPreferred = setTimeout(() => setPreferFirstRow(false), 600);
    return () => clearTimeout(clearPreferred);
  }, [channels, restoreChannelId]);

  // Drawer → Guide must re-claim preferred focus even after the mount-once pass.
  useEffect(() => {
    if (!focusClaimNonce || !channels.length) return;
    const restoreIndex = restoreChannelId
      ? channels.findIndex((channel) => channel.id === restoreChannelId)
      : 0;
    if (restoreIndex >= 0) {
      try {
        listRef.current?.scrollToIndex({
          index: Math.max(0, restoreIndex),
          animated: false,
          viewPosition: 0.45,
        });
      } catch {}
    }
    setPreferFirstRow(true);
    const clearPreferred = setTimeout(() => setPreferFirstRow(false), 700);
    focusGuideSurfaceWhenMounted(restoreChannelId || channels[0]?.id, [0, 40, 120, 240, 420]);
    return () => clearTimeout(clearPreferred);
  }, [channels, focusClaimNonce, restoreChannelId]);

  // Group/filter changes: reset scroll position only. Do not touch preferred focus.
  useEffect(() => {
    if (!resetToken) return;
    lastReportedDeepRef.current = false;
    lastViewportBucketRef.current = "";
    lastPrefetchIndexRef.current = 0;
    scanDirectionRef.current = 1;
    focusedRowRef.current = 0;
    try {
      setHorizontalOffset(0, false);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    } catch {}
  }, [resetToken, setHorizontalOffset]);

  useEffect(
    () => () => {
      if (escapeTimer.current) clearTimeout(escapeTimer.current);
      panAnimRef.current?.stop();
    },
    [],
  );

  useEffect(() => {
    if (!active) {
      pageJumpDetectorRef.current.reset();
      return;
    }
    return subscribeVerticalDpadTaps((key) => {
      const ownsFocus = gridOwnsFocusRef.current;
      const recentlyOwned = Date.now() - lastGridOwnedAtRef.current <= 160;
      if (!ownsFocus && !recentlyOwned) {
        pageJumpDetectorRef.current.reset();
        return;
      }
      // FlashList recycle can drop owns-focus for a frame between ultra-fast
      // taps — still feed the detector so the second tap is never discarded.
      if (ownsFocus) lastGridOwnedAtRef.current = Date.now();
      const matched = pageJumpDetectorRef.current.push(key);
      if (!matched) {
        pageJumpAnchorRef.current = focusedRowRef.current;
        return;
      }
      const rows = channelsRef.current;
      if (!rows.length) return;
      const direction: GuideScanDirection = matched === "DOWN" ? 1 : -1;
      const visibleRows = Math.max(1, Math.floor((bodyHRef.current || ROW_H * 6) / ROW_H));
      const target = Math.max(
        0,
        Math.min(rows.length - 1, pageJumpAnchorRef.current + direction * visibleRows),
      );
      scanDirectionRef.current = direction;
      focusedProgramKeyRef.current = null;
      // Jump immediately — do not wait on focus retries for the scroll itself.
      try {
        listRef.current?.scrollToIndex({ index: target, animated: false, viewPosition: 0.1 });
      } catch {}
      reportFocusedRow(target);
      focusGuideSurfaceWhenMounted(rows[target]?.id, [0, 16, 48, 96]);
    });
  }, [ROW_H, active, reportFocusedRow]);

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
        } else if (decision.axis === "horizontal") {
          lastAxisRef.current = "h";
          lastAxisAtRef.current = Date.now();
        }
        // Left edge: hand focus to the fixed preview/actions panel.
        if (decision.boundary === "left-boundary") {
          if (onLeftBoundary) {
            gridOwnsFocusRef.current = false;
            pageJumpDetectorRef.current.reset();
            onLeftBoundary();
            return;
          }
          armGuideLeftFocusLock(focusedNodeRef.current);
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
          pageJumpDetectorRef.current.reset();
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
  }, [programViewportW, setHorizontalOffset, timelineWidth]);

  const onRowChannelFocus = useCallback(
    (channel: Channel, rowIndex: number, logoNode?: unknown) => {
      focusRegionRef.current = "channel";
      focusedProgramKeyRef.current = null;
      reportFocusedRow(rowIndex);
      onChannelFocus?.(channel);
      onBackTargetChange?.("channel", logoNode || focusedNodeRef.current);
    },
    [onBackTargetChange, onChannelFocus, reportFocusedRow],
  );

  const onRowProgramFocus = useCallback(
    (prepared: PreparedProgram, channel: Channel, rowIndex: number) => {
      focusRegionRef.current = "program";
      reportFocusedRow(rowIndex);
      focusedProgramKeyRef.current = prepared.key;
      keepProgramVisible(prepared, channel);
      onProgramFocus?.(prepared.program, channel);
      onBackTargetChange?.("program", null);
    },
    [keepProgramVisible, onBackTargetChange, onProgramFocus, reportFocusedRow],
  );

  const lastRowIndex = Math.max(0, channels.length - 1);
  lastRowIndexRef.current = lastRowIndex;

  const getFocusedProgramKey = useCallback(() => focusedProgramKeyRef.current, []);

  const renderRow = useCallback(
    ({ item: channel, index }: { item: Channel; index: number }) => (
      <TimelineRow
        channel={channel}
        index={index}
        rowHeight={ROW_H}
        logoWidth={LOGO_W}
        logoSize={LOGO_SIZE}
        numberWidth={railMetrics.numberWidth}
        nameFontSize={railMetrics.nameFontSize}
        nameLineHeight={railMetrics.nameLineHeight}
        nameMaxLines={railMetrics.channelNameMaxLines}
        horizontalPadding={railMetrics.horizontalPadding}
        itemGap={railMetrics.itemGap}
        timelineWidth={timelineWidth}
        windowStartMs={windowStartMs}
        windowEndMs={windowEndMs}
        currentTimeMs={nowMs}
        pxPerMinute={PX_PER_MIN}
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
        preferInitialFocus={
          preferFirstRow &&
          (restoreChannelId ? channel.id === restoreChannelId : index === 0)
        }
        lockFocusDown={index >= lastRowIndex}
        lockFocusLeft={lockLeftEdge}
        getFocusedProgramKey={getFocusedProgramKey}
      />
    ),
    [ROW_H, LOGO_W, LOGO_SIZE, railMetrics.numberWidth, railMetrics.nameFontSize, railMetrics.nameLineHeight, railMetrics.channelNameMaxLines, railMetrics.horizontalPadding, railMetrics.itemGap, timelineWidth, windowStartMs, windowEndMs, nowMs, PX_PER_MIN, negScrollX, panBucket, programViewportW, showChannelNumbers, channelNumberById, showChannelLogos, reminderKeys, onChannelPress, onChannelLongPress, onProgramPress, onRowProgramFocus, onRowChannelFocus, preferFirstRow, rememberFocusNode, lastRowIndex, lockLeftEdge, getFocusedProgramKey, restoreChannelId],
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
            {showNow ? (
              <View style={[styles.nowHeaderMark, { left: Math.max(0, nowOffset - 14) }]} pointerEvents="none">
                <Text style={styles.nowHeaderText}>NOW</Text>
                <View style={styles.nowHeaderCaret} />
              </View>
            ) : null}
          </Animated.View>
        </View>
      </View>

      {/*
        No horizontal ScrollView around the body. Logos are layout siblings of a
        clipped timeline track that pans via translateX only — so Left/Right never
        slides the channel column over show blocks.
      */}
      <View
        style={styles.body}
        onLayout={(e: LayoutChangeEvent) => {
          const h = e.nativeEvent.layout.height;
          bodyHRef.current = h;
          setBodyH(h);
        }}
      >
        {bodyH > 0 && (
          <FlashList
            data={channels}
            ref={listRef}
            keyExtractor={(channel) => channel.id}
            drawDistance={Math.max(2200, ROW_H * 36)}
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
          <View
            style={[styles.nowOverlay, { left: LOGO_W }]}
            pointerEvents="none"
            testID="epg-timeline-now-indicator"
            accessibilityLabel="Guide timeline progress indicator"
          >
            <Animated.View
              style={{
                width: timelineWidth,
                height: bodyH,
                transform: [{ translateX: negScrollX }],
              }}
            >
              <View style={[styles.nowLineTrack, { left: Math.max(0, nowOffset - 1) }]}>
                <View style={styles.nowLine} />
              </View>
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
  pendingProgramCell: {
    borderStyle: "dashed",
    borderColor: "rgba(196,181,253,0.28)",
    backgroundColor: "rgba(24,23,42,0.50)",
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
  progTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 10, zIndex: 1 },
  progTitleExtraCompact: { fontSize: 8.8, lineHeight: 10.5 },
  progTime: { color: "rgba(255,255,255,0.72)", fontFamily: fonts.regular, fontSize: 8, marginTop: 1, zIndex: 1 },
  progTimeExtraCompact: { fontSize: 6.8, lineHeight: 8 },
  progProgressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(168,85,247,0.38)",
    zIndex: 0,
  },
  noData: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 9 },
  nowOverlay: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    zIndex: 3,
  },
  nowLineTrack: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
    alignItems: "center",
    zIndex: 3,
  },
  nowLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#F472B6",
  },
  nowHeaderMark: {
    position: "absolute",
    top: 2,
    width: 28,
    alignItems: "center",
    zIndex: 4,
  },
  nowHeaderText: {
    color: "#F9A8D4",
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  nowHeaderCaret: {
    marginTop: 1,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#F472B6",
  },
});
