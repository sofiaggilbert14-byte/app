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
  noteGuideProgramFocus,
  registerGuideProgramNode,
  noteGuideChannelFocus,
  registerGuideChannelNode,
  wireGuideTopBoundary,
} from "@/src/utils/tvGuideFocusLock";
import { getGuideRailMetrics } from "@/src/core/guideLayoutPolicy";
import { clampGuideScrollOffset, evaluateGuideNavigation } from "@/src/core/guideNavigationPolicy";
import { getGuideProgramRowState, useGuidePrograms } from "@/src/core/guideProgramsStore";
import { channelHasEpgMatch } from "@/src/core/epgUserOverrides";
import {
  buildGuideRunwayIds,
  type GuideScanDirection,
} from "@/src/core/guideRunwayPolicy";
import { buildVisibleGuideCellSlice } from "@/src/core/guideCellCulling";
import { noteGuideRowSlice, noteProgramCellMounted } from "@/src/utils/guidePerfMetrics";
import { addGuidePageKeyListener } from "@/src/utils/tvRemote";

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
  /** 0â€“1 how far the show has progressed (live cells only; refreshed with channel data). */
  progressRatio: number;
  timeLabel: string;
};

type FocusCandidate = {
  key: string;
  node: any;
  kind: "channel" | "program";
  left: number;
  width: number;
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
  /** Negated horizontal pan shared by channel identity and programme cells. */
  negScrollX: Animated.AnimatedMultiplication<number> | Animated.AnimatedInterpolation<number>;
  /** Coarse pan bucket (px) â€” limits which program cells are TV-focusable without per-frame re-renders. */
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
  onRowPendingFocus: (channel: Channel, rowIndex: number, node?: unknown) => void;
  onFocusNode?: (node: unknown) => void;
  registerFocusCandidate: (rowIndex: number, candidate: FocusCandidate | null, key: string) => void;
  wireFocusCandidate: (rowIndex: number, key: string, node: unknown) => void;
  preferInitialFocus?: boolean;
  lockFocusDown?: boolean;
  lockFocusLeft?: boolean;
  /** Ref-style getter so FlashList renderItem does not rebuild on every cell focus. */
  getFocusedProgramKey?: () => string | null;
};

type ProgramCellProps = {
  prepared: PreparedProgram;
  rowIndex: number;
  programIndex: number;
  channel: Channel;
  isPreferred: boolean;
  hasReminder: boolean;
  tvFocusable: boolean;
  extraCompact: boolean;
  lockFocusDown: boolean;
  capturePreferred: (node: any) => void;
  registerFocusCandidate: (rowIndex: number, candidate: FocusCandidate | null, key: string) => void;
  wireFocusCandidate: (rowIndex: number, key: string, node: unknown) => void;
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
  rowIndex,
  programIndex,
  channel,
  isPreferred,
  hasReminder,
  tvFocusable,
  extraCompact,
  lockFocusDown,
  capturePreferred,
  registerFocusCandidate,
  wireFocusCandidate,
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
      const previous = cellRef.current;
      if (previous && previous !== node) registerFocusCandidate(rowIndex, null, prepared.key);
      cellRef.current = node;
      registerGuideProgramNode(channel.id, prepared.program.start, node);
      registerFocusCandidate(
        rowIndex,
        node ? { key: prepared.key, node, kind: "program", left: prepared.left, width: prepared.width } : null,
        prepared.key,
      );
      if (isPreferred) capturePreferred(node);
      applyDownFocusLock(node, lockFocusDown);
    },
    [capturePreferred, channel.id, isPreferred, lockFocusDown, prepared, registerFocusCandidate, rowIndex],
  );

  useEffect(() => {
    applyDownFocusLock(cellRef.current, lockFocusDown);
  }, [lockFocusDown]);

  const handleProgramFocus = useCallback(() => {
    noteGuideProgramFocus(channel.id, cellRef.current);
    onFocusNode?.(cellRef.current);
    onProgramFocus(prepared, channel);
    // The row callback scrolls first. Wire vertical neighbors afterwards so an
    // upward move never keeps a pre-scroll, missing target.
    wireFocusCandidate(rowIndex, prepared.key, cellRef.current);
  }, [channel, onFocusNode, onProgramFocus, prepared, rowIndex, wireFocusCandidate]);
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
  onRowPendingFocus,
  onFocusNode,
  registerFocusCandidate,
  wireFocusCandidate,
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
  // Bound orphan lookup memory: keep current prepared keys + focused orphan only.
  {
    const keepKeys = new Set(preparedPrograms.map((program) => program.key));
    if (focusedProgramKey) keepKeys.add(focusedProgramKey);
    for (const key of Array.from(previousPreparedByKeyRef.current.keys())) {
      if (!keepKeys.has(key)) previousPreparedByKeyRef.current.delete(key);
    }
  }
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
  const pendingLeft = Math.max(0, Math.min(panBucket, Math.max(0, timelineWidth - 24)));
  const pendingWidth = Math.max(
    24,
    Math.min(
      Math.max(48, programViewportW - 6),
      Math.max(24, timelineWidth - pendingLeft),
    ),
  );

  const capturePreferred = useCallback((node: any) => {
    if (!node) return;
    const handle = findNodeHandle(node) || undefined;
    if (!han×M7âÚ$z{-®éÜj×v–öã¢fö7W5&Vv–öå&Vbæ7W'&VçBÀ¢fö7W6VE&÷s¢fö7W6VE&÷u&Vbæ7W'&VçBÀ¢Æ7E&÷s¢Æ7E&÷t–æFW…&Vbæ7W'&VçBÀ¢Ò“°¢–b†FV6—6–öâæ†—2ÓÓÒ'fW'F–6Â"’°¢Æ7D†—5&Vbæ7W'&VçBÒ'b#°¢Æ7D†—4E&Vbæ7W'&VçBÒFFRææ÷r‚“°¢ÒVÇ6R–b†FV6—6–öâæ†—2ÓÓÒ&†÷&—¦öçFÂ"’°¢Æ7D†—5&Vbæ7W'&VçBÒ&‚#°¢Æ7D†—4E&Vbæ7W'&VçBÒFFRææ÷r‚“°¢Ğ¢òòÆVgBVFvS¢†æBfö7W2FòF†Rf—†VB&Wf–Wrö7F–öç2æVÂà¢–b†FV6—6–öâæ&÷VæF'’ÓÓÒ&ÆVgBÖ&÷VæF'’"’°¢–b†öäÆVgD&÷VæF'’’°¢w&–D÷vç4fö7W5&Vbæ7W'&VçBÒfÇ6S°¢öäÆVgD&÷VæF'’‚“°¢&WGW&ã°¢Ğ¢&ÔwV–FTÆVgDfö7W4Æö6²†fö7W6VDæöFU&Vbæ7W'&VçB“°¢&WGW&ã°¢Ğ¢òò&÷GFöÒöbwV–FS¢¶VWfö7W2–âÖw&–Bâ†öÆF–ærF÷vâ×W7BæWfW"ÆæBöâW†—Bà¢–b€¢FV6—6–öâæ&÷VæF'’ÓÓÒ&&÷GFöÒÖÆö6² ¢’°¢&ÔwV–FT&÷GFöÔfö7W4Æö6²†fö7W6VDæöFU&Vbæ7W'&VçB“°¢&WVW7DæF—fTfö7W2†fö7W6VDæöFU&Vbæ7W'&VçB“°¢&WGW&ã°¢Ğ¢òòöæÇ’W66Rv†VâF†Rw&–B7W'&VçFÇ’÷vç2fö7W2(	BæWfW"–æ²6†—2÷6–FV&"à¢–b†FV6—6–öâæ&÷VæF'’ÓÓÒ'F÷Ö&÷VæF'’"’°¢–b†wV–FTW66T–äfÆ–v‡Bæ7W'&VçB’&WGW&ã°¢wV–FTW66T–äfÆ–v‡Bæ7W'&VçBÒG'VS°¢w&–D÷vç4fö7W5&Vbæ7W'&VçBÒfÇ6S°¢öåW&÷VæF'“òâ‚“°¢–b†W66UF–ÖW"æ7W'&VçB’6ÆV%F–ÖV÷WB†W66UF–ÖW"æ7W'&VçB“°¢W66UF–ÖW"æ7W'&VçBÒ6WEF–ÖV÷WB‚‚’Óâ°¢wV–FTW66T–äfÆ–v‡Bæ7W'&VçBÒfÇ6S°¢ÒÂuT”DUôU44UôuT$EôÕ2“°¢Ğ¢ÒÀ¢¶7F—fRÂöäÆVgD&÷VæF'’ÂöåW&÷VæF'•ÒÀ¢’À¢“° ¢6öç7B¶VW&öw&Õf—6–&ÆRÒW6T6ÆÆ&6²‚‡&W&VC¢&W&VE&öw&ÒÂ6†ææVÃ¢6†ææVÂ’Óâ°¢fö7W5&Vv–öå&Vbæ7W'&VçBÒ'&öw&Ò#°¢–b‚&öw&Õf–Ww÷'Er’&WGW&ã° ¢òòGW&–ær&–BfW'F–6Â7W&f–ærÂæWfW"6†6R†÷&—¦öçFÆÇ’(	BF†BG&–gG2fö7W2&–v‡Bà¢6öç7B&–EfW'F–6ÂĞ¢Æ7D†—5&Vbæ7W'&VçBÓÓÒ'b"bbFFRææ÷r‚’ÒÆ7D†—4E&Vbæ7W'&VçBÂ$”EõdU%D”4ÅôÕ3°¢–b‡&–EfW'F–6Â’&WGW&ã° ¢6öç7BÖ&v–âÒƒ°¢6öç7B7W'&VçE‚Ò67&öÆÅ…&Vbæ7W'&VçC°¢6öç7BÆVgDVFvRÒÄôtõõr²&W&VBæÆVgC°¢6öç7B&–v‡DVFvRÒÄôtõõr²&W&VBæÆVgB²&W&VBçv–GFƒ°¢ÆWBF&vWBÒ7W'&VçEƒ° ¢–b†ÆVgDVFvRÂ7W'&VçE‚²Ö&v–â’°¢F&vWBÒÖF‚æÖ‚ƒÂÆVgDVFvRÒÖ&v–â“°¢ÒVÇ6R–b‡&–v‡DVFvRâ7W'&VçE‚²&öw&Õf–Ww÷'ErÒÖ&v–â’°¢F&vWBÒÖF‚æÖ‚ƒÂ&–v‡DVFvRÒ&öw&Õf–Ww÷'Er²Ö&v–â“°¢Ğ ¢6öç7BÖ…‚ÒÖF‚æÖ‚ƒÂÄôtõõr²F–ÖVÆ–æUv–GF‚Ò&öw&Õf–Ww÷'Er“°¢F&vWBÒÖF‚æÖ–â†Ö…‚ÂF&vWB“°¢–b„ÖF‚æ'2‡F&vWBÒ7W'&VçE‚’ÃÒ‚’&WGW&ã° ¢òòfö7W2ÖG&—fVâç2×W7B6öÖÖ—B&Vf÷&RF†RæW‡B&VÖ÷FR&WVBâ&W7F'F–ær¢òò×2æ–ÖF–öâWfW'’ãC‚×2ÆVfW2F†Rfö7W6VBæF—fR6VÆÂöfb×67&VVà¢òòVçF–ÂF†R¶W’—2&VÆV6VBÂv†–6‚Æöö·2Æ–¶RF—6V&–ærfö7W2à¢6WD†÷&—¦öçFÄöfg6WB‡F&vWBÂfÇ6R“°¢ÒÂ´ÄôtõõrÂ&öw&Õf–Ww÷'ErÂ6WD†÷&—¦öçFÄöfg6WBÂF–ÖVÆ–æUv–GF…Ò“° ¢6öç7Böå&÷t6†ææVÄfö7W2ÒW6T6ÆÆ&6²€¢†6†ææVÃ¢6†ææVÂÂ&÷t–æFWƒ¢çVÖ&W"ÂÆövôæöFSó¢Væ¶æ÷vâ’Óâ°¢fö7W5&Vv–öå&Vbæ7W'&VçBÒ&6†ææVÂ#°¢fö7W6VE&öw&Ô¶W•&Vbæ7W'&VçBÒçVÆÃ°¢fW'F–6Äfö7W4æ6†÷%&Vbæ7W'&VçBÒçVÆÃ°¢òò6†ææVÂæöFR×W7BæWfW"&WF–âfö7W2v†–ÆRG&ç6ÆFVBöfb×67&VVâà¢–b‡67&öÆÅ…&Vbæ7W'&VçBâB’6WD†÷&—¦öçFÄöfg6WBƒÂfÇ6R“°¢&W÷'Dfö7W6VE&÷r‡&÷t–æFW‚“°¢öä6†ææVÄfö7W3òâ†6†ææVÂ“°¢öä&6µF&vWD6†ævSòâ‚&6†ææVÂ"ÂÆövôæöFRÇÂfö7W6VDæöFU&Vbæ7W'&VçB“°¢ÒÀ¢¶öä&6µF&vWD6†ævRÂöä6†ææVÄfö7W2Â&W÷'Dfö7W6VE&÷rÂ6WD†÷&—¦öçFÄöfg6WEÒÀ¢“° ¢6öç7Böå&÷u&öw&Ôfö7W2ÒW6T6ÆÆ&6²€¢‡&W&VC¢&W&VE&öw&ÒÂ6†ææVÃ¢6†ææVÂÂ&÷t–æFWƒ¢çVÖ&W"’Óâ°¢fö7W5&Vv–öå&Vbæ7W'&VçBÒ'&öw&Ò#°¢fW'F–6Äfö7W4æ6†÷%&Vbæ7W'&VçBÒ&W&VBæÆVgB²&W&VBçv–GF‚ò#°¢6öç7BÖ÷fVEfW'F–6ÆÇ’Òw&–D÷vç4fö7W5&Vbæ7W'&VçBbb&÷t–æFW‚ÓÒfö7W6VE&÷u&Vbæ7W'&VçC°¢&W÷'Dfö7W6VE&÷r‡&÷t–æFW‚“°¢fö7W6VE&öw&Ô¶W•&Vbæ7W'&VçBÒ&W&VBæ¶W“°¢òòfW'F–6Âfö7W2Ö÷fR×W7B&W6W'fRF†R6†&VBF–ÖR6öÇVÖâW†7FÇ’à¢òòæWfW"ÆWBWfVçBÖ÷&FW"F–ffW&Væ6W2&WGvVVâæF—fRfö7W2æB¥2¶W¢òò†æFÆW'26öçfW'BWôF÷vâ–çFòâ66–FVçFÂ†÷&—¦öçFÂâà¢–b‚Ö÷fVEfW'F–6ÆÇ’’¶VW&öw&Õf—6–&ÆR‡&W&VBÂ6†ææVÂ“°¢öå&öw&Ôfö7W3òâ‡&W&VBç&öw&ÒÂ6†ææVÂ“°¢öä&6µF&vWD6†ævSòâ‚'&öw&Ò"ÂçVÆÂ“°¢ÒÀ¢¶¶VW&öw&Õf—6–&ÆRÂöä&6µF&vWD6†ævRÂöå&öw&Ôfö7W2Â&W÷'Dfö7W6VE&÷uÒÀ¢“° ¢6öç7Böå&÷uVæF–ætfö7W2ÒW6T6ÆÆ&6²€¢†6†ææVÃ¢6†ææVÂÂ&÷t–æFWƒ¢çVÖ&W"’Óâ°¢fö7W5&Vv–öå&Vbæ7W'&VçBÒ'&öw&Ò#°¢fö7W6VE&öw&Ô¶W•&Vbæ7W'&VçBÒçVÆÃ°¢&W÷'Dfö7W6VE&÷r‡&÷t–æFW‚“°¢öä6†ææVÄfö7W3òâ†6†ææVÂ“°¢öä&6µF&vWD6†ævSòâ‚'&öw&Ò"ÂçVÆÂ“°¢ÒÀ¢¶öä&6µF&vWD6†ævRÂöä6†ææVÄfö7W2Â&W÷'Dfö7W6VE&÷uÒÀ¢“° ¢6öç7B&VæFW$G&tF—7Fæ6RÒ66†U&öf–ÆRÓÓÒ'vV² ¢òÖF‚æÖ‚ƒ#CÂ$õuô‚¢B¢¢66†U&öf–ÆRÓÓÒ&Ö…÷&Wf–Wr ¢òÖF‚æÖ‚ƒCƒÂ$õuô‚¢‚¢¢ÖF‚æÖ‚ƒ3cÂ$õuô‚¢b“° ¢6öç7BÆ7E&÷t–æFW‚ÒÖF‚æÖ‚ƒÂ6†ææVÇ2æÆVæwF‚Ò“°¢Æ7E&÷t–æFW…&Vbæ7W'&VçBÒÆ7E&÷t–æFWƒ° ¢6öç7BvWDfö7W6VE&öw&Ô¶W’ÒW6T6ÆÆ&6²‚‚’Óâfö7W6VE&öw&Ô¶W•&Vbæ7W'&VçBÂµÒ“° ¢6öç7B&VæFW%&÷rÒW6T6ÆÆ&6²€¢‡²—FVÓ¢6†ææVÂÂ–æFW‚Ó¢²—FVÓ¢6†ææVÃ²–æFWƒ¢çVÖ&W"Ò’Óâ€¢ÅF–ÖVÆ–æU&÷p¢6†ææVÃ×¶6†ææVÇĞ¢–æFWƒ×¶–æFW‡Ğ¢&÷t†V–v‡C×µ$õuô‡Ğ¢Æövõv–GFƒ×´ÄôtõõwĞ¢Æövõ6—¦S×´Äôtõõ4•¤WĞ¢çVÖ&W%v–GFƒ×·&–ÄÖWG&–72æçVÖ&W%v–GF‡Ğ¢æÖTföçE6—¦S×·&–ÄÖWG&–72ææÖTföçE6—¦WĞ¢æÖTÆ–æT†V–v‡C×·&–ÄÖWG&–72ææÖTÆ–æT†V–v‡GĞ¢æÖTÖ„Æ–æW3×·&–ÄÖWG&–72æ6†ææVÄæÖTÖ„Æ–æW7Ğ¢†÷&—¦öçFÅFF–æs×·&–ÄÖWG&–72æ†÷&—¦öçFÅFF–æwĞ¢—FVÔv×·&–ÄÖWG&–72æ—FVÔvĞ¢F–ÖVÆ–æUv–GFƒ×·F–ÖVÆ–æUv–GF‡Ğ¢v–æF÷u7F'D×3×·v–æF÷u7F'D×7Ğ¢v–æF÷tVæD×3×·v–æF÷tVæD×7Ğ¢7W'&VçEF–ÖT×3×¶æ÷t×7Ğ¢…W$Ö–çWFS×µ…õU%ôÔ”çĞ¢æVu67&öÆÅƒ×¶æVu67&öÆÅ‡Ğ¢ä'V6¶WC×·ä'V6¶WGĞ¢&öw&Õf–Ww÷'Es×·&öw&Õf–Ww÷'EwĞ¢6†÷t6†ææVÄçVÖ&W'3×·6†÷t6†ææVÄçVÖ&W'7Ğ¢6†ææVÄçVÖ&W$'”–C×¶6†ææVÄçVÖ&W$'”–GĞ¢6†÷t6†ææVÄÆöv÷3×·6†÷t6†ææVÄÆöv÷2bb6†ææVÅ&–Åf—6–&ÆWĞ¢&VÖ–æFW$¶W—3×·&VÖ–æFW$¶W—7Ğ¢öä6†ææVÅ&W73×¶öä6†ææVÅ&W77Ğ¢öä6†ææVÄÆöæu&W73×¶öä6†ææVÄÆöæu&W77Ğ¢öå&öw&Õ&W73×¶öå&öw&Õ&W77Ğ¢öå&öw&Ôfö7W3×¶öå&÷u&öw&Ôfö7W7Ğ¢öå&÷t6†ææVÄfö7W3×¶öå&÷t6†ææVÄfö7W7Ğ¢öå&÷uVæF–ætfö7W3×¶öå&÷uVæF–ætfö7W7Ğ¢öäfö7W4æöFS×·&VÖVÖ&W$fö7W4æöFWĞ¢&Vv—7FW$fö7W46æF–FFS×·&Vv—7FW$fö7W46æF–FFWĞ¢v—&Tfö7W46æF–FFS×·v—&Tfö7W46æF–FFWĞ¢&VfW$–æ—F–Äfö7W3×°¢&VfW$f—'7E&÷rb`¢‡&W7F÷&T6†ææVÄ–Bò6†ææVÂæ–BÓÓÒ&W7F÷&T6†ææVÄ–B¢–æFW‚ÓÓÒ¢Ğ¢Æö6´fö7W4F÷vã×¶–æFW‚ãÒÆ7E&÷t–æFW‡Ğ¢Æö6´fö7W4ÆVgC×¶Æö6´ÆVgDVFvWĞ¢vWDfö7W6VE&öw&Ô¶W“×¶vWDfö7W6VE&öw&Ô¶W—Ğ¢óà¢’À¢µ$õuô‚ÂÄôtõõrÂÄôtõõ4•¤RÂ&–ÄÖWG&–72æçVÖ&W%v–GF‚Â&–ÄÖWG&–72ææÖTföçE6—¦RÂ&–ÄÖWG&–72ææÖTÆ–æT†V–v‡BÂ&–ÄÖWG&–72æ6†ææVÄæÖTÖ„Æ–æW2Â&–ÄÖWG&–72æ†÷&—¦öçFÅFF–ærÂ&–ÄÖWG&–72æ—FVÔvÂF–ÖVÆ–æUv–GF‚Âv–æF÷u7F'D×2Âv–æF÷tVæD×2Âæ÷t×2Â…õU%ôÔ”âÂæVu67&öÆÅ‚Âä'V6¶WBÂ&öw&Õf–Ww÷'ErÂ6†÷t6†ææVÄçVÖ&W'2Â6†ææVÄçVÖ&W$'”–BÂ6†÷t6†ææVÄÆöv÷2Â6†ææVÅ&–Åf—6–&ÆRÂ&VÖ–æFW$¶W—2Âöä6†ææVÅ&W72Âöä6†ææVÄÆöæu&W72Âöå&öw&Õ&W72Âöå&÷u&öw&Ôfö7W2Âöå&÷t6†ææVÄfö7W2Âöå&÷uVæF–ætfö7W2Â&VfW$f—'7E&÷rÂ&VÖVÖ&W$fö7W4æöFRÂ&Vv—7FW$fö7W46æF–FFRÂv—&Tfö7W46æF–FFRÂÆ7E&÷t–æFW‚ÂÆö6´ÆVgDVFvRÂvWDfö7W6VE&öw&Ô¶W’Â&W7F÷&T6†ææVÄ–EÒÀ¢“° ¢&WGW&â€¢Åf–Wr7G–ÆS×·7G–ÆW2çw&ÒFW7D”CÒ&Wr×F–ÖVÆ–æRÖw&–B#à¢Åf–Wr7G–ÆS×·7G–ÆW2æ†VFW%&÷wÓà¢Åf–Wr7G–ÆS×·7G–ÆW2æ†VFW%f–Ww÷'GĞ¢öäÆ–÷WC×²†WfVçB’Óâ6WE&öw&Õf–Ww÷'Er†WfVçBææF—fTWfVçBæÆ–÷WBçv–GF‚—Óà¢Äæ–ÖFVBåf–Wr7G–ÆS×µ·7G–ÆW2æ†VFW%åG&6²À¢²v–GFƒ¢Äôtõõr²F–ÖVÆ–æUv–GF‚ÂG&ç6f÷&Ó¢·²G&ç6ÆFUƒ¢æVu67&öÆÅ‚ÕÒÕ×Óà¢Åf–Wr7G–ÆS×µ·7G–ÆW2æ6÷&æW"Â²v–GFƒ¢ÄôtõõrÕ×Óà¢ÅFW‡B7G–ÆS×·7G–ÆW2æ6÷&æW%FW‡GÓç¶F–§2‡v–æF÷u7F'B’æf÷&ÖB‚$ÔÔÒB"—ÓÂõFW‡Cà¢Âõf–Wsà¢Åf–Wr7G–ÆS×µ·7G–ÆW2æ†VFW%G&6²Â²v–GFƒ¢F–ÖVÆ–æUv–GF‚Õ×Óà¢·F–6·2æÖ‚‡F–6²’Óâ€¢ÅFW‡B¶W“×·F–6²æ¶W—Ò7G–ÆS×µ·7G–ÆW2çF–6´Æ&VÂÂ²ÆVgC¢F–6²æÆVgBÕ×Óç·F–6²æÆ&VÇÓÂõFW‡Cà¢’—Ğ¢·6†÷tæ÷rò€¢Åf–Wr7G–ÆS×µ·7G–ÆW2ææ÷t†VFW$Ö&²Â²ÆVgC¢ÖF‚æÖ‚ƒÂæ÷töfg6WBÒB’Õ×Òö–çFW$WfVçG3Ò&æöæR#à¢ÅFW‡B7G–ÆS×·7G–ÆW2ææ÷t†VFW%FW‡GÓääõsÂõFW‡Cà¢Åf–Wr7G–ÆS×·7G–ÆW2ææ÷t†VFW$6&WGÒóà¢Âõf–Wsà¢’¢çVÆÇĞ¢Âõf–Wsà¢Âôæ–ÖFVBåf–Wsà¢Âõf–Wsà¢Âõf–Wsà ¢²ò¢6†ææVÂ–FVçF—G’æB&öw&ÖÖR6VÆÇ26†&RöæR†÷&—¦öçFÂâG&6²â¢÷Ğ¢Åf–Wp¢7G–ÆS×·7G–ÆW2æ&öG—Ğ¢öäÆ–÷WC×²†S¢Æ–÷WD6†ævTWfVçB’Óâ°¢6öç7B‚ÒRææF—fTWfVçBæÆ–÷WBæ†V–v‡C°¢&öG”…&Vbæ7W'&VçBÒƒ°¢6WD&öG”‚†‚“°¢×Ğ¢à¢¶&öG”‚âbb€¢ÄfÆ6„Æ—7@¢FF×¶6†ææVÇ7Ğ¢&Vc×¶Æ—7E&VgĞ¢¶W”W‡G&7F÷#×²†6†ææVÂ’Óâ6†ææVÂæ–GĞ¢G&tF—7Fæ6S×·&VæFW$G&tF—7Fæ6WĞ¢&VÖ÷fT6Æ—VE7V'f–Ww3×¶fÇ6WĞ¢öå67&öÆÃ×¶öåfW'F–6Å67&öÆÇĞ¢67&öÆÄWfVçEF‡&÷GFÆS×³3'Ğ¢6†÷w5fW'F–6Å67&öÆÄ–æF–6F÷#×¶fÇ6WĞ¢÷fW%67&öÆÄÖöFSÒ&æWfW" ¢&Vg&W6„6öçG&öÃ×°¢öå&Vg&W6‚ò€¢Å&Vg&W6„6öçG&öÂ&Vg&W6†–æs×²&Vg&W6†–æwÒöå&Vg&W6ƒ×¶öå&Vg&W6‡ÒF–çD6öÆ÷#×´44TåGÒ6öÆ÷'3×µ´44TåE×Òóà¢’¢VæFVf–æV@¢Ğ¢&VæFW$—FVÓ×·&VæFW%&÷wĞ¢óà¢—Ğ¢·6†÷tæ÷rbb&öG”‚âbb€¢Åf–Wp¢7G–ÆS×·7G–ÆW2ææ÷t÷fW&Æ—Ğ¢ö–çFW$WfVçG3Ò&æöæR ¢FW7D”CÒ&Wr×F–ÖVÆ–æRÖæ÷rÖ–æF–6F÷" ¢66W76–&–Æ—G”Æ&VÃÒ$wV–FRF–ÖVÆ–æR&öw&W72–æF–6F÷" ¢à¢Äæ–ÖFVBåf–Wp¢7G–ÆS×·°¢v–GFƒ¢Äôtõõr²F–ÖVÆ–æUv–GF‚À¢†V–v‡C¢&öG”‚À¢G&ç6f÷&Ó¢·²G&ç6ÆFUƒ¢æVu67&öÆÅ‚ÕÒÀ¢×Ğ¢à¢Åf–Wr7G–ÆS×µ·7G–ÆW2ææ÷tÆ–æUG&6²Â²ÆVgC¢ÖF‚æÖ‚ƒÂÄôtõõr²æ÷töfg6WBÒ’Õ×Óà¢Åf–Wr7G–ÆS×·7G–ÆW2ææ÷tÆ–æWÒóà¢Âõf–Wsà¢Âôæ–ÖFVBåf–Wsà¢Âõf–Wsà¢—Ğ¢Âõf–Wsà¢Âõf–Wsà¢“°§Ò“° ¦6öç7B7G–ÆW2Ò7G–ÆU6†VWBæ7&VFR‡°¢w&¢²fÆWƒ¢Â÷fW&fÆ÷s¢&†–FFVâ"ÒÀ¢&öG“¢²fÆWƒ¢Â÷fW&fÆ÷s¢&†–FFVâ"ÒÀ¢†VFW%&÷s¢°¢fÆW„F—&V7F–öã¢'&÷r"À¢÷fW&fÆ÷s¢&†–FFVâ"À¢&÷&FW$&÷GFöÕv–GFƒ¢À¢&÷&FW$&÷GFöÔ6öÆ÷#¢Gd6öÆ÷'2æÆ–æRÀ¢&6¶w&÷VæD6öÆ÷#¢'&v&ƒ’Ã‚Ã#Ãã“‚’"À¢ÒÀ¢6÷&æW#¢°¢†V–v‡C¢„TDU%ô‚À¢Æ–vä—FV×3¢&6VçFW""À¢§W7F–g”6öçFVçC¢&6VçFW""À¢&÷&FW%&–v‡Ev–GFƒ¢À¢&÷&FW%&–v‡D6öÆ÷#¢Gd6öÆ÷'2æÆ–æRÀ¢&6¶w&÷VæD6öÆ÷#¢"3ss"À¢¤–æFWƒ¢#À¢VÆWfF–öã¢‚À¢÷fW&fÆ÷s¢&†–FFVâ"À¢ÒÀ¢6÷&æW%FW‡C¢²6öÆ÷#¢44TåEõ4ôeBÂföçDfÖ–Ç“¢föçG2æ&öÆBÂföçE6—¦S¢ÒÀ¢†VFW%f–Ww÷'C¢²fÆWƒ¢Â†V–v‡C¢„TDU%ô‚Â÷fW&fÆ÷s¢&†–FFVâ"ÒÀ¢†VFW%åG&6³¢²fÆW„F—&V7F–öã¢'&÷r"Â†V–v‡C¢„TDU%ô‚ÂfÆW…6‡&–æ³¢ÒÀ¢†VFW%G&6³¢²†V–v‡C¢„TDU%ô‚Â÷fW&fÆ÷s¢&†–FFVâ"ÂfÆW…6‡&–æ³¢ÒÀ¢F–6´Æ&VÃ¢°¢÷6—F–öã¢&'6öÇWFR"À¢F÷¢rÀ¢6öÆ÷#¢44TåEõ4ôeBÀ¢föçDfÖ–Ç“¢föçG2ç6VÖ–&öÆBÀ¢föçE6—¦S¢ãRÀ¢v–GFƒ¢À¢ÒÀ¢&÷s¢²fÆW„F—&V7F–öã¢'&÷r"Â&÷&FW$&÷GFöÕv–GFƒ¢Â&÷&FW$&÷GFöÔ6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÃãSR’"Â÷fW&fÆ÷s¢&†–FFVâ"ÒÀ¢&÷uf–Ww÷'C¢²fÆWƒ¢Â†V–v‡C¢#R"Â÷fW&fÆ÷s¢&†–FFVâ"ÒÀ¢&÷uåG&6³¢²fÆW„F—&V7F–öã¢'&÷r"ÂfÆW…6‡&–æ³¢ÒÀ¢Æövô6öÃ¢°¢¤–æFWƒ¢#À¢VÆWfF–öã¢‚À¢fÆW…6‡&–æ³¢À¢÷fW&fÆ÷s¢&†–FFVâ"À¢&6¶w&÷VæD6öÆ÷#¢"3“b"À¢&÷&FW%&–v‡Ev–GFƒ¢À¢&÷&FW%&–v‡D6öÆ÷#¢Gd6öÆ÷'2æÆ–æRÀ¢ÒÀ¢Æövô6VÆÃ¢°¢fÆWƒ¢À¢v–GFƒ¢#R"À¢fÆW„F—&V7F–öã¢'&÷r"À¢Æ–vä—FV×3¢&6VçFW""À¢§W7F–g”6öçFVçC¢&fÆW‚×7F'B"À¢&÷&FW%v–GFƒ¢"À¢&÷&FW$6öÆ÷#¢'G&ç7&VçB"À¢&6¶w&÷VæD6öÆ÷#¢"3“b"À¢÷fW&fÆ÷s¢&†–FFVâ"À¢ÒÀ¢Æövô6VÆÄfö7W6VC¢°¢&÷&FW$6öÆ÷#¢"4dddddb"À¢&6¶w&÷VæD6öÆ÷#¢"3$ScR"À¢ÒÀ¢6†ææVÄçVÖ&W#¢°¢6öÆ÷#¢44TåEõ4ôeBÀ¢föçDfÖ–Ç“¢föçG2æ&öÆBÀ¢föçE6—¦S¢À¢FW‡DÆ–vã¢'&–v‡B"À¢ÒÀ¢ÆövôæÖS¢²6öÆ÷#¢"6ffb"ÂföçDfÖ–Ç“¢föçG2ç6VÖ–&öÆBÂFW‡DÆ–vã¢&ÆVgB"ÂfÆWƒ¢ÂÖ–åv–GFƒ¢ÒÀ¢F–ÖVÆ–æT6Æ—¢°¢fÆWƒ¢À¢÷fW&fÆ÷s¢&†–FFVâ"À¢†V–v‡C¢#R"À¢ÒÀ¢F–ÖVÆ–æUG&6³¢°¢÷6—F–öã¢'&VÆF—fR"À¢fÆW…6‡&–æ³¢À¢ÒÀ¢&öt6VÆÃ¢°¢÷6—F–öã¢&'6öÇWFR"À¢F÷¢2À¢&÷GFöÓ¢2À¢&6¶w&÷VæD6öÆ÷#¢'&v&ƒ#BÃ#2ÃC"Ããƒ‚’"À¢&÷&FW%&F—W3¢2À¢&÷&FW%v–GFƒ¢"À¢&÷&FW$6öÆ÷#¢'G&ç7&VçB"À¢FF–æt†÷&—¦öçFÃ¢bÀ¢§W7F–g”6öçFVçC¢&6VçFW""À¢÷fW&fÆ÷s¢&†–FFVâ"À¢ÒÀ¢VæF–æu&öw&Ô6VÆÃ¢°¢&÷&FW%7G–ÆS¢&F6†VB"À¢&÷&FW$6öÆ÷#¢'&v&ƒ“bÃƒÃ#S2Ãã#‚’"À¢&6¶w&÷VæD6öÆ÷#¢'&v&ƒ#BÃ#2ÃC"ÃãS’"À¢ÒÀ¢VæF–æu&öw&Ô6VÆÄ†–FFVã¢°¢ÆVgC¢À¢F÷¢À¢v–GFƒ¢À¢†V–v‡C¢À¢÷6—G“¢À¢&÷&FW%v–GFƒ¢À¢÷fW&fÆ÷s¢&†–FFVâ"À¢ÒÀ¢&ötÆ—fS¢²&÷&FW$6öÆ÷#¢'&v&ƒc‚ÃƒRÃ#CrÃãS’"Â&6¶w&÷VæD6öÆ÷#¢'&v&ƒS’Ã#2ÃBÃãc’"ÒÀ¢&öu&VÖ–æFVC¢²&÷&FW$6öÆ÷#¢'&v&ƒ#SÃ#BÃ#ÃãSR’"ÒÀ¢&VÖ–æFW$&FvS¢°¢÷6—F–öã¢&'6öÇWFR"À¢F÷¢"À¢&–v‡C¢2À¢¤–æFWƒ¢"À¢v–GFƒ¢BÀ¢†V–v‡C¢BÀ¢&÷&FW%&F—W3¢rÀ¢Æ–vä—FV×3¢&6VçFW""À¢§W7F–g”6öçFVçC¢&6VçFW""À¢&6¶w&÷VæD6öÆ÷#¢'&v&ƒÃÃÃãCR’"À¢ÒÀ¢&öw&Ô6VÆÄfö7W6VC¢°¢&÷&FW$6öÆ÷#¢"4dddddb"À¢&6¶w&÷VæD6öÆ÷#¢'&v&ƒ“Ã32Ãƒ"Ãã“"’"À¢ÒÀ¢&öuF—FÆS¢²6öÆ÷#¢6öÆ÷'2æöå7W&f6RÂföçDfÖ–Ç“¢föçG2ç6VÖ–&öÆBÂföçE6—¦S¢Â¤–æFWƒ¢ÒÀ¢&öuF—FÆTW‡G&6ö×7C¢²föçE6—¦S¢‚ã‚ÂÆ–æT†V–v‡C¢ãRÒÀ¢&öuF–ÖS¢²6öÆ÷#¢'&v&ƒ#SRÃ#SRÃ#SRÃãs"’"ÂföçDfÖ–Ç“¢föçG2ç&VwVÆ"ÂföçE6—¦S¢‚ÂÖ&v–åF÷¢Â¤–æFWƒ¢ÒÀ¢&öuF–ÖTW‡G&6ö×7C¢²föçE6—¦S¢bã‚ÂÆ–æT†V–v‡C¢‚ÒÀ¢&öu&öw&W74f–ÆÃ¢°¢÷6—F–öã¢&'6öÇWFR"À¢ÆVgC¢À¢F÷¢À¢&÷GFöÓ¢À¢&6¶w&÷VæD6öÆ÷#¢'&v&ƒc‚ÃƒRÃ#CrÃã3‚’"À¢¤–æFWƒ¢À¢ÒÀ¢æôFF¢²6öÆ÷#¢6öÆ÷'2æöå7W&f6UFW'F–'’ÂföçDfÖ–Ç“¢föçG2ç&VwVÆ"ÂföçE6—¦S¢’ÒÀ¢æ÷t÷fW&Æ“¢°¢ââå7G–ÆU6†VWBæ'6öÇWFTf–ÆÄö&¦V7BÀ¢÷fW&fÆ÷s¢&†–FFVâ"À¢¤–æFWƒ¢2À¢ÒÀ¢æ÷tÆ–æUG&6³¢°¢÷6—F–öã¢&'6öÇWFR"À¢F÷¢À¢&÷GFöÓ¢À¢v–GFƒ¢2À¢Æ–vä—FV×3¢&6VçFW""À¢¤–æFWƒ¢2À¢ÒÀ¢æ÷tÆ–æS¢°¢v–GFƒ¢"À¢fÆWƒ¢À¢&6¶w&÷VæD6öÆ÷#¢"4cCs$#b"À¢ÒÀ¢æ÷t†VFW$Ö&³¢°¢÷6—F–öã¢&'6öÇWFR"À¢F÷¢"À¢v–GFƒ¢#‚À¢Æ–vä—FV×3¢&6VçFW""À¢¤–æFWƒ¢BÀ¢ÒÀ¢æ÷t†VFW%FW‡C¢°¢6öÆ÷#¢"4c”„CB"À¢föçDfÖ–Ç“¢föçG2æ&öÆBÀ¢föçE6—¦S¢’À¢ÆWGFW%76–æs¢ãbÀ¢ÒÀ¢æ÷t†VFW$6&WC¢°¢Ö&v–åF÷¢À¢v–GFƒ¢À¢†V–v‡C¢À¢&÷&FW$ÆVgEv–GFƒ¢RÀ¢&÷&FW%&–v‡Ev–GFƒ¢RÀ¢&÷&FW%F÷v–GFƒ¢bÀ¢&÷&FW$ÆVgD6öÆ÷#¢'G&ç7&VçB"À¢&÷&FW%&–v‡D6öÆ÷#¢'G&ç7&VçB"À¢&÷&FW%F÷6öÆ÷#¢"4cCs$#b"À¢ÒÀ§Ò“° 