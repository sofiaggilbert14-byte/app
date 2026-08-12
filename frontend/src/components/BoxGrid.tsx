import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  RefreshControl,
  useTVEventHandler,
  findNodeHandle,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radius, spacing, tvColors } from "@/src/theme";
import { Channel, Program } from "@/src/api";
import { ChannelLogo } from "./ChannelLogo";
import { nowNext, progressPct, fmtTime, reminderKey } from "@/src/utils/time";
import { useStore } from "@/src/store";
import { requestNativeFocus } from "@/src/utils/tvFocus";
import {
  applyLeftFocusLock,
  armGuideBottomFocusLock,
  armGuideLeftFocusLock,
  clearGuideLeftFocusOverride,
  focusGuideSurfaceWhenMounted,
  noteGuideChannelFocus,
  registerGuideChannelNode,
  wireGuideTopBoundary,
} from "@/src/utils/tvGuideFocusLock";
import { evaluateGuideNavigation } from "@/src/core/guideNavigationPolicy";
import { getGuideProgramRowState, useGuidePrograms } from "@/src/core/guideProgramsStore";
import { channelHasEpgMatch } from "@/src/core/epgUserOverrides";
import {
  buildGuideRunwayIds,
  type GuideScanDirection,
} from "@/src/core/guideRunwayPolicy";
import {
  acknowledgeGuideFocusAfterPaint,
  addGuidePageKeyListener,
  setGuideFocusSyncActive,
} from "@/src/utils/tvRemote";

const ACCENT = "#A855F7";
const ACCENT_SOFT = "#E9D5FF";
const REMINDER_BELL = "#FACC15";
const GUIDE_ESCAPE_GUARD_MS = 220;

function applyDownFocusLock(node: any, locked: boolean) {
  if (!node) return;
  const handle = findNodeHandle(node);
  if (!handle) return;
  try {
    node.setNativeProps?.({ nextFocusDown: locked ? handle : -1 });
  } catch {
    /* optional on web */
  }
}

type ChannelCardProps = {
  item: Channel;
  index: number;
  nowDate: Date;
  favorite: boolean;
  showChannelNumbers: boolean;
  channelNumber?: number;
  showChannelLogos: boolean;
  onChannelPress: (c: Channel) => void;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  onRowFocus?: (index: number) => void;
  onFocusNode?: (node: unknown) => void;
  toggleFavorite: (id: string) => void;
  preferInitialFocus?: boolean;
  reminderKeys?: ReadonlySet<string>;
  lockFocusDown?: boolean;
  lockFocusLeft?: boolean;
  handOffLeftToPreview?: boolean;
  topBoundary?: boolean;
};

const ChannelCard = memo(function ChannelCard({
  item,
  index,
  nowDate,
  favorite,
  showChannelNumbers,
  channelNumber,
  showChannelLogos,
  onChannelPress,
  onProgramPress,
  onChannelFocus,
  onRowFocus,
  onFocusNode,
  toggleFavorite,
  preferInitialFocus = false,
  reminderKeys,
  lockFocusDown = false,
  lockFocusLeft = false,
  handOffLeftToPreview = false,
  topBoundary = false,
}: ChannelCardProps) {
  const programs = useGuidePrograms(item.id);
  const programRowState = getGuideProgramRowState(item.id);
  const { current, next } = nowNext(programs, nowDate);
  const pct = progressPct(current, nowDate);
  const hasReminder = programs.some((program) => reminderKeys?.has(reminderKey(item.id, program.start)));
  const cardRef = useRef<any>(null);

  const setCardRef = useCallback(
    (node: any) => {
      cardRef.current = node;
      registerGuideChannelNode(item.id, node, { handOffLeftToPreview });
      if (lockFocusLeft) applyLeftFocusLock(node, true);
      else if (handOffLeftToPreview) applyLeftFocusLock(node, false);
      else clearGuideLeftFocusOverride(node);
      applyDownFocusLock(node, lockFocusDown);
    },
    [handOffLeftToPreview, item.id, lockFocusDown, lockFocusLeft],
  );

  useEffect(() => {
    if (lockFocusLeft) applyLeftFocusLock(cardRef.current, true);
    else if (handOffLeftToPreview) applyLeftFocusLock(cardRef.current, false);
    else clearGuideLeftFocusOverride(cardRef.current);
    applyDownFocusLock(cardRef.current, lockFocusDown);
  }, [handOffLeftToPreview, lockFocusDown, lockFocusLeft]);

  const handleChannelPress = useCallback(() => onChannelPress(item), [item, onChannelPress]);
  const handleCurrentPress = useCallback(() => {
    if (current) onProgramPress(current, item);
  }, [current, item, onProgramPress]);
  const handleNextPress = useCallback(() => {
    if (next) onProgramPress(next, item);
  }, [item, next, onProgramPress]);
  const handleFavorite = useCallback(() => toggleFavorite(item.id), [item.id, toggleFavorite]);
  const handleFocus = useCallback(() => {
    setGuideFocusSyncActive(true);
    noteGuideChannelFocus(item.id, cardRef.current);
    if (topBoundary) wireGuideTopBoundary(cardRef.current);
    onFocusNode?.(cardRef.current);
    onRowFocus?.(index);
    onChannelFocus?.(item);
    acknowledgeGuideFocusAfterPaint(programRowState !== "loading");
  }, [index, item, onChannelFocus, onFocusNode, onRowFocus, programRowState, topBoundary]);

  return (
    <View style={styles.cell}>
      <Pressable
        ref={setCardRef}
        focusable
        hasTVPreferredFocus={preferInitialFocus}
        onFocus={handleFocus}
        style={({ focused }: any) => [styles.card, focused && styles.cardFocused]}
        onPress={handleChannelPress}
        onLongPress={handleFavorite}
        delayLongPress={450}
        testID={`box-channel-${item.id}`}
      >
        <View style={styles.cardTop}>
          <View style={styles.logoNumberRow}>
            {showChannelNumbers && (
              <Text style={styles.channelNumber}>{channelNumber || index + 1}</Text>
            )}
            <ChannelLogo name={item.name} logo={item.logo} disabled={!showChannelLogos} size={40} />
          </View>
          <View style={styles.cardBadges} pointerEvents="none">
            {hasReminder ? <Ionicons name="notifications" size={16} color={REMINDER_BELL} /> : null}
            <View testID={`box-fav-${item.id}`}>
              <Ionicons
                name={favorite ? "heart" : "heart-outline"}
                size={18}
                color={favorite ? ACCENT : colors.onSurfaceTertiary}
              />
            </View>
          </View>
        </View>

        <Text numberOfLines={1} style={styles.chName}>{item.name}</Text>

        {current ? (
          <Pressable focusable={false} onPress={handleCurrentPress}>
            <Text numberOfLines={2} style={styles.nowTitle}>{current.title}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
          </Pressable>
        ) : (
          <Text style={styles.noNow}>
            {programRowState === "loading"
              ? "Loading programme data"
              : !channelHasEpgMatch(item)
                ? "Channel not matched to XMLTV"
                : "No programme supplied"}
          </Text>
        )}

        {next && (
          <Pressable focusable={false} onPress={handleNextPress}>
            <Text numberOfLines={1} style={styles.nextLine}>
              Next: {fmtTime(next.start)} · {next.title}
            </Text>
          </Pressable>
        )}
      </Pressable>
    </View>
  );
});

export function BoxGrid({
  channels,
  now,
  onChannelPress,
  onProgramPress,
  onChannelFocus,
  onUpBoundary,
  onLeftBoundary,
  onFocusedRowChange,
  onViewportChannelIds,
  ListHeaderComponent,
  refreshing,
  onRefresh,
  showChannelNumbers = false,
  channelNumberById,
  showChannelLogos = true,
  reminderKeys,
  resetToken = 0,
  active = true,
  lockLeftEdge = true,
  restoreChannelId,
  focusClaimNonce = 0,
  cacheProfile = "normal",
  pageRequest,
}: {
  channels: Channel[];
  now: string;
  onChannelPress: (c: Channel) => void;
  onProgramPress: (p: Program, c: Channel) => void;
  onChannelFocus?: (c: Channel) => void;
  onUpBoundary?: () => void;
  onLeftBoundary?: () => void;
  onFocusedRowChange?: (index: number) => void;
  onViewportChannelIds?: (ids: string[], priorityIds?: string[], pageSize?: number) => void;
  ListHeaderComponent?: React.ReactElement;
  refreshing?: boolean;
  onRefresh?: () => void;
  showChannelNumbers?: boolean;
  channelNumberById?: Record<string, number>;
  showChannelLogos?: boolean;
  reminderKeys?: ReadonlySet<string>;
  resetToken?: number;
  active?: boolean;
  lockLeftEdge?: boolean;
  restoreChannelId?: string | null;
  focusClaimNonce?: number;
  cacheProfile?: "normal" | "weak" | "max_preview";
  pageRequest?: { nonce: number; direction: -1 | 1 } | null;
}) {
  const { width, height } = useWindowDimensions();
  const numColumns = width >= 1400 ? 6 : width >= 1150 ? 5 : width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const nowDate = useMemo(() => new Date(now), [now]);
  const { favorites, toggleFavorite } = useStore();
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const listRef = useRef<FlashListRef<Channel>>(null);
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const focusedRowRef = useRef(0);
  const focusedIndexRef = useRef(0);
  const focusedNodeRef = useRef<unknown>(null);
  const verticalOffsetRef = useRef(0);
  const lastRowIndexRef = useRef(0);
  const lastReportedDeepRef = useRef(false);
  const lastViewportBucketRef = useRef("");
  const lastPrefetchIndexRef = useRef(0);
  const viewportDispatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingViewportRef = useRef<{
    runway: string[];
    priorities: string[];
    pageSize: number;
  } | null>(null);
  const scanDirectionRef = useRef<GuideScanDirection>(1);
  const guideEscapeInFlight = useRef(false);
  const escapeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasClaimedFocusRef = useRef(false);
  const gridOwnsFocusRef = useRef(false);
  const [preferFirst, setPreferFirst] = useState(() => !hasClaimedFocusRef.current);
  const rememberFocusNode = useCallback((node: unknown) => {
    if (node) focusedNodeRef.current = node;
  }, []);

  const keepFocusedCardVisible = useCallback((index: number) => {
    const row = Math.floor(index / Math.max(1, numColumns));
    const rowHeight = 148;
    const viewport = Math.max(rowHeight * 3, height - 110);
    const margin = rowHeight;
    const currentOffset = verticalOffsetRef.current;
    const rowTop = row * rowHeight;
    const rowBottom = rowTop + rowHeight;
    let target = currentOffset;
    if (rowTop < currentOffset + margin) target = Math.max(0, rowTop - margin);
    else if (rowBottom > currentOffset + viewport - margin) {
      target = Math.max(0, rowBottom - viewport + margin);
    }
    if (Math.abs(target - currentOffset) < 1) return;
    verticalOffsetRef.current = target;
    try {
      listRef.current?.scrollToOffset({ offset: target, animated: false });
    } catch {}
  }, [height, numColumns]);
  const onVerticalScroll = useCallback((event: any) => {
    verticalOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const reportViewport = useCallback(
    (index: number) => {
      if (!onViewportChannelIds) return;
      const list = channelsRef.current;
      if (!list.length) return;
      const cols = Math.max(1, numColumns);
      const visibleCardRows = Math.max(3, Math.ceil(height / 148));
      const itemsPerPage = cols * visibleCardRows;
      if (index > lastPrefetchIndexRef.current) scanDirectionRef.current = 1;
      else if (index < lastPrefetchIndexRef.current) scanDirectionRef.current = -1;
      lastPrefetchIndexRef.current = index;
      const viewportBucket = `${Math.floor(Math.max(0, index) / itemsPerPage)}:${scanDirectionRef.current}`;
      if (lastViewportBucketRef.current === viewportBucket) return;
      lastViewportBucketRef.current = viewportBucket;
      const runway = buildGuideRunwayIds(
        list,
        index,
        itemsPerPage,
        scanDirectionRef.current,
        cacheProfile,
      );
      const pageStart = Math.floor(Math.max(0, index) / itemsPerPage) * itemsPerPage;
      const visiblePageIds = list
        .slice(pageStart, pageStart + itemsPerPage)
        .map((channel) => channel.id);
      const priorities = [
        list[index]?.id,
        list[index + scanDirectionRef.current]?.id,
        list[index + scanDirectionRef.current * 2]?.id,
        ...visiblePageIds,
      ].filter((id): id is string => !!id);
      // Keep the native focus callback cheap. Coalesce fast D-pad movement and
      // move cache/runway work to the next frame instead of blocking focus paint.
      pendingViewportRef.current = { runway, priorities, pageSize: itemsPerPage };
      if (!viewportDispatchRef.current) {
        viewportDispatchRef.current = setTimeout(() => {
          viewportDispatchRef.current = null;
          const pending = pendingViewportRef.current;
          pendingViewportRef.current = null;
          if (pending) onViewportChannelIds(pending.runway, pending.priorities, pending.pageSize);
        }, 16);
      }
    },
    [cacheProfile, height, numColumns, onViewportChannelIds],
  );

  const reportFocusedRow = useCallback(
    (index: number) => {
      const row = Math.floor(index / Math.max(1, numColumns));
      focusedIndexRef.current = index;
      focusedRowRef.current = row;
      gridOwnsFocusRef.current = true;
      keepFocusedCardVisible(index);
      const deep = row > 0;
      if (lastReportedDeepRef.current !== deep) {
        lastReportedDeepRef.current = deep;
        onFocusedRowChange?.(row);
      }
      reportViewport(index);
    },
    [keepFocusedCardVisible, numColumns, onFocusedRowChange, reportViewport],
  );

  // Mount-once preferred focus — restore the last watched card after player.
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
    setPreferFirst(true);
    const clearPreferred = setTimeout(() => setPreferFirst(false), 600);
    return () => clearTimeout(clearPreferred);
  }, [channels, restoreChannelId]);

  // Depend only on the nonce — channels identity churn must not re-fire reclaim.
  useEffect(() => {
    if (!focusClaimNonce) return;
    const rows = channelsRef.current;
    if (!rows.length) return;
    const restoreIndex = restoreChannelId
      ? rows.findIndex((channel) => channel.id === restoreChannelId)
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
    // Explicit retry is the sole drawer-return focus claim. Do not also pulse
    // hasTVPreferredFocus against a potentially recycled card.
    focusGuideSurfaceWhenMounted(restoreChannelId || rows[0]?.id, [0, 40, 120, 240, 420, 700]);
  }, [focusClaimNonce, restoreChannelId]);

  useEffect(() => {
    if (!resetToken) return;
    lastReportedDeepRef.current = false;
    lastViewportBucketRef.current = "";
    lastPrefetchIndexRef.current = 0;
    scanDirectionRef.current = 1;
    focusedRowRef.current = 0;
    try {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    } catch {}
  }, [resetToken]);

  useEffect(
    () => () => {
      if (escapeTimer.current) clearTimeout(escapeTimer.current);
      if (viewportDispatchRef.current) clearTimeout(viewportDispatchRef.current);
      pendingViewportRef.current = null;
      setGuideFocusSyncActive(false);
    },
    [],
  );

  useEffect(() => {
    if (active) return;
    gridOwnsFocusRef.current = false;
    pendingViewportRef.current = null;
    if (viewportDispatchRef.current) {
      clearTimeout(viewportDispatchRef.current);
      viewportDispatchRef.current = null;
    }
    setGuideFocusSyncActive(false);
  }, [active]);

  const pageGuide = useCallback((direction: -1 | 1) => {
    if (!active) return;
    const rows = channelsRef.current;
    if (!rows.length) return;
    const visibleCardRows = Math.max(3, Math.floor(height / 148));
    const pageSize = Math.max(1, numColumns * visibleCardRows);
    const targetIndex = Math.max(
      0,
      Math.min(rows.length - 1, focusedIndexRef.current + direction * pageSize),
    );
    try {
      listRef.current?.scrollToIndex({ index: targetIndex, animated: false, viewPosition: 0.45 });
      verticalOffsetRef.current = Math.max(0, Math.floor(targetIndex / numColumns) * 148 - height * 0.45);
    } catch {}
    focusGuideSurfaceWhenMounted(rows[targetIndex]?.id, [0, 16, 40, 80, 140, 240]);
  }, [active, height, numColumns]);

  useEffect(() => {
    if (!active) return;
    return addGuidePageKeyListener((key) => pageGuide(key === "UP" ? -1 : 1));
  }, [active, pageGuide]);

  useEffect(() => {
    if (pageRequest) pageGuide(pageRequest.direction);
  }, [pageGuide, pageRequest]);

  const lastRowIndex = Math.max(0, Math.floor((Math.max(channels.length, 1) - 1) / Math.max(1, numColumns)));
  lastRowIndexRef.current = lastRowIndex;
  const renderDrawDistance = cacheProfile === "weak"
    ? 320
    : cacheProfile === "max_preview"
      ? 720
      : 480;

  useTVEventHandler(
    useCallback(
      (event) => {
        if (!active) return;
        const key = event?.eventType;
        // Left edge of compact grid hands focus to the preview/actions panel.
        if (key === "left" && gridOwnsFocusRef.current) {
          const col = focusedIndexRef.current % Math.max(1, numColumns);
          if (col === 0) {
            if (onLeftBoundary) {
              gridOwnsFocusRef.current = false;
              onLeftBoundary();
              return;
            }
            armGuideLeftFocusLock(focusedNodeRef.current);
            return;
          }
        }
        const decision = evaluateGuideNavigation({
          active,
          key,
          gridOwnsFocus: gridOwnsFocusRef.current,
          focusRegion: "program",
          focusedRow: focusedRowRef.current,
          lastRow: lastRowIndexRef.current,
        });
        if (decision.boundary === "bottom-lock") {
          armGuideBottomFocusLock(focusedNodeRef.current);
          requestNativeFocus(focusedNodeRef.current);
          return;
        }
        if (decision.boundary !== "top-boundary") return;
        if (!gridOwnsFocusRef.current || guideEscapeInFlight.current) return;
        guideEscapeInFlight.current = true;
        gridOwnsFocusRef.current = false;
        onUpBoundary?.();
        if (escapeTimer.current) clearTimeout(escapeTimer.current);
        escapeTimer.current = setTimeout(() => {
          guideEscapeInFlight.current = false;
        }, GUIDE_ESCAPE_GUARD_MS);
      },
      [active, numColumns, onLeftBoundary, onUpBoundary],
    ),
  );

  const favoriteSetRef = useRef(favoriteSet);
  favoriteSetRef.current = favoriteSet;

  const renderItem = useCallback(
    ({ item, index }: { item: Channel; index: number }) => {
      const row = Math.floor(index / Math.max(1, numColumns));
      return (
        <ChannelCard
          item={item}
          index={index}
          nowDate={nowDate}
          favorite={favoriteSetRef.current.has(item.id)}
          showChannelNumbers={showChannelNumbers}
          channelNumber={channelNumberById?.[item.id]}
          showChannelLogos={showChannelLogos}
          onChannelPress={onChannelPress}
          onProgramPress={onProgramPress}
          onChannelFocus={onChannelFocus}
          onRowFocus={reportFocusedRow}
          onFocusNode={rememberFocusNode}
          toggleFavorite={toggleFavorite}
          preferInitialFocus={
            preferFirst &&
            (restoreChannelId ? item.id === restoreChannelId : index === 0)
          }
          reminderKeys={reminderKeys}
          lockFocusDown={row >= lastRowIndex}
          lockFocusLeft={lockLeftEdge && index % Math.max(1, numColumns) === 0}
          handOffLeftToPreview={!lockLeftEdge && index % Math.max(1, numColumns) === 0}
          topBoundary={row === 0}
        />
      );
    },
    [channelNumberById, lastRowIndex, lockLeftEdge, nowDate, numColumns, onChannelFocus, onChannelPress, onProgramPress, preferFirst, reminderKeys, rememberFocusNode, reportFocusedRow, restoreChannelId, showChannelLogos, showChannelNumbers, toggleFavorite],
  );

  return (
    <View style={styles.wrap}>
      <FlashList
        testID="epg-box-grid"
        data={channels}
        ref={listRef}
        numColumns={numColumns}
        keyExtractor={(c) => c.id}
        // Re-render visible hearts when favorites change without recreating renderItem.
        extraData={favorites}
        drawDistance={renderDrawDistance}
        removeClippedSubviews={false}
        onScroll={onVerticalScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: 130, paddingHorizontal: spacing.xs, paddingTop: spacing.xs }}
        ListHeaderComponent={ListHeaderComponent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
          ) : undefined
        }
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  cell: { flex: 1, padding: spacing.xs },
  card: {
    flex: 1,
    backgroundColor: tvColors.panel,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: tvColors.line,
    gap: spacing.xs,
    minHeight: 132,
  },
  cardFocused: {
    borderColor: "#fff",
    borderWidth: 3,
    backgroundColor: tvColors.purpleDeep,
    shadowColor: ACCENT,
    shadowOpacity: 0.55,
    shadowRadius: 12,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardBadges: { flexDirection: "row", alignItems: "center", gap: 6 },
  logoNumberRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1 },
  channelNumber: { color: ACCENT_SOFT, fontFamily: fonts.bold, fontSize: 12, minWidth: 26, textAlign: "right" },
  chName: { color: "rgba(255,255,255,0.82)", fontFamily: fonts.semibold, fontSize: 12 },
  nowTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14, minHeight: 34 },
  noNow: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: ACCENT },
  nextLine: { color: "rgba(233,213,255,0.78)", fontFamily: fonts.regular, fontSize: 11, marginTop: 6 },
});
