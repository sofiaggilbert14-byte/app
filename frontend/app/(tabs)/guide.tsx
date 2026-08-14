import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
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
import { isGuideSurfing, markGuideSurfing } from "@/src/utils/guideSurfGate";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { getGuideRailMetrics } from "@/src/core/guideLayoutPolicy";
import { buildGuideRunwayIds } from "@/src/core/guideRunwayPolicy";
import {
  buildChannelIndexMap,
  expandRunwayKeepSet,
} from "@/src/core/guideSlidingCache";
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
  unpinGroup,
} from "@/src/core/guideGroups";
import { useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { resolveChannelNumber, useChannelCustomize } from "@/src/core/channelCustomize";
import { useParentalPin } from "@/src/core/parentalPin";
import {
  clearStreamFailure,
  failedStreamCount,
  isFailedChannel,
  noteStreamFailure,
} from "@/src/core/streamFailureRegistry";
import { consumeGuideJump } from "@/src/core/guideSearchJump";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { nowNext } from "@/src/utils/time";
import { requestNativeFocus } from "@/src/utils/tvFocus";
import {
  cancelGuideFocusRestore,
  focusGuideProgramCell,
  focusGuidePreviewSurface,
  focusGuideSurface,
  registerGuideTopEntry,
} from "@/src/utils/tvGuideFocusLock";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import type { StreamStatus } from "@/src/components/StreamPlayer";
import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";
import { setGuideNavigationActive, setGuideRepeatInterval } from "@/src/utils/tvRemote";

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

const GuideGroupChip = memo(function GuideGroupChip({
  item,
  count,
  active,
  pinned,
  vertical,
  onChoose,
  onTogglePin,
  onNode,
}: {
  item: string;
  count: number;
  active: boolean;
  pinned: boolean;
  vertical: boolean;
  onChoose: (item: string) => void;
  onTogglePin: (item: string) => void;
  onNode: (item: string, node: unknown) => void;
}) {
  const nodeRef = useRef<unknown>(null);
  const setRef = useCallback((node: unknown) => {
    nodeRef.current = node;
    onNode(item, node);
    if (active) registerGuideTopEntry(node);
  }, [active, item, onNode]);
  const handleFocus = useCallback(() => {
    registerGuideTopEntry(nodeRef.current);
  }, []);
  const handlePress = useCallback(() => onChoose(item), [item, onChoose]);
  const handleLongPress = useCallback(() => onTogglePin(item), [item, onTogglePin]);
  const label = `${chipLabel(item)}${count > 0 ? ` ${count}` : ""}`;
  return (
    <Pressable
      ref={setRef}
      onFocus={handleFocus}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={420}
      style={({ focused }: any) => [
        styles.groupChip,
        vertical && styles.groupChipVertical,
        active && styles.groupChipActive,
        pinned && styles.groupChipPinned,
        focused && styles.focused,
      ]}
    >
      <Text numberOfLines={1} style={[styles.groupText, active && styles.groupTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
});

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
    />
  );
}

export default function PurpleGuideScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { drawerOpen, openDrawer } = usePurpleTvDrawer();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  useFocusEffect(
    useCallback(() => {
      setGuideNavigationActive(true);
      return () => {
        setGuideNavigationActive(false);
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
    releaseGuideSlidingCache,
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
  useEffect(() => {
    setGuideRepeatInterval(powerTuning.guideRepeatIntervalMs);
  }, [powerTuning.guideRepeatIntervalMs]);
  const [surfLogosSuppressed, setSurfLogosSuppressed] = useState(false);

  const [now, setNow] = useState(() => new Date().toISOString());
  const [group, setGroup] = useState(() => guideSessionGroup);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [resetToken, setResetToken] = useState(0);
  const [moreGroupsOpen, setMoreGroupsOpen] = useState(false);
  const [pinPromptGroup, setPinPromptGroup] = useState<string | null>(null);
  const [pinDigits, setPinDigits] = useState("");
  const [pinError, setPinError] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRecoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoryLogoRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupChangedAt = useRef(0);
  const bootRetryRef = useRef(0);
  const groupChipRefs = useRef(new Map<string, any>());
  const moreGroupsChipRef = useRef<any>(null);
  const setMoreGroupsChipRef = useCallback((node: any) => {
    moreGroupsChipRef.current = node;
  }, []);
  const focusMoreGroupsChip = useCallback(() => {
    registerGuideTopEntry(moreGroupsChipRef.current);
  }, []);
  const lastFocusAtRef = useRef(0);
  const rapidSurfUntilRef = useRef(0);
  const hadProgramModalRef = useRef(false);
  const modalOriginRef = useRef<{ channelId: string; programStart: string } | null>(null);
  const previousDrawerOpenRef = useRef(drawerOpen);
  const headerTitleProgress = useRef(new Animated.Value(drawerOpen ? 1 : 0)).current;
  const groupSlideX = useRef(new Animated.Value(0)).current;
  const orderedFilteredIdsRef = useRef<string[]>([]);
  const filteredIdIndexRef = useRef<Map<string, number>>(new Map());
  const lastRunwayRef = useRef<{ ids: string[]; priority: string[]; pageSize: number }>({
    ids: [],
    priority: [],
    pageSize: 8,
  });
  const [previewEpoch, setPreviewEpoch] = useState(0);
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
  const [focusClaimNonce, setFocusClaimNonce] = useState(0);
  useEffect(() => {
    const wasOpen = drawerWasOpenForFocusRef.current;
    drawerWasOpenForFocusRef.current = drawerOpen;
    if (drawerOpen) {
      cancelGuideFocusRestore();
      return;
    }
    if (!wasOpen || drawerOpen || activeProgram) return;
    // Sole post-drawer reclaim path: bump nonce so TimelineGrid/BoxGrid restore
    // the session channel. Do not also call focusGuideSurface here â€” Shell and
    // the shared cancelGuideRestoreTimers would race and yank focus.
    setFocusClaimNonce((value) => value + 1);
  }, [activeProgram, drawerOpen]);

  const openDrawerFromPreview = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    openDrawer({ focusTop: true });
  }, [openDrawer]);

  // After Remind/Cancel sheet closes, return focus to the guide cell â€” never Live TV.
  useEffect(() => {
    if (activeProgram) return;
    if (!hadProgramModalRef.current) return;
    hadProgramModalRef.current = false;
    const origin = modalOriginRef.current;
    modalOriginRef.current = null;
    if (guideLayout !== "compact" && origin) {
      focusGuideProgramCell(origin.channelId, origin.programStart);
    } else {
      focusGuideSurface(origin?.channelId || guideSessionChannelId);
    }
    return cancelGuideFocusRestore;
  }, [activeProgram, guideLayout]);

  const guideFocusRegionRef = useRef<"channel" | "program">("program");
  const channelLogoNodeRef = useRef<unknown>(null);
  const onGuideBackTarget = useCallback((region: "channel" | "program", logoNode: unknown) => {
    guideFocusRegionRef.current = region;
    if (logoNode) channelLogoNodeRef.current = logoNode;
  }, []);

  // Back in the guide: step to the channel logo first. Only at the left edge does
  // Back defer to the shell double-Back drawer arm â€” never opens on a single press.
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
      previewTimer.current = null;
      previewRecoverTimer.current = null;
      surfReleaseTimer.current = null;
      memoryLogoRestoreTimer.current = null;
      setViewportGuideChannelIds(null);
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      // Refocus after blur/player: rewarm the last runway so soft-trim on blur
      // does not leave an empty FlashList waiting for the first D-pad event.
      const last = lastRunwayRef.current;
      if (last.ids.length) {
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
     …4313 tokens truncated…ide"
      watchingChannelId={lastChannelId}
    >
      <View style={styles.page}>
        {channels.length > 0 ? (
          <GuideSelectionPreview
            width={previewHeaderWidth}
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
            previewId={safePreviewMode === "off" ? null : previewId}
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
          />
        ) : null}
        <View style={styles.header}>
          <Animated.View
            // Title is decorative â€” never steal hits/focus beside an open drawer.
            pointerEvents="none"
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
                    ref={setMoreGroupsChipRef}
                    onFocus={focusMoreGroupsChip}
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
            </View>
          )}
        </View>

        <EpgProgressBar />
        {loading && channels.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={tvColors.purpleBright} size="large" />
            <Text style={styles.centerText}>Loading channels and guideâ€¦</Text>
            <Pressable
              focusable
              disabled={refreshing}
              onPress={() => void hardRefresh()}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="purple-guide-retry-loading"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Loadingâ€¦" : "Retry now"}</Text>
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
              <Text style={styles.retryText}>{refreshing ? "Reloadingâ€¦" : "Reload guide"}</Text>
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
              <Text style={styles.retryText}>{refreshing ? "Loadingâ€¦" : "Reload guide"}</Text>
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
                    ref={setMoreGroupsChipRef}
                    onFocus={focusMoreGroupsChip}
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

            {/* Preview, actions, and programme details live in the header above. */}
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
                  onProgramPress={openGuideProgram}
                  onChannelFocus={onFocusChannel}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={isFocused && channelLogos && !surfLogosSuppressed}
                  reminderKeys={gridReminderKeys}
                  resetToken={resetToken}
                  active={isFocused && !activeProgram && !drawerOpen}
                  // Preview is the native Left neighbor; the closed drawer has
                  // no mounted focus tree and therefore needs no self-lock.
                  lockLeftEdge={false}
                  restoreChannelId={guideSessionChannelId}
                  focusClaimNonce={focusClaimNonce}
                  cacheProfile={powerProfile}
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
                  onProgramPress={openGuideProgram}
                  onProgramFocus={onFocusProgram}
                  onChannelFocus={onFocusChannel}
                  onChannelLongPress={onChannelLongPress}
                  refreshing={refreshing}
                  onRefresh={hardRefresh}
                  density={guideDensity}
                  showChannelNumbers={channelNumbers}
                  channelNumberById={channelNumberById}
                  showChannelLogos={isFocused && channelLogos && !surfLogosSuppressed}
                  reminderKeys={gridReminderKeys}
                  resetToken={resetToken}
                  active={isFocused && !activeProgram && !drawerOpen}
                  // Preview is the native Left neighbor; the closed drawer has
                  // no mounted focus tree and therefore needs no self-lock.
                  lockLeftEdge={false}
                  restoreChannelId={guideSessionChannelId}
                  focusClaimNonce={focusClaimNonce}
                  cacheProfile={powerProfile}
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
            {/* Trap D-pad inside the sheet so focus cannot fall onto the guide grid. */}
            <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
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
            </FocusGuide>
          </View>
        ) : null}

        {pinPromptGroup ? (
          <View style={styles.overlay} testID="guide-pin-overlay">
            <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
              <View style={styles.pinCard}>
                <Text style={styles.overlayTitle}>Enter PIN</Text>
                <Text style={styles.pinHint}>Unlock â€œ{pinPromptGroup}â€</Text>
                <Text style={styles.pinDigits}>{pinDigits.padEnd(4, "â€¢").slice(0, 4)}</Text>
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
  body: { flex: 1, flexDirection: "row", gap: 8, minHeight: 0, position: "relative" },
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
