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
  focusPurpleIconRail,
  usePurpleTvDrawer,
} from "@/src/components/PurpleTvShell";
import { TimelineGrid } from "@/src/components/TimelineGrid";
import { BoxGrid } from "@/src/components/BoxGrid";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { GuidePreviewRail } from "@/src/components/GuidePreviewRail";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { NowPlayingBar } from "@/src/components/NowPlayingBar";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { setPriorityMatchChannelIds, setViewportGuideChannelIds } from "@/src/source";
import { markGuideSurfing } from "@/src/utils/guideSurfGate";
import { hasGuidePrograms, useGuidePrograms } from "@/src/core/guideProgramsStore";
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
import { nowNext } from "@/src/utils/time";
import { requestNativeFocus, requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { setGuideNavigationActive } from "@/src/utils/tvRemote";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { MODAL_FOCUS_RETRY_DELAYS_MS } from "@/src/core/guideRegressionPolicy";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import type { StreamStatus } from "@/src/components/StreamPlayer";

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

export default function PurpleGuideScreen() {
  const router = useRouter();
  const { drawerOpen } = usePurpleTvDrawer();
  const { width: screenWidth } = useWindowDimensions();
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
    addReminder,
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
    epgGuideFilter,
    clock24h,
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
  const [focusedId, setFocusedId] = useState<string | null>(() => guideSessionChannelId);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [resetToken, setResetToken] = useState(0);
  const [groupQuery, setGroupQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreGroupsOpen, setMoreGroupsOpen] = useState(false);
  const [pinPromptGroup, setPinPromptGroup] = useState<string | null>(null);
  const [pinDigits, setPinDigits] = useState("");
  const [pinError, setPinError] = useState(false);
  const metadataTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRecoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupChangedAt = useRef(0);
  const bootRetryRef = useRef(0);
  const groupChipRefs = useRef(new Map<string, any>());
  const lastFocusAtRef = useRef(0);
  const rapidSurfUntilRef = useRef(0);
  const lastGuideFocusNodeRef = useRef<unknown>(null);
  const hadProgramModalRef = useRef(false);
  const previousDrawerOpenRef = useRef(drawerOpen);
  const headerTitleProgress = useRef(new Animated.Value(drawerOpen ? 1 : 0)).current;
  const groupSlideX = useRef(new Animated.Value(0)).current;
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const reminderKeys = useMemo(() => new Set(reminders.map((item) => item.key)), [reminders]);
  // Freeze grid reminder badges while the program sheet is open so Cancel/Remind
  // doesn't rebuild the FlashList under the modal (Fire TV crash / hitch source).
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
        duration: PURPLE_DRAWER_ANIMATION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(groupSlideX, {
        toValue: 0,
        duration: PURPLE_DRAWER_ANIMATION_MS,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [drawerOpen, groupSlideX, headerTitleProgress]);

  // After the drawer closes on Guide, restore the last grid cell — content autoFocus
  // is intentionally skipped on /guide, so without this Left→drawer→close loses focus.
  const drawerWasOpenForFocusRef = useRef(drawerOpen);
  const [gridReclaimToken, setGridReclaimToken] = useState(0);
  useEffect(() => {
    const wasOpen = drawerWasOpenForFocusRef.current;
    drawerWasOpenForFocusRef.current = drawerOpen;
    if (!wasOpen || drawerOpen || activeProgram) return;
    // Reclaim immediately; the closed rail is decorative and cannot win focus.
    const cancel = requestNativeFocusWithRetry(lastGuideFocusNodeRef.current, [0, 40, 120, 280, 480, 720]);
    const fallback = setTimeout(() => {
      setGridReclaimToken((value) => value + 1);
    }, 500);
    return () => {
      cancel?.();
      clearTimeout(fallback);
    };
  }, [activeProgram, drawerOpen]);

  // After Remind/Cancel sheet closes, return focus to the guide cell — never Live TV.
  useEffect(() => {
    if (activeProgram) return;
    if (!hadProgramModalRef.current) return;
    hadProgramModalRef.current = false;
    return requestNativeFocusWithRetry(lastGuideFocusNodeRef.current, [...MODAL_FOCUS_RETRY_DELAYS_MS]);
  }, [activeProgram]);

  const onGuideFocusNode = useCallback((node: unknown) => {
    if (node) lastGuideFocusNodeRef.current = node;
  }, []);

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

  // Never arm native Up/Down consumption — Android must move guide focus freely.
  useEffect(() => {
    setGuideNavigationActive(false);
    return () => setGuideNavigationActive(false);
  }, []);
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
      if (metadataTimer.current) clearTimeout(metadataTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (previewRecoverTimer.current) clearTimeout(previewRecoverTimer.current);
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

  const onViewportChannelIds = useCallback((ids: string[]) => {
    setViewportGuideChannelIds(ids);
    if (channels.length >= 400) {
      setPriorityMatchChannelIds(ids.slice(0, 400));
    } else {
      setPriorityMatchChannelIds([]);
    }
    void patchProgramsForChannelIds(ids);
  }, [channels.length, patchProgramsForChannelIds]);

  const viewportSeedKeyRef = useRef("");
  // Seed only on cold load/group/reset. A silent refresh must not yank a deeply
  // scrolled guide's EPG query scope back to the first channels.
  useEffect(() => {
    if (!filtered.length) return;
    const key = `${group}:${resetToken}`;
    if (viewportSeedKeyRef.current === key) return;
    viewportSeedKeyRef.current = key;
    const ids = filtered.slice(0, 24).map((c) => c.id);
    setViewportGuideChannelIds(ids);
    setPriorityMatchChannelIds(channels.length >= 400 ? ids : []);
  }, [channels.length, filtered, group, resetToken]);

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

  const previewChannel = useMemo(() => {
    const focused = focusedId ? filtered.find((c) => c.id === focusedId) : null;
    if (focused) return focused;
    const last = lastChannelId ? filtered.find((c) => c.id === lastChannelId) : null;
    return last || filtered.find((c) => hasGuidePrograms(c.id)) || filtered[0] || null;
  }, [filtered, focusedId, lastChannelId]);
  const previewPrograms = useGuidePrograms(previewChannel?.id);

  const { current, next: nextProgram } = useMemo(
    () => (previewChannel ? nowNext(previewPrograms, new Date(now)) : {}),
    [now, previewChannel, previewPrograms],
  );
  const previewVisible =
    !hidePreview &&
    safePreviewMode !== "off" &&
    !!previewChannel?.url &&
    previewId === previewChannel.id &&
    previewStatus !== "error";

  useEffect(() => {
    if (previewStatus === "error" && previewChannel?.id) {
      noteStreamFailure(previewChannel.id);
    }
  }, [previewChannel?.id, previewStatus]);

  // delayed: longest settle; surf: off while surfing + longer arm on weak sticks; on: normal.
  const previewDelay =
    safePreviewMode === "delayed" || safePreviewMode === "surf"
      ? powerTuning.previewArmDelayedMs
      : powerTuning.previewArmOnMs;
  /** Extra arm after rapid surf settles — weak Fire sticks need decoder breathing room. */
  const surfSettleExtraMs =
    safePreviewMode === "surf"
      ? powerTuning.surfSettleExtraMs + 150
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
    // The former rail used a 0.78 / 1.9 flex relationship, clamped to 228–340.
    // Recreate that effective width, then reduce it by exactly 30% so the
    // reclaimed space always goes to the guide on both 720p and 1080p TVs.
    const available = Math.max(480, screenWidth - 196);
    const former = Math.min(340, Math.max(228, available * (0.78 / (1.9 + 0.78))));
    return Math.round(Math.min(238, Math.max(160, former * 0.7)));
  }, [screenWidth]);

  const onFocusChannel = useCallback(
    (channel: Channel) => {
      if (metadataTimer.current) clearTimeout(metadataTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
      const requestedId = channel.id;
      guideSessionChannelId = requestedId;
      const nowTs = Date.now();
      const rapid = nowTs - lastFocusAtRef.current < 240;
      lastFocusAtRef.current = nowTs;
      if (rapid) rapidSurfUntilRef.current = nowTs + powerTuning.rapidSurfHoldMs;
      if (rapid || nowTs < rapidSurfUntilRef.current) {
        markGuideSurfing(powerTuning.rapidSurfHoldMs);
      }

      // While the user is holding/repeating directions: zero rail/preview work.
      // "surf" mode (and delayed/on) soft-clear preview while surfing — never share decoder with fullscreen path.
      if (nowTs < rapidSurfUntilRef.current || rapid) {
        // Soft surf: drop live preview so decoder/GPU do not fight FlashList focus.
        setPreviewId(null);
        if (logosOffWhileSurfing) setSurfLogosSuppressed(true);
        metadataTimer.current = setTimeout(() => {
          if (Date.now() < rapidSurfUntilRef.current) return;
          setFocusedId(requestedId);
          schedulePreview(
            requestedId,
            previewDelay + surfSettleExtraMs,
            !!channel.url,
          );
        }, Math.max(750, powerTuning.rapidSurfHoldMs + 50));
        return;
      }

      const recentlyChangedGroup = nowTs - groupChangedAt.current < 1800;
      const delay = recentlyChangedGroup
        ? Math.max(previewDelay + surfSettleExtraMs, powerTuning.previewArmDelayedMs)
        : previewDelay;

      metadataTimer.current = setTimeout(() => {
        setFocusedId((prev) => (prev === requestedId ? prev : requestedId));
        schedulePreview(requestedId, delay, !!channel.url);
      }, powerTuning.focusMetadataMs);
    },
    [logosOffWhileSurfing, powerTuning, previewDelay, schedulePreview, surfSettleExtraMs],
  );

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      // Drop guide preview before fullscreen allocates a decoder (avoids dual VLC on Fire TV).
      if (metadataTimer.current) clearTimeout(metadataTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
      setPreviewId(null);
      addRecent(channel);
      openFullscreenPlayer(router, channel.id);
    },
    [addRecent, router],
  );

  const applyGroup = useCallback((next: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (metadataTimer.current) clearTimeout(metadataTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    groupChangedAt.current = Date.now();
    guideSessionGroup = next;
    guideSessionChannelId = null;
    setGroup(next);
    setFocusedId(null);
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
    // Intentionally no-op for trapFocus toggling — flipping traps mid-surf freezes Fire TV focus.
  }, []);

  const onGuideUpBoundary = useCallback(() => {
    const chip = groupChipRefs.current.get(group);
    if (chip) requestNativeFocusWithRetry(chip, [0, 40, 120]);
  }, [group]);

  const onGuideLeftBoundary = useCallback(() => {
    if (!drawerOpen) focusPurpleIconRail("menu");
  }, [drawerOpen]);

  const jumpToNow = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    setNow(new Date().toISOString());
    setResetToken((value) => value + 1);
    setGridReclaimToken((value) => value + 1);
    requestAnimationFrame(() => {
      requestNativeFocusWithRetry(lastGuideFocusNodeRef.current, [0, 40, 120, 280]);
    });
  }, []);

  const resetGuide = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (metadataTimer.current) clearTimeout(metadataTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    groupChangedAt.current = Date.now();
    guideSessionGroup = "All";
    guideSessionChannelId = null;
    setGroup("All");
    setFocusedId(null);
    setPreviewId(null);
    setGroupQuery("");
    setResetToken((value) => value + 1);
    void hardRefresh();
  }, [hardRefresh]);

  const contextActions = useMemo(
    () => [
      {
        label: "Jump to Now",
        icon: "locate-outline" as const,
        onPress: jumpToNow,
        testID: "purple-guide-jump-now",
      },
      {
        label: "Favorites",
        icon: "heart-outline" as const,
        onPress: () => chooseGroup("Favorites"),
        testID: "purple-guide-ctx-favorites",
      },
      {
        label: "All Channels",
        icon: "list-outline" as const,
        onPress: () => chooseGroup("All"),
        testID: "purple-guide-ctx-all",
      },
    ],
    [chooseGroup, jumpToNow],
  );

  const recentChannels = useMemo(
    () =>
      recent.slice(0, 5).map((channel) => ({
        id: channel.id,
        name: channel.name,
        logo: channel.logo,
      })),
    [recent],
  );

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
      setFocusedId(jump.channelId);
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
      footerAction={{
        label: "Reset",
        icon: "refresh-outline",
        onPress: resetGuide,
        disabled: refreshing,
        testID: "purple-guide-reset",
      }}
      contextActions={contextActions}
      watchingChannelId={lastChannelId}
      recentChannels={recentChannels}
      onRecentPress={(id) => {
        const ch = channelById(id);
        if (ch) play(ch);
      }}
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
                  // Full-bleed when the closed icon rail overlays; title shift only while drawer open.
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
        <NowPlayingBar testID="guide-now-playing" />

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

            {/* No autoFocus / trapFocusUp — preferred focus is mount-once on row 0, and Up-escape
                is gated inside the grid. Flipping traps mid-surf freezes Fire TV focus. */}
            <FocusGuide
              style={styles.gridPanel}
              trapFocusDown
              trapFocusLeft={!drawerOpen}
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
                  lockLeftEdge={!drawerOpen}
                  restoreChannelId={guideSessionChannelId}
                  onUpBoundary={onGuideUpBoundary}
                  onLeftBoundary={onGuideLeftBoundary}
                  onFocusedRowChange={onFocusedGuideRow}
                  onViewportChannelIds={onViewportChannelIds}
                  onGuideFocusNode={onGuideFocusNode}
                />
              ) : (
                <TimelineGrid
                  channels={filtered}
                  windowStart={windowStart}
                  windowEnd={windowEnd}
                  now={now}
                  onChannelPress={play}
                  onProgramPress={openProgram}
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
                  lockLeftEdge={!drawerOpen}
                  restoreChannelId={guideSessionChannelId}
                  onUpBoundary={onGuideUpBoundary}
                  onLeftBoundary={onGuideLeftBoundary}
                  onFocusedRowChange={onFocusedGuideRow}
                  onGuideFocusNode={onGuideFocusNode}
                  onViewportChannelIds={onViewportChannelIds}
                  onBackTargetChange={onGuideBackTarget}
                  reclaimToken={gridReclaimToken}
                />
              )}
            </FocusGuide>

            <GuidePreviewRail
              width={detailsRailWidth}
              channel={previewChannel}
              current={current}
              next={nextProgram}
              now={now}
              channelNumber={previewChannel ? channelNumberById[previewChannel.id] : undefined}
              showChannelNumbers={channelNumbers}
              showLogos={channelLogos && !surfLogosSuppressed}
              isFavorite={!!previewChannel && favoriteSet.has(previewChannel.id)}
              hidePreview={hidePreview}
              muted={mutePreview}
              onToggleMute={() => setMutePreview(!mutePreview)}
              previewVisible={previewVisible}
              previewEpoch={previewEpoch}
              onPreviewStatus={onPreviewStatus}
              onPreviewErrorRemount={onPreviewErrorRemount}
              onPlay={() => previewChannel && play(previewChannel)}
              onFavorite={() => previewChannel && toggleFavorite(previewChannel.id)}
              onRemind={() => {
                if (current && previewChannel) void addReminder(current, previewChannel);
              }}
              onInfo={() => {
                if (current && previewChannel) openProgram(current, previewChannel);
              }}
              onHideToggle={() => setHidePreview(!hidePreview)}
              clock24h={clock24h}
            />
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
