import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  PurpleTvShell,
  PURPLE_DRAWER_ANIMATION_MS,
  usePurpleTvDrawer,
} from "@/src/components/PurpleTvShell";
import { TimelineGrid } from "@/src/components/TimelineGrid";
import { BoxGrid } from "@/src/components/BoxGrid";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { GuidePreviewRail } from "@/src/components/GuidePreviewRail";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { Channel, Program } from "@/src/api";
import { useStore } from "@/src/store";
import { setPriorityMatchChannelIds, setViewportGuideChannelIds } from "@/src/source";
import { markGuideSurfing } from "@/src/utils/guideSurfGate";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { getGuideRailMetrics } from "@/src/core/guideLayoutPolicy";
import { buildGuideRunwayIds } from "@/src/core/guideRunwayPolicy";
import { expandRunwayKeepSet } from "@/src/core/guideSlidingCache";
import {
  resetGuideSelection,
  setGuideFocusedProgram,
  useGuideSelection,
} from "@/src/core/guideSelectionStore";
import { getPowerProfileTuning } from "@/src/core/devicePowerProfile";
import { channelHasEpgMatch } from "@/src/core/epgUserOverrides";
import {
  buildGroupCounts,
  buildVisibleGroups,
  filterChannelsByGroup,
  listPlaylistGroupNames,
  pinGroup,
  searchChannelsInList,
  unpinGroup,
} from "@/src/core/guideGroups";
import { useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { resolveChannelNumber, useChannelCustomize } from "@/src/core/channelCustomize";
import { useParentalPin } from "@/src/core/parentalPin";
import { failedStreamCount, isFailedChannel, noteStreamFailure } from "@/src/core/streamFailureRegistry";
import { consumeGuideJump } from "@/src/core/guideSearchJump";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { nowNext, reminderKey } from "@/src/utils/time";
import { requestNativeFocus } from "@/src/utils/tvFocus";
import {
  cancelGuideFocusRestore,
  focusGuidePreviewSurface,
  focusGuideSurface,
} from "@/src/utils/tvGuideFocusLock";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import type { StreamStatus } from "@/src/components/StreamPlayer";
import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";

// Session-only guide position survives the root player route unmounting tabs.
// Do not persist to disk: this is navigation state, not a user preference.
let guideSessionGroup = "All";
let guideSessionChannelId: string | null = null;

function byName(a: Channel, b: Channel) {
  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
}

function chipLabel(name: string): string {
  if (name === "Recently Watched") return "Recent";
  return name;
}

/**
 * The only Guide subtree subscribed to repeated focus selection. TimelineGrid
 * and the screen shell therefore stay render-stable while Android moves focus;
 * metadata still updates synchronously and decoder tuning remains delayed.
 */
function GuideSelectionPreview({
  width,
  channelById,
  fallbackChannel,
  now,
  channelNumberById,
  showChannelNumbers,
  showLogos,
  favoriteSet,
  reminderKeys,
  hidePreview,
  muted,
  onToggleMute,
  previewId,
  previewStatus,
  previewEpoch,
  onPreviewStatus,
  onPreviewErrorRemount,
  onPlay,
  onFavorite,
  onToggleReminder,
  onHideToggle,
}: {
  width: number;
  channelById: ReadonlyMap<string, Channel>;
  fallbackChannel: Channel | null;
  now: string;
  channelNumberById: Record<string, number>;
  showChannelNumbers: boolean;
  showLogos: boolean;
  favoriteSet: ReadonlySet<string>;
  reminderKeys: ReadonlySet<string>;
  hidePreview: boolean;
  muted: boolean;
  onToggleMute: () => void;
  previewId: string | null;
  previewStatus: StreamStatus;
  previewEpoch: number;
  onPreviewStatus: (status: StreamStatus) => void;
  onPreviewErrorRemount: () => void;
  onPlay: (channel: Channel) => void;
  onFavorite: (channelId: string) => void;
  onToggleReminder: (program: Program, channel: Channel) => void;
  onHideToggle: () => void;
}) {
  const selection = useGuideSelection();
  const channel = (selection.channelId ? channelById.get(selection.channelId) : null) || fallbackChannel;
  const programs = useGuidePrograms(channel?.id);
  const { current: liveCurrent, next: liveNext } = useMemo(
    () => (channel ? nowNext(programs, new Date(now)) : {}),
    [channel, now, programs],
  );
  const { displayedProgram, nextProgram } = useMemo(() => {
    if (!channel || selection.channelId !== channel.id || !selection.program) {
      return { displayedProgram: liveCurrent, nextProgram: liveNext };
    }
    const selected = selection.program;
    const index = programs.findIndex(
      (program) => program.start === selected.start && program.stop === selected.stop,
    );
    return {
      displayedProgram: selected,
      nextProgram: index >= 0 ? programs[index + 1] : undefined,
    };
  }, [channel, liveCurrent, liveNext, programs, selection]);
  const canRemind = !!displayedProgram && Date.parse(displayedProgram.start) > Date.parse(now);
  const isReminded = !!(
    channel && displayedProgram && reminderKeys.has(reminderKey(channel.id, displayedProgram.start))
  );
  const previewVisible =
    !hidePreview &&
    !!channel?.url &&
    previewId === channel.id &&
    previewStatus !== "error";

  useEffect(() => {
    if (previewStatus === "error" && channel?.id) noteStreamFailure(channel.id);
  }, [channel?.id, previewStatus]);

  return (
    <GuidePreviewRail
      width={width}
      channel={channel}
      current={displayedProgram}
      next={nextProgram}
      now={now}
      channelNumber={channel ? channelNumberById[channel.id] : undefined}
      showChannelNumbers={showChannelNumbers}
      showLogos={showLogos}
      isFavorite={!!channel && favoriteSet.has(channel.id)}
      hidePreview={hidePreview}
      muted={muted}
      onToggleMute={onToggleMute}
      previewVisible={previewVisible}
      previewEpoch={previewEpoch}
      onPreviewStatus={onPreviewStatus}
      onPreviewErrorRemount={onPreviewErrorRemount}
      onPlay={() => channel && onPlay(channel)}
      onFavorite={() => channel && onFavorite(channel.id)}
      canRemind={canRemind}
      isReminded={isReminded}
      onToggleReminder={() => {
        if (displayedProgram && channel) onToggleReminder(displayedProgram, channel);
      }}
      onHideToggle={onHideToggle}
    />
  );
}

export default function PurpleGuideScreen() {
  const router = useRouter();
  const { drawerOpen } = usePurpleTvDrawer();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const {
    channels,
    windowStart,
    windowEnd,
    loading,
    refreshing,
    error,
    hardRefresh,
    patchProgramsForChannelIds,
    addRecent,
    toggleReminder,
    openProgram,
    activeProgram,
    favorites,
    recent,
    recentIds,
    lastChannelId,
    channelById,
    toggleFavorite,
    guideLayout,
    guideDensity,
    safePreviewMode,
    channelNumbers,
    channelLogos,
    reminders,
    powerProfile,
    logosOffWhileSurfing,
    instantGuide,
    epgGuideFilter,
    retainGuideSlidingCache,
  } = useStore();

  const {
    pinnedGroups,
    groupLayout,
    hidePreview,
    mutePreview,
    setPinnedGroups,
    setHidePreview,
    setMutePreview,
  } = useGuideUiPreferences();
  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();
  const hiddenIdSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const { isGroupLocked, unlockGroup, verifyPin, hasPin } = useParentalPin();

  const powerTuning = useMemo(() => getPowerProfileTuning(powerProfile), [powerProfile]);
  const [surfLogosSuppressed, setSurfLogosSuppressed] = useState(false);

  const [now, setNow] = useState(() => new Date().toISOString());
  const [group, setGroup] = useState(() => guideSessionGroup);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [resetToken, setResetToken] = useState(0);
  const [groupQuery, setGroupQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreGroupsOpen, setMoreGroupsOpen] = useState(false);
  const [pinPromptGroup, setPinPromptGroup] = useState<string | null>(null);
  const [pinDigits, setPinDigits] = useState("");
  const [pinError, setPinError] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRecoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoryLogoRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupChangedAt = useRef(0);
  const bootRetryRef = useRef(0);
  const groupChipRefs = useRef(new Map<string, any>());
  const lastFocusAtRef = useRef(0);
  const rapidSurfUntilRef = useRef(0);
  const hadProgramModalRef = useRef(false);
  const previousDrawerOpenRef = useRef(drawerOpen);
  const headerTitleProgress = useRef(new Animated.Value(drawerOpen ? 1 : 0)).current;
  const groupSlideX = useRef(new Animated.Value(0)).current;
  const [previewEpoch, setPreviewEpoch] = useState(0);
  useEffect(() => {
    resetGuideSelection(guideSessionChannelId);
  }, []);
  useEffect(
    () => subscribeAndroidMemoryPressure((pressure) => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (memoryLogoRestoreTimer.current) clearTimeout(memoryLogoRestoreTimer.current);
      headerTitleProgress.stopAnimation();
      groupSlideX.stopAnimation();
      setPreviewId(null);
      setSurfLogosSuppressed(true);
      // Drop decoded logo memory immediately, then permit near-size disk-cached
      // images again after Android has had time to reclaim. A new pressure event
      // extends the quiet period; Safe Preview Off no longer leaves logos hidden
      // for the rest of the app session.
      memoryLogoRestoreTimer.current = setTimeout(
        () => setSurfLogosSuppressed(false),
        pressure === "critical" ? 12_000 : 4_000,
      );
    }),
    [groupSlideX, headerTitleProgress],
  );
  const reminderKeys = useMemo(() => new Set(reminders.map((item) => item.key)), [reminders]);
  // Freeze grid reminder badges while the program sheet is open so Cancel/Remind
  // doesn't rebuild the FlashList under the modal.
  const [gridReminderKeys, setGridReminderKeys] = useState(reminderKeys);
  useEffect(() => {
    if (activeProgram) {
      hadProgramModalRef.current = true;
      return;
    }
    // Delay badge sync so focus restore isn't competing with FlashList churn.
    const syncTimer = setTimeout(() => setGridReminderKeys(reminderKeys), 220);
    return () => clearTimeout(syncTimer);
  }, [activeProgram, reminderKeys]);

  useEffect(() => {
    if (previousDrawerOpenRef.current !== drawerOpen) {
      groupSlideX.setValue(drawerOpen ? -140 : 140);
      previousDrawerOpenRef.current = drawerOpen;
    }
    const animation = Animated.parallel([
      Animated.timing(headerTitleProgress, {
        toValue: drawerOpen ? 1 : 0,
        duration: instantGuide ? 0 : PURPLE_DRAWER_ANIMATION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(groupSlideX, {
        toValue: 0,
        duration: instantGuide ? 0 : PURPLE_DRAWER_ANIMATION_MS,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [drawerOpen, groupSlideX, headerTitleProgress, instantGuide]);

  // After the drawer closes on Guide, restore the last real guide cell. If that
  // exact recycled native node is stale, use the registered guide surface entry
  // instead of preferring row 0 and unexpectedly jumping to the first channel.
  const drawerWasOpenForFocusRef = useRef(drawerOpen);
  useEffect(() => {
    const wasOpen = drawerWasOpenForFocusRef.current;
    drawerWasOpenForFocusRef.current = drawerOpen;
    if (drawerOpen) {
      cancelGuideFocusRestore();
      return;
    }
    if (!wasOpen || drawerOpen || activeProgram) return;
    // Restore only through currently registered channel rows. A recycled native
    // node must never be treated as a successful fallback.
    focusGuideSurface(guideSessionChannelId);
    return cancelGuideFocusRestore;
  }, [activeProgram, drawerOpen]);

  // After Remind/Cancel sheet closes, return focus to the guide cell — never Live TV.
  useEffect(() => {
    if (activeProgram) return;
    if (!hadProgramModalRef.current) return;
    hadProgramModalRef.current = false;
    focusGuideSurface(guideSessionChannelId);
    return cancelGuideFocusRestore;
  }, [activeProgram]);

  const guideFocusRegionRef = useRef<"channel" | "program">("program");
  const channelLogoNodeRef = useRef<unknown>(null);
  const onGuideBackTarget = useCallback((region: "channel" | "program", logoNode: unknown) => {
    guideFocusRegionRef.current = region;
    if (logoNode) channelLogoNodeRef.current = logoNode;
  }, []);

  // Back in the guide: step to the channel logo first. Only at the left edge does
  // Back defer to the shell double-Back drawer arm — never opens on a single press.
  useTvBackHandler(
    useCallback(() => {
      if (drawerOpen || activeProgram) return false;
      if (guideFocusRegionRef.current === "program" && channelLogoNodeRef.current) {
        requestNativeFocus(channelLogoNodeRef.current);
        guideFocusRegionRef.current = "channel";
        return true;
      }
      return false;
    }, [activeProgram, drawerOpen]),
  );

  useEffect(() => {
    if (loading || refreshing || channels.length > 0) return;
    if (bootRetryRef.current >= 1) return;
    bootRetryRef.current += 1;
    const timer = setTimeout(() => void hardRefresh(), 5000);
    return () => clearTimeout(timer);
  }, [loading, refreshing, channels.length, hardRefresh]);

  // Tick often enough for the timeline "now" indicator / progress fills without
  // rebuilding guide geometry (TimelineGrid keeps layout independent of now).
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (previewRecoverTimer.current) clearTimeout(previewRecoverTimer.current);
      if (memoryLogoRestoreTimer.current) clearTimeout(memoryLogoRestoreTimer.current);
      setViewportGuideChannelIds(null);
    },
    [],
  );

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const recentIdSet = useMemo(() => new Set(recentIds), [recentIds]);
  const failedCount = failedStreamCount();

  const groupCounts = useMemo(
    () =>
      buildGroupCounts(channels, {
        favoriteSet,
        recentIds: recentIdSet,
        hasEpgMatch: channelHasEpgMatch,
        isFailed: isFailedChannel,
        hiddenIds: hiddenIdSet,
      }),
    // failedCount invalidates when the in-memory failure registry grows/shrinks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, favoriteSet, recentIdSet, hiddenIdSet, failedCount, epgGuideFilter],
  );

  const playlistGroups = useMemo(
    () => listPlaylistGroupNames(channels, hiddenIdSet),
    [channels, hiddenIdSet],
  );

  const { tabs: groups, overflow: overflowGroups } = useMemo(
    () =>
      buildVisibleGroups({
        counts: groupCounts,
        pinned: pinnedGroups,
        playlistGroups,
        maxPlaylistTabs: 10,
      }),
    [groupCounts, pinnedGroups, playlistGroups],
  );

  const filteredMeta = useMemo(() => {
    let list = filterChannelsByGroup(channels, group, {
      favoriteSet,
      recent,
      recentIds: recentIdSet,
      hasEpgMatch: channelHasEpgMatch,
      isFailed: isFailedChannel,
      hiddenIds: hiddenIdSet,
      customOrder,
    });
    if (epgGuideFilter === "all") return list;
    if (epgGuideFilter === "matched") {
      return list.filter(channelHasEpgMatch);
    }
    return list.filter((c) => !channelHasEpgMatch(c));
  }, [channels, customOrder, epgGuideFilter, favoriteSet, group, hiddenIdSet, recent, recentIdSet]);

  // Within-group search — empty query keeps the filteredMeta identity ref.
  const filtered = useMemo(() => {
    const q = groupQuery.trim();
    if (!q) return filteredMeta;
    return searchChannelsInList(filteredMeta, q);
  }, [filteredMeta, groupQuery]);

  const showGroupSearch = searchOpen || filteredMeta.length > 80;

  const onViewportChannelIds = useCallback((ids: string[], priorityIds: string[] = [], pageSize = 8) => {
    setViewportGuideChannelIds(ids);
    if (channels.length >= 400) {
      setPriorityMatchChannelIds(ids.slice(0, 400));
    } else {
      setPriorityMatchChannelIds([]);
    }
    // Conveyor belt: fetch the runway, retain fetch ± 1 page so reverse surfing
    // does not blank rows the user just left, and drop everything else.
    const orderedIds = filtered.map((channel) => channel.id);
    retainGuideSlidingCache(expandRunwayKeepSet(orderedIds, ids, pageSize, 1));
    void patchProgramsForChannelIds(ids, priorityIds);
  }, [channels.length, filtered, patchProgramsForChannelIds, retainGuideSlidingCache]);

  const viewportSeedKeyRef = useRef("");
  // Seed only on cold load/group/reset. A silent refresh must not yank a deeply
  // scrolled guide's EPG query scope back to the first channels.
  useEffect(() => {
    if (!filtered.length) return;
    const key = `${group}:${resetToken}`;
    if (viewportSeedKeyRef.current === key) return;
    viewportSeedKeyRef.current = key;
    const rowHeight = getGuideRailMetrics(
      screenWidth,
      guideDensity,
      channelNumbers,
      channelLogos,
    ).rowHeight;
    const visibleRows = Math.max(6, Math.min(24, Math.ceil(screenHeight / rowHeight)));
    // Warm the complete initial direction-aware runway (current page plus eight
    // pages ahead) before the first focus event instead of waiting on row 1.
    const ids = buildGuideRunwayIds(filtered, 0, visibleRows, 1);
    setViewportGuideChannelIds(ids);
    setPriorityMatchChannelIds(channels.length >= 400 ? ids : []);
    retainGuideSlidingCache(
      expandRunwayKeepSet(
        filtered.map((channel) => channel.id),
        ids,
        visibleRows,
        1,
      ),
    );
    // Prewarm immediately on Guide/group entry, before the first native focus
    // event. SQLite and the bridge can populate the first visible runway early.
    void patchProgramsForChannelIds(
      ids,
      [ids[0], ids[1], ids[2], ...ids.slice(0, visibleRows)].filter(
        (id): id is string => !!id,
      ),
    );
  }, [
    channelLogos,
    channelNumbers,
    channels.length,
    filtered,
    group,
    guideDensity,
    patchProgramsForChannelIds,
    retainGuideSlidingCache,
    resetToken,
    screenHeight,
    screenWidth,
  ]);

  const onChannelLongPress = useCallback(
    (channel: Channel) => {
      toggleFavorite(channel.id);
    },
    [toggleFavorite],
  );

  // If Favorites/Recent (or a vanished category) becomes empty, fall back to All
  // so the guide never leaves an unfocusable empty FlashList.
  useEffect(() => {
    if (!groups.includes(group) && !overflowGroups.includes(group)) {
      guideSessionGroup = "All";
      guideSessionChannelId = null;
      setGroup("All");
      setResetToken((value) => value + 1);
    }
  }, [group, groups, overflowGroups]);

  const channelNumberById = useMemo(() => {
    const result: Record<string, number> = {};
    [...channels].sort(byName).forEach((channel, index) => {
      result[channel.id] = resolveChannelNumber(channel.id, index + 1, customNumbers);
    });
    return result;
  }, [channels, customNumbers]);

  // Repeated focus uses this O(1) lookup through the external selection store;
  // it never scans the complete filtered channel array.
  const filteredChannelById = useMemo(
    () => new Map(filtered.map((channel) => [channel.id, channel] as const)),
    [filtered],
  );
  const previewFallbackChannel = useMemo(
    () => (lastChannelId ? filteredChannelById.get(lastChannelId) : null) || filtered[0] || null,
    [filtered, filteredChannelById, lastChannelId],
  );

  // Decoder preview stays deliberately delayed during held navigation. Guide
  // metadata does not: title/description must track the actual focused row now.
  const previewDelay =
    safePreviewMode === "delayed" || safePreviewMode === "surf"
      ? powerTuning.previewArmDelayedMs
      : powerTuning.previewArmOnMs;
  const surfSettleExtraMs =
    safePreviewMode === "surf"
      ? powerTuning.surfSettleExtraMs + 100
      : powerTuning.surfSettleExtraMs;

  const schedulePreview = useCallback((requestedId: string, delay: number, hasUrl: boolean) => {
    if (safePreviewMode === "off" || !hasUrl) {
      setPreviewId(null);
      return;
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      // Break the sticky error latch — always remount the decoder for this tune.
      setPreviewStatus("loading");
      setPreviewEpoch((value) => value + 1);
      setPreviewId(requestedId);
      setSurfLogosSuppressed(false);
    }, delay);
  }, [safePreviewMode]);

  const detailsRailWidth = useMemo(() => {
    // Fixed left details panel sized for readable descriptions/actions on modern
    // Android TV hardware. The guide owns all remaining width to the right.
    // Twenty-five percent smaller than the original 260-360px / 24% rail.
    return Math.round(Math.min(270, Math.max(195, screenWidth * 0.18)));
  }, [screenWidth]);

  const armPreviewForChannel = useCallback(
    (channel: Channel) => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      const requestedId = channel.id;
      guideSessionChannelId = requestedId;

      // Moving left/right across programmes on the same channel updates details
      // immediately but must not tear down and re-arm an unchanged decoder.
      if (previewId === requestedId && previewStatus !== "error") return;

      const nowTs = Date.now();
      const rapid = nowTs - lastFocusAtRef.current < 240;
      lastFocusAtRef.current = nowTs;
      if (rapid) rapidSurfUntilRef.current = nowTs + powerTuning.rapidSurfHoldMs;
      if (rapid || nowTs < rapidSurfUntilRef.current) {
        markGuideSurfing(powerTuning.rapidSurfHoldMs);
      }

      if (nowTs < rapidSurfUntilRef.current || rapid) {
        // Keep decoder/GPU work out of the repeated-focus path. Only the last
        // focused channel after the hold settles is allowed to tune preview.
        setPreviewId(null);
        if (logosOffWhileSurfing) setSurfLogosSuppressed(true);
        schedulePreview(
          requestedId,
          Math.max(powerTuning.rapidSurfHoldMs + 80, previewDelay + surfSettleExtraMs),
          !!channel.url,
        );
        return;
      }

      const recentlyChangedGroup = nowTs - groupChangedAt.current < 1800;
      const delay = recentlyChangedGroup
        ? Math.max(previewDelay + surfSettleExtraMs, powerTuning.previewArmDelayedMs)
        : previewDelay;
      schedulePreview(requestedId, delay, !!channel.url);
    },
    [logosOffWhileSurfing, powerTuning, previewDelay, previewId, previewStatus, schedulePreview, surfSettleExtraMs],
  );

  const onFocusChannel = useCallback((channel: Channel) => {
    // Logo/card focus represents the live row rather than a previously selected
    // programme. Only the preview subtree subscribes to this external update.
    resetGuideSelection(channel.id);
    armPreviewForChannel(channel);
  }, [armPreviewForChannel]);

  const onFocusProgram = useCallback((program: Program, channel: Channel) => {
    guideSessionChannelId = channel.id;
    setGuideFocusedProgram(channel.id, program);
    armPreviewForChannel(channel);
  }, [armPreviewForChannel]);

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      // Drop guide preview before fullscreen allocates a decoder.
      if (previewTimer.current) clearTimeout(previewTimer.current);
      setPreviewId(null);
      addRecent(channel);
      openFullscreenPlayer(router, channel.id);
    },
    [addRecent, router],
  );

  const applyGroup = useCallback((next: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    groupChangedAt.current = Date.now();
    guideSessionGroup = next;
    guideSessionChannelId = null;
    setGroup(next);
    resetGuideSelection(null);
    setPreviewId(null);
    setGroupQuery("");
    setMoreGroupsOpen(false);
    // Scroll/filter reset only — never reclaim grid preferred focus (keeps chip focused).
    setResetToken((value) => value + 1);
    // Re-assert focus on the chip the user pressed after the list swaps.
    requestAnimationFrame(() => {
      const chip = groupChipRefs.current.get(next);
      if (chip) requestNativeFocus(chip);
    });
  }, []);

  const chooseGroup = useCallback(
    (next: string) => {
      if (hasPin && isGroupLocked(next)) {
        setPinPromptGroup(next);
        setPinDigits("");
        setPinError(false);
        return;
      }
      applyGroup(next);
    },
    [applyGroup, hasPin, isGroupLocked],
  );

  const submitPin = useCallback(() => {
    if (!pinPromptGroup) return;
    if (!verifyPin(pinDigits)) {
      setPinError(true);
      setPinDigits("");
      return;
    }
    unlockGroup(pinPromptGroup);
    const next = pinPromptGroup;
    setPinPromptGroup(null);
    setPinDigits("");
    setPinError(false);
    applyGroup(next);
  }, [applyGroup, pinDigits, pinPromptGroup, unlockGroup, verifyPin]);

  const togglePinGroup = useCallback(
    (name: string) => {
      void Haptics.selectionAsync().catch(() => undefined);
      if (pinnedGroups.includes(name)) {
        setPinnedGroups(unpinGroup(pinnedGroups, name));
      } else {
        setPinnedGroups(pinGroup(pinnedGroups, name));
      }
    },
    [pinnedGroups, setPinnedGroups],
  );

  const onFocusedGuideRow = useCallback((_index: number) => {
    // Intentionally no-op for trapFocus toggling — flipping traps mid-surf freezes TV focus.
  }, []);

  const onGuideUpBoundary = useCallback(() => {
    cancelGuideFocusRestore();
    const chip = groupChipRefs.current.get(group);
    // Group chips are permanently mounted. One synchronous request avoids a
    // delayed retry pulling focus back after the user moves across the tabs.
    if (chip) requestNativeFocus(chip);
  }, [group]);

  const onGuideLeftBoundary = useCallback(() => {
    // The preview/details/actions panel is the Guide's only left neighbor.
    focusGuidePreviewSurface();
  }, []);

  // One-shot Search/Health jump — apply on focus/mount only.
  useFocusEffect(
    useCallback(() => {
      const jump = consumeGuideJump();
      if (!jump) return;
      const nextGroup = jump.group || "All";
      if (hasPin && isGroupLocked(nextGroup)) {
        setPinPromptGroup(nextGroup);
        setPinDigits("");
        setPinError(false);
        guideSessionChannelId = jump.channelId;
        return;
      }
      guideSessionGroup = nextGroup;
      guideSessionChannelId = jump.channelId;
      setGroup(nextGroup);
      resetGuideSelection(jump.channelId);
      setGroupQuery("");
      setResetToken((value) => value + 1);
      const ch = channelById(jump.channelId);
      if (ch) {
        schedulePreview(jump.channelId, previewDelay + surfSettleExtraMs, !!ch.url);
      }
    }, [channelById, hasPin, isGroupLocked, previewDelay, schedulePreview, surfSettleExtraMs]),
  );

  const onPreviewStatus = useCallback((status: StreamStatus) => {
    setPreviewStatus(status);
  }, []);

  const onPreviewErrorRemount = useCallback(() => {
    if (previewRecoverTimer.current) clearTimeout(previewRecoverTimer.current);
    previewRecoverTimer.current = setTimeout(() => {
      previewRecoverTimer.current = null;
      setPreviewStatus("loading");
      setPreviewEpoch((value) => value + 1);
    }, 700);
  }, []);

  const renderGroupChip = useCallback(
    (item: string) => {
      const count = groupCounts[item] || 0;
      const label = `${chipLabel(item)}${count > 0 ? ` ${count}` : ""}`;
      return (
        <Pressable
          key={item}
          ref={(node) => {
            if (node) groupChipRefs.current.set(item, node);
            else groupChipRefs.current.delete(item);
          }}
          onPress={() => chooseGroup(item)}
          onLongPress={() => togglePinGroup(item)}
          delayLongPress={420}
          style={({ focused }: any) => [
            styles.groupChip,
            groupLayout === "vertical" && styles.groupChipVertical,
            group === item && styles.groupChipActive,
            pinnedGroups.includes(item) && styles.groupChipPinned,
            focused && styles.focused,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.groupText, group === item && styles.groupTextActive]}
          >
            {label}
          </Text>
        </Pressable>
      );
    },
    [chooseGroup, group, groupCounts, groupLayout, pinnedGroups, togglePinGroup],
  );

  return (
    <PurpleTvShell
      active="/guide"
      watchingChannelId={lastChannelId}
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <Animated.View
            pointerEvents={drawerOpen ? "auto" : "none"}
            style={[styles.guideTitleBlock, { opacity: headerTitleProgress }]}
          >
            <Text style={styles.kicker}>TV GUIDE</Text>
            <Text style={styles.title}>{group === "All" ? "All Channels" : group}</Text>
          </Animated.View>
          {groupLayout === "horizontal" ? (
            <Animated.View
              style={[
                styles.groupScroller,
                {
                  // Keep group chips full-bleed until the full drawer is open.
                  marginLeft: drawerOpen ? 140 : 0,
                  transform: [{ translateX: groupSlideX }],
                },
              ]}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupRow}>
                {groups.map(renderGroupChip)}
                {overflowGroups.length > 0 ? (
                  <Pressable
                    onPress={() => setMoreGroupsOpen(true)}
                    style={({ focused }: any) => [styles.groupChip, focused && styles.focused]}
                    testID="guide-more-groups"
                  >
                    <Text style={styles.groupText}>More groups</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            </Animated.View>
          ) : (
            <View style={[styles.groupScroller, { marginLeft: drawerOpen ? 140 : 0 }]}>
              <Text style={styles.verticalHeaderHint}>{chipLabel(group)}</Text>
              {showGroupSearch ? (
                <TextInput
                  value={groupQuery}
                  onChangeText={setGroupQuery}
                  placeholder="Filter in group"
                  placeholderTextColor={tvColors.textMuted}
                  style={styles.groupSearchInput}
                  testID="guide-group-search"
                />
              ) : (
                <Pressable
                  onPress={() => setSearchOpen(true)}
                  style={({ focused }: any) => [styles.searchReveal, focused && styles.focused]}
                >
                  <Ionicons name="search-outline" size={12} color={tvColors.purpleSoft} />
                  <Text style={styles.groupText}>Search</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {groupLayout === "horizontal" && showGroupSearch ? (
          <View style={styles.searchRow}>
            <TextInput
              value={groupQuery}
              onChangeText={setGroupQuery}
              placeholder="Filter in group"
              placeholderTextColor={tvColors.textMuted}
              style={styles.groupSearchInput}
              testID="guide-group-search"
            />
          </View>
        ) : null}

        <EpgProgressBar />
        {loading && channels.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={tvColors.purpleBright} size="large" />
            <Text style={styles.centerText}>Loading channels and guide…</Text>
            <Pressable
              focusable
              disabled={refreshing}
              onPress={() => void hardRefresh()}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="purple-guide-retry-loading"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Loading…" : "Retry now"}</Text>
            </Pressable>
          </View>
        ) : error && channels.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={32} color={tvColors.purpleSoft} />
            <Text style={styles.centerText}>{error}</Text>
            <Pressable
              focusable
              disabled={refreshing}
              onPress={() => void hardRefresh()}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="purple-guide-retry-error"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Reloading…" : "Reload guide"}</Text>
            </Pressable>
          </View>
        ) : channels.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="tv-outline" size={32} color={tvColors.purpleSoft} />
            <Text style={styles.centerText}>No channels in the current playlist yet.</Text>
            <Pressable
              focusable
              disabled={refreshing}
              onPress={() => void hardRefresh()}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="purple-guide-retry-empty"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Loading…" : "Reload guide"}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.body}>
            {groupLayout === "vertical" ? (
              <ScrollView
                style={styles.verticalGroups}
                contentContainerStyle={styles.verticalGroupList}
                showsVerticalScrollIndicator={false}
              >
                {groups.map(renderGroupChip)}
                {overflowGroups.length > 0 ? (
                  <Pressable
                    onPress={() => setMoreGroupsOpen(true)}
                    style={({ focused }: any) => [
                      styles.groupChip,
                      styles.groupChipVertical,
                      focused && styles.focused,
                    ]}
                    testID="guide-more-groups"
                  >
                    <Text style={styles.groupText}>More groups</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            ) : null}

            <GuideSelectionPreview
              width={detailsRailWidth}
              channelById={filteredChannelById}
              fallbackChannel={previewFallbackChannel}
              now={now}
              channelNumberById={channelNumberById}
              showChannelNumbers={channelNumbers}
              showLogos={channelLogos && !surfLogosSuppressed}
              favoriteSet={favoriteSet}
              reminderKeys={reminderKeys}
              hidePreview={hidePreview}
              muted={mutePreview}
              onToggleMute={() => setMutePreview(!mutePreview)}
              previewId={safePreviewMode === "off" ? null : previewId}
              previewStatus={previewStatus}
              previewEpoch={previewEpoch}
              onPreviewStatus={onPreviewStatus}
              onPreviewErrorRemount={onPreviewErrorRemount}
              onPlay={play}
              onFavorite={toggleFavorite}
              onToggleReminder={(program, channel) => void toggleReminder(program, channel)}
              onHideToggle={() => setHidePreview(!hidePreview)}
            />

            {/* The preview/details/actions rail is a fixed left sibling. The Guide
                owns the remaining width on the right; neither panel overlaps the other. */}
            <FocusGuide
              style={styles.gridPanel}
              trapFocusDown
              // Row-level Left handling owns the exact preview-button handoff.
              trapFocusLeft={false}
              trapFocusRight
            >
              {guideLayout === "compact" ? (
                <BoxGrid
                  channels={filtered}
                  now={now}
                  onChannelPress={play}
                  onProgramPress={openProgram}
                  onChannelFocus={onFocusChannel}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={channelLogos && !surfLogosSuppressed}
                  reminderKeys={gridReminderKeys}
                  resetToken={resetToken}
                  active={!activeProgram && !drawerOpen}
                  // Preview is the native Left neighbor; the closed drawer has
                  // no mounted focus tree and therefore needs no self-lock.
                  lockLeftEdge={false}
                  restoreChannelId={guideSessionChannelId}
                  onUpBoundary={onGuideUpBoundary}
                  onLeftBoundary={onGuideLeftBoundary}
                  onFocusedRowChange={onFocusedGuideRow}
                  onViewportChannelIds={onViewportChannelIds}
                />
              ) : (
                <TimelineGrid
                  channels={filtered}
                  windowStart={windowStart}
                  windowEnd={windowEnd}
                  now={now}
                  onChannelPress={play}
                  onProgramPress={openProgram}
                  onProgramFocus={onFocusProgram}
                  onChannelFocus={onFocusChannel}
                  onChannelLongPress={onChannelLongPress}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  density={guideDensity}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={channelLogos && !surfLogosSuppressed}
                  reminderKeys={gridReminderKeys}
                  resetToken={resetToken}
                  active={!activeProgram && !drawerOpen}
                  // Preview is the native Left neighbor; the closed drawer has
                  // no mounted focus tree and therefore needs no self-lock.
                  lockLeftEdge={false}
                  restoreChannelId={guideSessionChannelId}
                  onUpBoundary={onGuideUpBoundary}
                  onLeftBoundary={onGuideLeftBoundary}
                  onFocusedRowChange={onFocusedGuideRow}
                  onViewportChannelIds={onViewportChannelIds}
                  onBackTargetChange={onGuideBackTarget}
                  reduceMotion={instantGuide}
                />
              )}
            </FocusGuide>
          </View>
        )}

        {moreGroupsOpen ? (
          <View style={styles.overlay} testID="guide-more-groups-overlay">
            <View style={styles.overlayCard}>
              <View style={styles.overlayHeader}>
                <Text style={styles.overlayTitle}>More groups</Text>
                <Pressable
                  onPress={() => setMoreGroupsOpen(false)}
                  style={({ focused }: any) => [styles.overlayClose, focused && styles.focused]}
                >
                  <Text style={styles.secondaryText}>Close</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.overlayList} showsVerticalScrollIndicator={false}>
                {(() => {
                  let lastLetter = "";
                  return overflowGroups.map((item) => {
                    const letter = (item.trim().charAt(0) || "#").toUpperCase();
                    const showLetter = letter !== lastLetter;
                    if (showLetter) lastLetter = letter;
                    return (
                      <View key={item}>
                        {showLetter ? <Text style={styles.overlayLetter}>{letter}</Text> : null}
                        <Pressable
                          onPress={() => chooseGroup(item)}
                          onLongPress={() => togglePinGroup(item)}
                          delayLongPress={420}
                          style={({ focused }: any) => [styles.overlayRow, focused && styles.focused]}
                        >
                          <Text style={styles.overlayRowText} numberOfLines={1}>
                            {item}
                            {groupCounts[item] ? `  ${groupCounts[item]}` : ""}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  });
                })()}
              </ScrollView>
            </View>
          </View>
        ) : null}

        {pinPromptGroup ? (
          <View style={styles.overlay} testID="guide-pin-overlay">
            <View style={styles.pinCard}>
              <Text style={styles.overlayTitle}>Enter PIN</Text>
              <Text style={styles.pinHint}>Unlock “{pinPromptGroup}”</Text>
              <Text style={styles.pinDigits}>{pinDigits.padEnd(4, "•").slice(0, 4)}</Text>
              {pinError ? <Text style={styles.pinError}>Incorrect PIN</Text> : null}
              <View style={styles.pinPad}>
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit) => (
                  <Pressable
                    key={digit}
                    onPress={() => {
                      setPinError(false);
                      setPinDigits((prev) => {
                        const next = (prev + digit).slice(0, 8);
                        return next;
                      });
                    }}
                    style={({ focused }: any) => [styles.pinKey, focused && styles.focused]}
                  >
                    <Text style={styles.pinKeyText}>{digit}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.pinActions}>
                <Pressable
                  onPress={() => {
                    setPinPromptGroup(null);
                    setPinDigits("");
                    setPinError(false);
                  }}
                  style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
                >
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submitPin}
                  style={({ focused }: any) => [styles.watchButton, focused && styles.focused]}
                >
                  <Text style={styles.watchText}>Unlock</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 12, gap: 5 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", position: "relative" },
  guideTitleBlock: { position: "absolute", left: 0, width: 130 },
  groupScroller: { flex: 1, minWidth: 0 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 17, marginTop: 1, minWidth: 120 },
  groupRow: { gap: 5, alignItems: "center", paddingHorizontal: 4 },
  groupChip: {
    minHeight: 28,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panel,
  },
  groupChipVertical: { width: "100%", paddingHorizontal: 8, marginBottom: 4 },
  groupChipActive: { backgroundColor: tvColors.purple },
  groupChipPinned: { borderColor: "rgba(168,85,247,0.45)" },
  groupText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  groupTextActive: { color: "#fff", fontFamily: fonts.semibold },
  verticalHeaderHint: { color: "#fff", fontFamily: fonts.bold, fontSize: 14 },
  searchRow: { minHeight: 30 },
  searchReveal: {
    minHeight: 26,
    maxWidth: 120,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panel,
  },
  groupSearchInput: {
    minHeight: 28,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: tvColors.line,
    backgroundColor: tvColors.panel,
    color: "#fff",
    fontFamily: fonts.medium,
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  body: { flex: 1, flexDirection: "row", gap: 8, minHeight: 0 },
  verticalGroups: { width: 118, flexShrink: 0, maxHeight: "100%" },
  verticalGroupList: { paddingVertical: 2, paddingRight: 2 },
  gridPanel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: tvColors.canvasRaised,
    borderWidth: 1,
    borderColor: tvColors.line,
    borderRadius: radius.sm,
  },
  watchButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 27,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: tvColors.purple,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    paddingHorizontal: 3,
  },
  watchText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 7.5 },
  secondaryButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 27,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: tvColors.panelRaised,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    paddingHorizontal: 3,
  },
  secondaryText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.2 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
    padding: 24,
  },
  overlayCard: {
    width: "72%",
    maxWidth: 420,
    maxHeight: "70%",
    backgroundColor: tvColors.panel,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: tvColors.line,
    padding: 12,
  },
  overlayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  overlayTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 14 },
  overlayClose: {
    minHeight: 28,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panelRaised,
  },
  overlayList: { maxHeight: 280 },
  overlayLetter: {
    color: tvColors.purpleSoft,
    fontFamily: fonts.bold,
    fontSize: 10,
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  overlayRow: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panelRaised,
    marginBottom: 4,
  },
  overlayRowText: { color: "#fff", fontFamily: fonts.medium, fontSize: 11 },
  pinCard: {
    width: 280,
    backgroundColor: tvColors.panel,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: tvColors.line,
    padding: 14,
    gap: 8,
  },
  pinHint: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10 },
  pinDigits: {
    color: "#fff",
    fontFamily: fonts.bold,
    fontSize: 22,
    letterSpacing: 8,
    textAlign: "center",
    marginVertical: 4,
  },
  pinError: { color: "#f87171", fontFamily: fonts.medium, fontSize: 10, textAlign: "center" },
  pinPad: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  pinKey: {
    width: 44,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panelRaised,
  },
  pinKeyText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  pinActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  centerText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 11, textAlign: "center", maxWidth: 320 },
  retryButton: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.purple,
    marginTop: 4,
  },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
