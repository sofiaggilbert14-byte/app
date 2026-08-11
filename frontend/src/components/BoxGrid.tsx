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
  focusGuideSurfaceWhenMounted,
  noteGuideChannelFocus,
  registerGuideChannelNode,
} from "@/src/utils/tvGuideFocusLock";
import { evaluateGuideNavigation } from "@/src/core/guideNavigationPolicy";
import { getGuideProgramRowState, useGuidePrograms } from "@/src/core/guideProgramsStore";
import { channelHasEpgMatch } from "@/src/core/epgUserOverrides";
import {
  buildGuideRunwayIds,
  type GuideScanDirection,
} from "@/src/core/guideRunwayPolicy";
import { createDpadDoubleTapDetector } from "@/src/core/dpadDoubleTap";
import { subscribeVerticalDpadTaps } from "@/src/utils/tvDpadTap";

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
      registerGuideChannelNode(item.id, node, { handOffLeftToPreview: !lockFocusLeft });
      applyLeftFocusLock(node, lockFocusLeft);
      applyDownFocusLock(node, lockFocusDown);
    },
    [item.id, lockFocusDown, lockFocusLeft],
  );

  useEffect(() => {
    applyLeftFocusLock(cardRef.current, lockFocusLeft);
    applyDownFocusLock(cardRef.current, lockFocusDown);
  }, [lockFocusDown, lockFocusLeft]);

  const handleChannelPress = useCallback(() => onChannelPress(item), [item, onChannelPress]);
  const handleCurrentPress = useCallback(() => {
    if (current) onProgramPress(current, item);
  }, [current, item, onProgramPress]);
  const handleNextPress = useCallback(() => {
    if (next) onProgramPress(next, item);
  }, [item, next, onProgramPress]);
  const handleFavorite = useCallback(() => toggleFavorite(item.id), [item.id, toggleFavorite]);
  const handleFocus = useCallback(() => {
    noteGuideChannelFocus(item.id, cardRef.current);
    onFocusNode?.(cardRef.current);
    onRowFocus?.(index);
    onChannelFocus?.(item);
  }, [index, item, onChannelFocus, onFocusNode, onRowFocus]);

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
  const lastRowIndexRef = useRef(0);
  const lastReportedDeepRef = useRef(false);
  const lastViewportBucketRef = useRef("");
  const lastPrefetchIndexRef = useRef(0);
  const scanDirectionRef = useRef<GuideScanDirection>(1);
  const guideEscapeInFlight = useRef(false);
  const escapeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasClaimedFocusRef = useRef(false);
  const gridOwnsFocusRef = useRef(false);
  const pageJumpDetectorRef = useRef(createDpadDoubleTapDetector());
  const pageJumpAnchorRef = useRef(0);
  const [preferFirst, setPreferFirst] = useState(() => !hasClaimedFocusRef.current);
  const rememberFocusNode = useCallback((node: unknown) => {
    if (node) focusedNodeRef.current = node;
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
      onViewportChannelIds(runway, priorities, itemsPerPage);
    },
    [cacheProfile, height, numColumns, onViewportChannelIds],
  );

  const reportFocusedRow = useCallback(
    (index: number) => {
      const row = Math.floor(index / Math.max(1, numColumns));
      focusedIndexRef.current = index;
      focusedRowRef.current = row;
      gridOwnsFocusRef.current = true;
      const deep = row > 0;
      if (lastReportedDeepRef.current !== deep) {
        lastReportedDeepRef.current = deep;
        onFocusedRowChange?.(row);
      }
      reportViewport(index);
    },
    [numColumns, onFocusedRowChange, reportViewport],
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
    },
    [],
  );

  const lastGridOwnedAtRef = useRef(0);

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
      if (ownsFocus) lastGridOwnedAtRef.current = Date.now();
      const matched = pageJumpDetectorRef.current.push(key);
      if (!matched) {
        pageJumpAnchorRef.current = focusedIndexRef.current;
        return;
      }
      const list = channelsRef.current;
      if (!list.length) return;
      const direction: GuideScanDirection = matched === "DOWN" ? 1 : -1;
      const visibleRows = Math.max(1, Math.ceil(height / 148));
      const itemsPerPage = Math.max(1, numColumns) * visibleRows;
      const target = Math.max(
        0,
        Math.min(list.length - 1, pageJumpAnchorRef.current + direction * itemsPerPage),
      );
      scanDirectionRef.current = direction;
      try {
        listRef.current?.scrollToIndex({ index: target, animated: false, viewPosition: 0.1 });
      } catch {}
      reportFocusedRow(target);
      focusGuideSurfaceWhenMounted(list[target]?.id, [0, 16, 48, 96]);
    });
  }, [active, height, numColumns, reportFocusedRow]);

  const lastRowIndex = Math.max(0, Math.floor((Math.max(channels.length, 1) - 1) / Math.max(1, numColumns)));
  lastRowIndexRef.current = lastRowIndex;

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
        drawDistance={2400}
        removeClippedSubviews={false}
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
