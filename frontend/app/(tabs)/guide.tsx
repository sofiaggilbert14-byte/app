import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  PurpleTvShell,
  usePurpleTvDrawer,
  type PurpleGuideGroup,
} from "@/src/components/PurpleTvShell";
import { NativeGuideCanvas } from "@/src/components/NativeGuideCanvas";
import { PurpleGuideGroupDrawer } from "@/src/components/PurpleGuideGroupDrawer";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { GuidePreviewRail } from "@/src/components/GuidePreviewRail";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { Channel, Program } from "@/src/api";
import { useStore } from "@/src/store";
import { setPriorityMatchChannelIds, setViewportGuideChannelIds } from "@/src/source";
import { isGuideSurfing, markGuideSurfing, setGuideScreenActive } from "@/src/utils/guideSurfGate";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { getGuideRailMetrics } from "@/src/core/guideLayoutPolicy";
import { buildGuideRunwayIds } from "@/src/core/guideRunwayPolicy";
import {
  buildChannelIndexMap,
  expandRunwayKeepSet,
} from "@/src/core/guideSlidingCache";
import {
  getGuideSelection,
  resetGuideSelection,
  setGuideFocusedProgram,
  useGuideSelection,
} from "@/src/core/guideSelectionStore";
import { getPowerProfileTuning } from "@/src/core/devicePowerProfile";
import { shouldUseLowRamTuning, useDeviceMemoryProfile } from "@/src/core/deviceMemoryProfile";
import { channelHasOwnedEpgMatch } from "@/src/core/epgUserOverrides";
import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";
import {
  buildGroupCounts,
  buildVisibleGroups,
  filterChannelsByGroup,
  listPlaylistGroupNames,
  pinGroup,
  unpinGroup,
} from "@/src/core/guideGroups";
import { GUIDE_START_LAST_USED, useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { useCustomGuideGroups } from "@/src/core/customGuideGroups";
import { resolveChannelNumber, useChannelCustomize } from "@/src/core/channelCustomize";
import { useParentalPin } from "@/src/core/parentalPin";
import {
  clearStreamFailure,
  failedStreamCount,
  isFailedChannel,
  noteStreamFailure,
} from "@/src/core/streamFailureRegistry";
import { consumeGuideJump, peekGuideJump } from "@/src/core/guideSearchJump";
import { consumeGuideGroupsOnEntry } from "@/src/core/guideEntryIntent";
import { fonts, spacing, tvColors } from "@/src/theme";
import { nowNext } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import type { StreamStatus } from "@/src/components/StreamPlayer";
import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";
import { addTvLongPressListener, setGuideNavigationActive, setGuideRepeatInterval, setRemoteContext } from "@/src/utils/tvRemote";
import { focusGuidePreviewSurface } from "@/src/utils/guidePreviewFocus";
import { useRemoteShortcutPreferences } from "@/src/core/remoteShortcutPreferences";

// Session-only guide position survives the root player route unmounting tabs.
// Do not persist to disk: this is navigation state, not a user preference.
let guideSessionGroup = "All";
let guideSessionChannelId: string | null = null;
const guideSessionChannelByGroup = new Map<string, string>();
const MAX_REMEMBERED_GUIDE_GROUPS = 128;
function rememberGuideGroupChannel(groupName: string, channelId: string): void {
  if (!groupName || !channelId) return;
  guideSessionChannelByGroup.delete(groupName);
  guideSessionChannelByGroup.set(groupName, channelId);
  while (guideSessionChannelByGroup.size > MAX_REMEMBERED_GUIDE_GROUPS) {
    const oldest = guideSessionChannelByGroup.keys().next().value;
    if (!oldest) break;
    guideSessionChannelByGroup.delete(oldest);
  }
}

/**
 * The only React subtree subscribed to logical Guide selection. The native
 * canvas and screen shell therefore stay render-stable while the cursor moves;
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
  onOpenReminders,
  onHideToggle,
  onOpenDrawer,
  onActionsFocusChange,
  guideFocusTag,
}: {
  width: number;
  channelById: ReadonlyMap<string, Channel>;
  fallbackChannel: Channel | null;
  now: string;
  channelNumberById: Record<string, number>;
  showChannelNumbers: boolean;
  showLogos: boolean;
  favoriteSet: ReadonlySet<string>;
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
  onOpenReminders: () => void;
  onHideToggle: () => void;
  onOpenDrawer: () => void;
  onActionsFocusChange: (focused: boolean) => void;
  guideFocusTag?: number | null;
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
  const previewVisible =
    !hidePreview &&
    !!channel?.url &&
    previewId === channel.id &&
    previewStatus !== "error";

  useEffect(() => {
    if (!channel?.id) return;
    if (previewStatus === "error") noteStreamFailure(channel.id);
    if (previewStatus === "playing") clearStreamFailure(channel.id);
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
      onOpenReminders={onOpenReminders}
      onHideToggle={onHideToggle}
      onOpenDrawer={onOpenDrawer}
      onActionsFocusChange={onActionsFocusChange}
      guideFocusTag={guideFocusTag}
    />
  );
}

export default function PurpleGuideScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { drawerOpen, openDrawer, closeDrawer } = usePurpleTvDrawer();
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  useFocusEffect(
    useCallback(() => {
      setGuideScreenActive(true);
      setRemoteContext("guide");
      setGuideNavigationActive(true);
      return () => {
        setGuideScreenActive(false);
        setGuideNavigationActive(false);
        setRemoteContext("default");
      };
    }, []),
  );
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
    openProgram,
    activeProgram,
    favorites,
    recent,
    recentIds,
    lastChannelId,
    channelById,
    toggleFavorite,
    guideDensity,
    safePreviewMode,
    channelNumbers,
    channelLogos,
    powerProfile,
    logosOffWhileSurfing,
    epgGuideFilter,
    retainGuideSlidingCache,
    releaseGuideSlidingCache,
  } = useStore();
  const remoteShortcuts = useRemoteShortcutPreferences();

  const {
    pinnedGroups,
    hidePreview,
    mutePreview,
    startGroup,
    setPinnedGroups,
    setHidePreview,
    setMutePreview,
    showProviderGroups,
    hiddenGroups,
  } = useGuideUiPreferences();
  const customGuideGroups = useCustomGuideGroups();
  const epgOwnership = useEpgSourcePreferences();
  const epgMatchOwnership = useMemo(() => ({
    primaryEnabled: epgOwnership.primaryEnabled,
    userEnabled: epgOwnership.userEnabled,
    userOverrides: epgOwnership.userOverrides,
  }), [epgOwnership.primaryEnabled, epgOwnership.userEnabled, epgOwnership.userOverrides]);
  const hasOwnedEpgMatch = useCallback(
    (channel: Channel) => channelHasOwnedEpgMatch(channel, epgMatchOwnership),
    [epgMatchOwnership],
  );
  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();
  const hiddenIdSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const { isGroupLocked, unlockGroup, verifyPin, hasPin } = useParentalPin();

  const deviceMemoryProfile = useDeviceMemoryProfile();
  const effectivePowerProfile = shouldUseLowRamTuning(deviceMemoryProfile) && powerProfile === "normal"
    ? "weak"
    : powerProfile;
  const powerTuning = useMemo(() => getPowerProfileTuning(effectivePowerProfile), [effectivePowerProfile]);
  useEffect(() => {
    setGuideRepeatInterval(powerTuning.guideRepeatIntervalMs);
  }, [powerTuning.guideRepeatIntervalMs]);
  const [surfLogosSuppressed, setSurfLogosSuppressed] = useState(false);

  const [now, setNow] = useState(() => new Date().toISOString());
  const [group, setGroup] = useState(() => guideSessionGroup);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [previewActionsFocused, setPreviewActionsFocused] = useState(false);
  const [nativeGuideFocusTag, setNativeGuideFocusTag] = useState<number | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [restoreTimeMs, setRestoreTimeMs] = useState<number | null>(null);
  // Explicit Search/player jumps may target a channel hidden by the saved Matched/Unmatched filter.
  // Keep one session-only bypass row until the user manually navigates away; never rewrite the saved filter.
  const [jumpFilterBypassId, setJumpFilterBypassId] = useState<string | null>(null);
  const [pinPromptGroup, setPinPromptGroup] = useState<string | null>(null);
  const [pinDigits, setPinDigits] = useState("");
  const [pinError, setPinError] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRecoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoryLogoRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runwayPatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRunwayPatchRef = useRef<{ ids: string[]; priorityIds: string[] } | null>(null);
  const groupChangedAt = useRef(0);
  const bootRetryRef = useRef(0);
  const lastFocusAtRef = useRef(0);
  const rapidSurfUntilRef = useRef(0);
  const hadProgramModalRef = useRef(false);
  const modalOriginRef = useRef<{ channelId: string; programStart: string } | null>(null);
  const orderedFilteredIdsRef = useRef<string[]>([]);
  const filteredIdIndexRef = useRef<Map<string, number>>(new Map());
  const lastRunwayRef = useRef<{ ids: string[]; priority: string[]; pageSize: number }>({
    ids: [],
    priority: [],
    pageSize: 8,
  });
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const startPreferenceAppliedRef = useRef(false);
  const wasFocusedRef = useRef(false);
  useEffect(() => {
    if (isFocused && !wasFocusedRef.current) startPreferenceAppliedRef.current = false;
    wasFocusedRef.current = isFocused;
  }, [isFocused]);
  useEffect(() => {
    resetGuideSelection(guideSessionChannelId);
  }, []);
  useEffect(
    () => subscribeAndroidMemoryPressure((pressure) => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = null;
      if (previewRecoverTimer.current) clearTimeout(previewRecoverTimer.current);
      previewRecoverTimer.current = null;
      if (surfReleaseTimer.current) clearTimeout(surfReleaseTimer.current);
      surfReleaseTimer.current = null;
      if (memoryLogoRestoreTimer.current) clearTimeout(memoryLogoRestoreTimer.current);
      // Moderate pressure should shed disposable image/cache work without
      // killing a healthy settled preview. Only critical pressure releases
      // the decoder; this avoids the live preview disappearing a few seconds
      // after tune on memory-constrained Android TV devices.
      if (pressure === "critical") setPreviewId(null);
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
    [],
  );
  useEffect(() => {
    if (activeProgram) hadProgramModalRef.current = true;
  }, [activeProgram]);

  const openDrawerFromPreview = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    openDrawer({ focusTop: true });
  }, [openDrawer]);

  const openGuideSources = useCallback(() => {
    closeDrawer();
    router.replace("/epg-sources" as any);
  }, [closeDrawer, router]);

  // After Remind/Cancel sheet closes, return focus to the guide cell — never Live TV.
  useEffect(() => {
    if (activeProgram) return;
    if (!hadProgramModalRef.current) return;
    hadProgramModalRef.current = false;
    const origin = modalOriginRef.current;
    modalOriginRef.current = null;
    if (origin?.channelId) guideSessionChannelId = origin.channelId;
  }, [activeProgram]);

  // Phase 9 navigation ladder: Guide -> Groups drawer -> Main drawer.
  // Native remote ownership consumes group-drawer boundary keys, so the Guide
  // cannot also move underneath the drawer.
  useTvBackHandler(
    useCallback(() => {
      if (drawerOpen || activeProgram) return false;
      if (groupDrawerOpen) {
        setGroupDrawerOpen(false);
        openDrawer();
        return true;
      }
      setGroupDrawerOpen(true);
      return true;
    }, [activeProgram, drawerOpen, groupDrawerOpen, openDrawer]),
  );

  useEffect(() => {
    if (!isFocused) return;
    const sub = DeviceEventEmitter.addListener("CharmGuideGroupsRequestOpen", () => {
      closeDrawer();
      setGroupDrawerOpen(true);
    });
    return () => sub.remove();
  }, [closeDrawer, isFocused]);

  useFocusEffect(
    useCallback(() => {
      if (consumeGuideGroupsOnEntry()) setGroupDrawerOpen(true);
    }, []),
  );

  useEffect(() => {
    if (!isFocused || drawerOpen || groupDrawerOpen || activeProgram) return;
    return addTvLongPressListener((key) => {
      if (key !== "SELECT") return;
      const selection = getGuideSelection();
      const channelId = selection.channelId || guideSessionChannelId;
      const channel = channelId ? channelById(channelId) : null;
      if (selection.surface === "channel" || remoteShortcuts.longSelect === "favorite") {
        if (channelId) toggleFavorite(channelId);
      } else if (remoteShortcuts.longSelect === "controls" && selection.program && channel) {
        modalOriginRef.current = { channelId: channel.id, programStart: selection.program.start };
        openProgram(selection.program, channel);
      }
    });
  }, [activeProgram, channelById, drawerOpen, groupDrawerOpen, isFocused, openProgram, remoteShortcuts.longSelect, toggleFavorite]);

  useEffect(() => {
    if (loading || refreshing || channels.length > 0) return;
    if (bootRetryRef.current >= 1) return;
    bootRetryRef.current += 1;
    const timer = setTimeout(() => void hardRefresh(), 5000);
    return () => clearTimeout(timer);
  }, [loading, refreshing, channels.length, hardRefresh]);

  // Tick often enough for the timeline "now" indicator / progress fills without
  // rebuilding guide geometry (the native canvas owns its layout).
  useEffect(() => {
    if (!isFocused) return;
    setNow(new Date().toISOString());
    const timer = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(timer);
  }, [isFocused]);

  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (previewRecoverTimer.current) clearTimeout(previewRecoverTimer.current);
      if (surfReleaseTimer.current) clearTimeout(surfReleaseTimer.current);
      if (memoryLogoRestoreTimer.current) clearTimeout(memoryLogoRestoreTimer.current);
      if (runwayPatchTimer.current) clearTimeout(runwayPatchTimer.current);
      previewTimer.current = null;
      previewRecoverTimer.current = null;
      surfReleaseTimer.current = null;
      memoryLogoRestoreTimer.current = null;
      runwayPatchTimer.current = null;
      pendingRunwayPatchRef.current = null;
      setViewportGuideChannelIds(null);
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      // Refocus after blur/player: rewarm the last runway so soft-trim on blur
      // does not leave an empty Guide waiting for the first D-pad event.
      const last = lastRunwayRef.current;
      // Search/fullscreen jumps own re-entry. Do not spend SQLite/bridge/cache
      // work rewarming the old Guide runway first; the jump reset will seed the
      // requested channel immediately and avoids wrong-row contention/black return.
      if (!peekGuideJump() && last.ids.length) {
        setViewportGuideChannelIds(last.ids);
        setPriorityMatchChannelIds(
          channels.length >= 400
            ? Array.from(new Set([...last.priority, ...last.ids])).slice(0, 400)
            : [],
        );
        retainGuideSlidingCache(
          expandRunwayKeepSet(
            orderedFilteredIdsRef.current,
            last.ids,
            last.pageSize,
            1,
            filteredIdIndexRef.current,
          ),
        );
        void patchProgramsForChannelIds(last.ids, last.priority);
      }
      return () => {
        if (previewTimer.current) {
          clearTimeout(previewTimer.current);
          previewTimer.current = null;
        }
        if (previewRecoverTimer.current) {
          clearTimeout(previewRecoverTimer.current);
          previewRecoverTimer.current = null;
        }
        if (surfReleaseTimer.current) {
          clearTimeout(surfReleaseTimer.current);
          surfReleaseTimer.current = null;
        }
        // A real route blur must unmount preview playback before cache release.
        // The overlay drawer does not blur this route, so its runway stays warm.
        setPreviewId(null);
        setViewportGuideChannelIds(null);
        setPriorityMatchChannelIds([]);
        releaseGuideSlidingCache();
      };
    }, [channels.length, patchProgramsForChannelIds, releaseGuideSlidingCache, retainGuideSlidingCache]),
  );

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const recentIdSet = useMemo(() => new Set(recentIds), [recentIds]);
  const failedCount = failedStreamCount();

  const groupCounts = useMemo(
    () =>
      buildGroupCounts(channels, {
        favoriteSet,
        recentIds: recentIdSet,
        hasEpgMatch: hasOwnedEpgMatch,
        isFailed: isFailedChannel,
        hiddenIds: hiddenIdSet,
        customGroups: customGuideGroups.byName,
        includeProviderGroups: showProviderGroups,
      }),
    // failedCount invalidates when the in-memory failure registry grows/shrinks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, favoriteSet, recentIdSet, hiddenIdSet, failedCount, epgGuideFilter, customGuideGroups.byName, showProviderGroups],
  );

  const playlistGroups = useMemo(
    () => showProviderGroups ? listPlaylistGroupNames(channels, hiddenIdSet) : [],
    [channels, hiddenIdSet, showProviderGroups],
  );

  const { tabs: groups, overflow: overflowGroups } = useMemo(
    () =>
      buildVisibleGroups({
        counts: groupCounts,
        pinned: pinnedGroups,
        playlistGroups,
        customGroups: customGuideGroups.groups.map((item) => item.name),
        hiddenGroups: new Set(hiddenGroups),
        showProviderGroups,
        maxPlaylistTabs: 10,
      }),
    [customGuideGroups.groups, groupCounts, hiddenGroups, pinnedGroups, playlistGroups, showProviderGroups],
  );

  // Apply a fixed start group once per normal Guide entry. "Last used" keeps
  // session state; explicit Search/player jumps always win over this preference.
  useEffect(() => {
    if (startPreferenceAppliedRef.current || !isFocused || !channels.length) return;
    if (peekGuideJump()) return;
    startPreferenceAppliedRef.current = true;
    if (!startGroup || startGroup === GUIDE_START_LAST_USED) return;
    const available = groups.includes(startGroup) || overflowGroups.includes(startGroup);
    const next = available ? startGroup : "All";
    guideSessionGroup = next;
    guideSessionChannelId = guideSessionChannelByGroup.get(next) || null;
    setGroup(next);
    resetGuideSelection(guideSessionChannelId);
    setRestoreTimeMs(null);
    setResetToken((value) => value + 1);
  }, [channels.length, groups, isFocused, overflowGroups, startGroup]);

  const filteredMeta = useMemo(() => {
    let list = filterChannelsByGroup(channels, group, {
      favoriteSet,
      recent,
      recentIds: recentIdSet,
      hasEpgMatch: hasOwnedEpgMatch,
      isFailed: isFailedChannel,
      hiddenIds: hiddenIdSet,
      customOrder,
      customGroups: customGuideGroups.byName,
    });
    if (epgGuideFilter === "all") return list;
    const filteredList = epgGuideFilter === "matched"
      ? list.filter(hasOwnedEpgMatch)
      : list.filter((c) => !hasOwnedEpgMatch(c));
    if (!jumpFilterBypassId || filteredList.some((channel) => channel.id === jumpFilterBypassId)) {
      return filteredList;
    }
    const target = list.find((channel) => channel.id === jumpFilterBypassId);
    if (!target) return filteredList;
    // Preserve the selected group's existing order while temporarily admitting only the requested row.
    const visibleIds = new Set(filteredList.map((channel) => channel.id));
    visibleIds.add(target.id);
    return list.filter((channel) => visibleIds.has(channel.id));
  }, [channels, customGuideGroups.byName, customOrder, epgGuideFilter, favoriteSet, group, hasOwnedEpgMatch, hiddenIdSet, jumpFilterBypassId, recent, recentIdSet]);

  // Keep the complete selected group identity stable.
  const filtered = filteredMeta;

  const orderedFilteredIds = useMemo(() => {
    const ids: string[] = [];
    for (const channel of filtered) if (channel.id) ids.push(channel.id);
    return ids;
  }, [filtered]);
  const filteredIdIndex = useMemo(
    () => buildChannelIndexMap(orderedFilteredIds),
    [orderedFilteredIds],
  );
  orderedFilteredIdsRef.current = orderedFilteredIds;
  filteredIdIndexRef.current = filteredIdIndex;

  const onViewportChannelIds = useCallback((ids: string[], priorityIds: string[] = [], pageSize = 8, velocity = 0) => {
    const focusIndex = Math.max(0, ids.indexOf(priorityIds[0] || ""));
    const rapid = velocity > 0 || isGuideSurfing();
    const dataIds = rapid
      ? ids.slice(
          Math.max(0, focusIndex - pageSize * 2),
          Math.min(ids.length, focusIndex + pageSize * 4 + 1),
        )
      : ids;
    lastRunwayRef.current = { ids: dataIds, priority: priorityIds, pageSize };
    setViewportGuideChannelIds(ids);
    if (channels.length >= 400) {
      // Match the focused/next rows first. A symmetric runway starts at its
      // oldest retained row, which must not delay the visible edge.
      setPriorityMatchChannelIds(
        Array.from(new Set([...priorityIds, ...ids])).slice(0, 400),
      );
    } else {
      setPriorityMatchChannelIds([]);
    }
    // Conveyor belt: retain focus ± 1 page immediately so reverse movement never
    // blanks. Native Guide already performs the bounded SQLite paint query itself.
    retainGuideSlidingCache(
      expandRunwayKeepSet(orderedFilteredIds, ids, pageSize, 1, filteredIdIndex),
    );

    // TiViMate-style hot path: while a key is repeating, do not start a second JS
    // programme fetch for every native focus hop. Keep only the newest runway and
    // hydrate preview/metadata once navigation settles. This removes duplicate DB
    // pressure without delaying the native highlight or last-good canvas paint.
    pendingRunwayPatchRef.current = { ids: dataIds, priorityIds };
    if (runwayPatchTimer.current) clearTimeout(runwayPatchTimer.current);
    const delay = rapid ? 110 : 0;
    runwayPatchTimer.current = setTimeout(() => {
      runwayPatchTimer.current = null;
      const pending = pendingRunwayPatchRef.current;
      pendingRunwayPatchRef.current = null;
      if (!pending) return;
      void patchProgramsForChannelIds(pending.ids, pending.priorityIds);
    }, delay);
  }, [
    channels.length,
    filteredIdIndex,
    orderedFilteredIds,
    patchProgramsForChannelIds,
    retainGuideSlidingCache,
  ]);

  const viewportSeedKeyRef = useRef("");
  // Seed only on cold load/group/reset. A silent refresh must not yank a deeply
  // scrolled guide's EPG query scope back to the first channels.
  useEffect(() => {
    if (!isFocused || !filtered.length) return;
    const key = `${group}:${resetToken}:${powerProfile}`;
    if (viewportSeedKeyRef.current === key) return;
    viewportSeedKeyRef.current = key;
    const rowHeight = getGuideRailMetrics(
      screenWidth,
      guideDensity,
      channelNumbers,
      channelLogos,
    ).rowHeight;
    const visibleRows = Math.max(6, Math.min(24, Math.ceil(screenHeight / rowHeight)));
    const restoreIndex = guideSessionChannelId
      ? (filteredIdIndex.get(guideSessionChannelId) ?? 0)
      : 0;
    // Warm the runway around the actual restore/focus row. Warming index 0 while
    // restoring row 5000 made the native canvas and JS cache disagree and is a
    // direct path to black/empty metadata after Search, All, or fullscreen return.
    const ids = buildGuideRunwayIds(filtered, restoreIndex, visibleRows, 1, powerProfile);
    const priorityFrom = Math.max(0, restoreIndex);
    const priority = filtered
      .slice(priorityFrom, Math.min(filtered.length, priorityFrom + visibleRows))
      .map((channel) => channel.id)
      .filter(Boolean);
    lastRunwayRef.current = {
      ids,
      priority: Array.from(new Set([guideSessionChannelId, ...priority, ...ids.slice(0, 3)].filter((id): id is string => !!id))),
      pageSize: visibleRows,
    };
    setViewportGuideChannelIds(ids);
    setPriorityMatchChannelIds(
      channels.length >= 400
        ? Array.from(new Set([...lastRunwayRef.current.priority, ...ids])).slice(0, 400)
        : [],
    );
    retainGuideSlidingCache(
      expandRunwayKeepSet(orderedFilteredIds, ids, visibleRows, 1, filteredIdIndex),
    );
    // Prewarm immediately on Guide/group entry, before the first native focus
    // event. SQLite and the bridge can populate the restore runway early.
    void patchProgramsForChannelIds(
      ids,
      lastRunwayRef.current.priority,
    );
  }, [
    channelLogos,
    channelNumbers,
    channels.length,
    filtered,
    filteredIdIndex,
    group,
    guideDensity,
    isFocused,
    orderedFilteredIds,
    patchProgramsForChannelIds,
    powerProfile,
    retainGuideSlidingCache,
    resetToken,
    screenHeight,
    screenWidth,
  ]);

  // If Favorites/Recent (or a vanished category) becomes empty, fall back to All
  // so the guide never leaves an unfocusable empty surface.
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
    if (!channelNumbers) return result;
    // Native source/cache rows are already name-sorted; do not clone/sort all
    // 6k+ channels again just to produce optional display numbers.
    for (let index = 0; index < channels.length; index += 1) {
      const channel = channels[index];
      result[channel.id] = resolveChannelNumber(channel.id, index + 1, customNumbers);
    }
    return result;
  }, [channelNumbers, channels, customNumbers]);

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
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    if (safePreviewMode === "off" || !hasUrl) {
      setPreviewId(null);
      return;
    }
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      // Break the sticky error latch — always remount the decoder for this tune.
      setPreviewStatus("loading");
      setPreviewEpoch((value) => value + 1);
      setPreviewId(requestedId);
      setSurfLogosSuppressed(false);
    }, delay);
  }, [safePreviewMode]);

  const guideTopPanelWidth = useMemo(
    () => Math.max(0, screenWidth - 24),
    [screenWidth],
  );
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
      if (surfReleaseTimer.current) {
        clearTimeout(surfReleaseTimer.current);
        surfReleaseTimer.current = null;
      }

      if (nowTs < rapidSurfUntilRef.current || rapid) {
        // Keep decoder/GPU work out of the repeated-focus path. Only the last
        // focused channel after the hold settles is allowed to tune preview.
        // Defer the one-time decoder/logo release until after native focus has
        // painted; doing this synchronously makes the highlight visibly stall.
        if (!surfReleaseTimer.current) {
          surfReleaseTimer.current = setTimeout(() => {
            surfReleaseTimer.current = null;
            setPreviewId(null);
            if (logosOffWhileSurfing) setSurfLogosSuppressed(true);
          }, 48);
        }
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

  const onFocusChannel = useCallback((channel: Channel, settled = true) => {
    guideSessionChannelId = channel.id;
    if (jumpFilterBypassId && channel.id !== jumpFilterBypassId) setJumpFilterBypassId(null);
    rememberGuideGroupChannel(group, channel.id);
    resetGuideSelection(channel.id);
    if (settled) armPreviewForChannel(channel);
  }, [armPreviewForChannel, group, jumpFilterBypassId]);

  const onFocusProgram = useCallback((program: Program, channel: Channel, settled = true) => {
    guideSessionChannelId = channel.id;
    if (jumpFilterBypassId && channel.id !== jumpFilterBypassId) setJumpFilterBypassId(null);
    rememberGuideGroupChannel(group, channel.id);
    setGuideFocusedProgram(channel.id, program);
    if (settled) armPreviewForChannel(channel);
  }, [armPreviewForChannel, group, jumpFilterBypassId]);

  const openGuideProgram = useCallback((program: Program, channel: Channel) => {
    modalOriginRef.current = { channelId: channel.id, programStart: program.start };
    openProgram(program, channel);
  }, [openProgram]);

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      // Drop guide preview before fullscreen allocates a decoder.
      if (previewTimer.current) clearTimeout(previewTimer.current);
      setPreviewId(null);
      addRecent(channel);
      openFullscreenPlayer(router, channel.id, { returnToGuide: true });
    },
    [addRecent, router],
  );

  const applyGroup = useCallback((next: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    groupChangedAt.current = Date.now();
    if (guideSessionChannelId) rememberGuideGroupChannel(group, guideSessionChannelId);
    const rememberedChannelId = guideSessionChannelByGroup.get(next) || null;
    guideSessionGroup = next;
    guideSessionChannelId = rememberedChannelId;
    setGroup(next);
    setJumpFilterBypassId(null);
    resetGuideSelection(rememberedChannelId);
    setRestoreTimeMs(null);
    setPreviewId(null);
    setResetToken((value) => value + 1);
    setGroupDrawerOpen(false);
    closeDrawer();
  }, [closeDrawer, group]);

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

  const onGuideLeftBoundary = useCallback(() => {
    // Guide -> dedicated groups drawer. The main application drawer is one
    // additional Left/Back away and never shares focus ownership with the grid.
    if (!drawerOpen && !groupDrawerOpen && !activeProgram) setGroupDrawerOpen(true);
  }, [activeProgram, drawerOpen, groupDrawerOpen]);

  const onGuideUpBoundary = useCallback(() => {
    // Disable the native canvas before requesting a React action. A single
    // focus owner prevents the canvas from reclaiming focus during the handoff.
    setPreviewActionsFocused(true);
    requestAnimationFrame(() => focusGuidePreviewSurface());
  }, []);

  // One-shot Search/Health/player jump — apply on focus/mount only.
  useFocusEffect(
    useCallback(() => {
      const jump = consumeGuideJump();
      if (!jump) return;
      startPreferenceAppliedRef.current = true;
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
      setJumpFilterBypassId(jump.channelId);
      rememberGuideGroupChannel(nextGroup, jump.channelId);
      setGroup(nextGroup);
      const requestedTime = jump.programStart ? Date.parse(jump.programStart) : NaN;
      setRestoreTimeMs(Number.isFinite(requestedTime) ? requestedTime : null);
      resetGuideSelection(jump.channelId);
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

  const drawerGroups = useMemo<PurpleGuideGroup[]>(() => {
    const names = Array.from(new Set([...groups, ...overflowGroups]));
    return names.map((name) => ({
      name,
      count: groupCounts[name] || 0,
      active: group === name,
      pinned: pinnedGroups.includes(name),
      onPress: () => chooseGroup(name),
      onLongPress: () => togglePinGroup(name),
    }));
  }, [chooseGroup, group, groupCounts, groups, overflowGroups, pinnedGroups, togglePinGroup]);

  return (
    <PurpleTvShell
      active="/guide"
      watchingChannelId={lastChannelId}
      footerAction={{
        label: "Guide Sources",
        icon: "refresh-outline",
        onPress: openGuideSources,
        testID: "guide-open-sources",
      }}
    >
      <View style={styles.page}>
        <PurpleGuideGroupDrawer
          open={groupDrawerOpen}
          groups={drawerGroups}
          onCloseToGuide={() => setGroupDrawerOpen(false)}
          onOpenMainDrawer={() => {
            setGroupDrawerOpen(false);
            openDrawer();
          }}
        />
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
            <GuideSelectionPreview
              width={guideTopPanelWidth}
              channelById={filteredChannelById}
              fallbackChannel={previewFallbackChannel}
              now={now}
              channelNumberById={channelNumberById}
              showChannelNumbers={channelNumbers}
              showLogos={isFocused && channelLogos && !surfLogosSuppressed}
              favoriteSet={favoriteSet}
              hidePreview={hidePreview}
              muted={mutePreview}
              onToggleMute={() => setMutePreview(!mutePreview)}
              previewId={safePreviewMode === "off" || drawerOpen || groupDrawerOpen || !!activeProgram || !isFocused ? null : previewId}
              previewStatus={previewStatus}
              previewEpoch={previewEpoch}
              onPreviewStatus={onPreviewStatus}
              onPreviewErrorRemount={onPreviewErrorRemount}
              onPlay={play}
              onFavorite={toggleFavorite}
              onOpenReminders={() => {
                if (previewTimer.current) clearTimeout(previewTimer.current);
                setPreviewId(null);
                router.replace("/reminders" as any);
              }}
              onHideToggle={() => setHidePreview(!hidePreview)}
              onOpenDrawer={openDrawerFromPreview}
              onActionsFocusChange={setPreviewActionsFocused}
              guideFocusTag={nativeGuideFocusTag}
            />

            {/* Preview + six actions + description form one compact top strip.
                The Guide owns the full width below it. */}
            <View style={styles.gridPanel}>
              <NativeGuideCanvas
                channels={filtered}
                windowStart={windowStart}
                windowEnd={windowEnd}
                active={isFocused && !activeProgram && !drawerOpen && !groupDrawerOpen && !previewActionsFocused}
                restoreChannelId={guideSessionChannelId}
                restoreTimeMs={restoreTimeMs}
                reloadGeneration={resetToken}
                channelNumberById={channelNumberById}
                onProgramPress={openGuideProgram}
                onChannelFocus={onFocusChannel}
                onProgramFocus={onFocusProgram}
                onViewportChannelIds={onViewportChannelIds}
                onNativeGuideTag={setNativeGuideFocusTag}
                onLeftBoundary={onGuideLeftBoundary}
                onUpBoundary={onGuideUpBoundary}
              />
            </View>
          </View>
        )}

        {pinPromptGroup ? (
          <View style={styles.overlay} testID="guide-pin-overlay">
            <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
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
            </FocusGuide>
          </View>
        ) : null}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 3 },
  body: { flex: 1, minHeight: 0, flexDirection: "column", gap: 6 },
  gridPanel: { flex: 1, minWidth: 0, minHeight: 0 },
  pinCard: { width: 340, maxWidth: "100%", borderRadius: 10, backgroundColor: tvColors.panel, padding: 16, gap: 10 },
  overlayTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 16, textAlign: "center" },
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


