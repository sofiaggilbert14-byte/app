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
import { markGuideSurfing } from "@/src/utils/guideSurfGate";
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
    drawerWasOpenó5¶‰žËkºwµçeÁI•™ô(€€€€€€€€€€€€€€€€€€€½¹½ÕÌõí™½ÕÍ5½É•É½ÕÁÍ¡¥Áô(€€€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøÍ•Ñ5½É•É½ÕÁÍ=Á•¸¡ÑÉÕ”¥ô(€€€€€€€€€€€€€€€€€€€ÍÑå±”õì¡ì™½ÕÍ•ôè…¹ä¤€ôøl(€€€€€€€€€€€€€€€€€€€€€ÍÑå±•Ì¹É½ÕÁ¡¥À°(€€€€€€€€€€€€€€€€€€€€€ÍÑå±•Ì¹É½ÕÁ¡¥ÁY•ÉÑ¥…°°(€€€€€€€€€€€€€€€€€€€€€™½ÕÍ•€˜˜ÍÑå±•Ì¹™½ÕÍ•°(€€€€€€€€€€€€€€€€€€€uô(€€€€€€€€€€€€€€€€€€€Ñ•ÍÑ%ô‰Õ¥‘”µµ½É”µÉ½ÕÁÌˆ(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹É½ÕÁQ•áÑôù5½É”É½ÕÁÌð½Q•áÐø(€€€€€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø(€€€€€€€€€€€€€€€€¤€è¹Õ±±ô(€€€€€€€€€€€€€€ð½MÉ½±±Y¥•Üø(€€€€€€€€€€€€¤€è¹Õ±±ô((€€€€€€€€€€€€ñÕ¥‘•M•±•Ñ¥½¹AÉ•Ù¥•Ü(€€€€€€€€€€€€€Ý¥‘Ñ õí‘•Ñ…¥±ÍI…¥±]¥‘Ñ¡ô(€€€€€€€€€€€€€¡…¹¹•±	å%õí™¥±Ñ•É•‘¡…¹¹•±	å%‘ô(€€€€€€€€€€€€€™…±±‰…­¡…¹¹•°õíÁÉ•Ù¥•Ý…±±‰…­¡…¹¹•±ô(€€€€€€€€€€€€€¹½Üõí¹½Ýô(€€€€€€€€€€€€€¡…¹¹•±9Õµ‰•É	å%õí¡…¹¹•±9Õµ‰•É	å%‘ô(€€€€€€€€€€€€€Í¡½Ý¡…¹¹•±9Õµ‰•ÉÌõí¡…¹¹•±9Õµ‰•ÉÍô(€€€€€€€€€€€€€Í¡½Ý1½½Ìõí¥Í½ÕÍ•€˜˜¡…¹¹•±1½½Ì€˜˜€…ÍÕÉ™1½½ÍMÕÁÁÉ•ÍÍ•‘ô(€€€€€€€€€€€€€™…Ù½É¥Ñ•M•Ðõí™…Ù½É¥Ñ•M•Ñô(€€€€€€€€€€€€€¡¥‘•AÉ•Ù¥•Üõí¡¥‘•AÉ•Ù¥•Ýô(€€€€€€€€€€€€€µÕÑ•õíµÕÑ•AÉ•Ù¥•Ýô(€€€€€€€€€€€€€½¹Q½±•5ÕÑ”õì ¤€ôøÍ•Ñ5ÕÑ•AÉ•Ù¥•Ü …µÕÑ•AÉ•Ù¥•Ü¥ô(€€€€€€€€€€€€€ÁÉ•Ù¥•Ý%õíÍ…™•AÉ•Ù¥•Ý5½‘”€ôôô€‰½™˜ˆ€ü¹Õ±°€èÁÉ•Ù¥•Ý%‘ô(€€€€€€€€€€€€€ÁÉ•Ù¥•ÝMÑ…ÑÕÌõíÁÉ•Ù¥•ÝMÑ…ÑÕÍô(€€€€€€€€€€€€€ÁÉ•Ù¥•ÝÁ½ õíÁÉ•Ù¥•ÝÁ½¡ô(€€€€€€€€€€€€€½¹AÉ•Ù¥•ÝMÑ…ÑÕÌõí½¹AÉ•Ù¥•ÝMÑ…ÑÕÍô(€€€€€€€€€€€€€½¹AÉ•Ù¥•ÝÉÉ½ÉI•µ½Õ¹Ðõí½¹AÉ•Ù¥•ÝÉÉ½ÉI•µ½Õ¹Ñô(€€€€€€€€€€€€€½¹A±…äõíÁ±…åô(€€€€€€€€€€€€€½¹…Ù½É¥Ñ”õíÑ½±•…Ù½É¥Ñ•ô(€€€€€€€€€€€€€½¹=Á•¹I•µ¥¹‘•ÉÌõì ¤€ôøì(€€€€€€€€€€€€€€€¥˜€¡ÁÉ•Ù¥•ÝQ¥µ•È¹ÕÉÉ•¹Ð¤±•…ÉQ¥µ•½ÕÐ¡ÁÉ•Ù¥•ÝQ¥µ•È¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€€€Í•ÑAÉ•Ù¥•Ý%¡¹Õ±°¤ì(€€€€€€€€€€€€€€€É½ÕÑ•È¹É•Á±…” ˆ½É•µ¥¹‘•ÉÌˆ…Ì…¹ä¤ì(€€€€€€€€€€€€€õô(€€€€€€€€€€€€€½¹!¥‘•Q½±”õì ¤€ôøÍ•Ñ!¥‘•AÉ•Ù¥•Ü …¡¥‘•AÉ•Ù¥•Ü¥ô(€€€€€€€€€€€€€½¹=Á•¹É…Ý•Èõí½Á•¹É…Ý•ÉÉ½µAÉ•Ù¥•Ýô(€€€€€€€€€€€€¼ø((€€€€€€€€€€€ì¼¨Q¡”ÁÉ•Ù¥•Ü½‘•Ñ…¥±Ì½…Ñ¥½¹ÌÉ…¥°¥Ì„™¥á•±•™ÐÍ¥‰±¥¹œ¸Q¡”Õ¥‘”(€€€€€€€€€€€€€€€½Ý¹ÌÑ¡”É•µ…¥¹¥¹œÝ¥‘Ñ ½¸Ñ¡”É¥¡Ðì¹•¥Ñ¡•ÈÁ…¹•°½Ù•É±…ÁÌÑ¡”½Ñ¡•È¸€¨½ô(€€€€€€€€€€€€ñ½ÕÍÕ¥‘”(€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹É¥‘A…¹•±ô(€€€€€€€€€€€€€ÑÉ…Á½ÕÍ½Ý¸(€€€€€€€€€€€€€€¼¼I½Üµ±•Ù•°1•™Ð¡…¹‘±¥¹œ½Ý¹ÌÑ¡”•á…ÐÁÉ•Ù¥•Üµ‰ÕÑÑ½¸¡…¹‘½™˜¸(€€€€€€€€€€€€€ÑÉ…Á½ÕÍ1•™Ðõí™…±Í•ô(€€€€€€€€€€€€€ÑÉ…Á½ÕÍI¥¡Ð(€€€€€€€€€€€€ø(€€€€€€€€€€€€€íÕ¥‘•1…å½ÕÐ€ôôô€‰½µÁ…Ðˆ€ü€ (€€€€€€€€€€€€€€€€ñ	½áÉ¥(€€€€€€€€€€€€€€€€€¡…¹¹•±Ìõí™¥±Ñ•É•‘ô(€€€€€€€€€€€€€€€€€¹½Üõí¹½Ýô(€€€€€€€€€€€€€€€€€½¹¡…¹¹•±AÉ•ÍÌõíÁ±…åô(€€€€€€€€€€€€€€€€€½¹AÉ½É…µAÉ•ÍÌõí½Á•¹Õ¥‘•AÉ½É…µô(€€€€€€€€€€€€€€€€€½¹¡…¹¹•±½ÕÌõí½¹½ÕÍ¡…¹¹•±ô(€€€€€€€€€€€€€€€€€É•™É•Í¡¥¹œõíÉ•™É•Í¡¥¹ô(€€€€€€€€€€€€€€€€€½¹I•™É•Í õí¡…É‘I•™É•Í¡ô(€€€€€€€€€€€€€€€€€Í¡½Ý¡…¹¹•±9Õµ‰•ÉÌõí¡…¹¹•±9Õµ‰•ÉÍô(€€€€€€€€€€€€€€€€€¡…¹¹•±9Õµ‰•É	å%õí¡…¹¹•±9Õµ‰•É	å%‘ô(€€€€€€€€€€€€€€€€€Í¡½Ý¡…¹¹•±1½½Ìõí¥Í½ÕÍ•€˜˜¡…¹¹•±1½½Ì€˜˜€…ÍÕÉ™1½½ÍMÕÁÁÉ•ÍÍ•‘ô(€€€€€€€€€€€€€€€€€É•µ¥¹‘•É-•åÌõíÉ¥‘I•µ¥¹‘•É-•åÍô(€€€€€€€€€€€€€€€€€É•Í•ÑQ½­•¸õíÉ•Í•ÑQ½­•¹ô(€€€€€€€€€€€€€€€€€…Ñ¥Ù”õí¥Í½ÕÍ•€˜˜€……Ñ¥Ù•AÉ½É…´€˜˜€…‘É…Ý•É=Á•¹ô(€€€€€€€€€€€€€€€€€€¼¼AÉ•Ù¥•Ü¥ÌÑ¡”¹…Ñ¥Ù”1•™Ð¹•¥¡‰½ÈìÑ¡”±½Í•‘É…Ý•È¡…Ì(€€€€€€€€€€€€€€€€€€¼¼¹¼µ½Õ¹Ñ•™½ÕÌÑÉ•”…¹Ñ¡•É•™½É”¹••‘Ì¹¼Í•±˜µ±½¬¸(€€€€€€€€€€€€€€€€€±½­1•™Ñ‘”õí™…±Í•ô(€€€€€€€€€€€€€€€€€É•ÍÑ½É•¡…¹¹•±%õíÕ¥‘•M•ÍÍ¥½¹¡…¹¹•±%‘ô(€€€€€€€€€€€€€€€€€™½ÕÍ±…¥µ9½¹”õí™½ÕÍ±…¥µ9½¹•ô(€€€€€€€€€€€€€€€€€…¡•AÉ½™¥±”õíÁ½Ý•ÉAÉ½™¥±•ô(€€€€€€€€€€€€€€€€€½¹UÁ	½Õ¹‘…Éäõí½¹Õ¥‘•UÁ	½Õ¹‘…Éåô(€€€€€€€€€€€€€€€€€½¹1•™Ñ	½Õ¹‘…Éäõí½¹Õ¥‘•1•™Ñ	½Õ¹‘…Éåô(€€€€€€€€€€€€€€€€€½¹½ÕÍ•‘I½Ý¡…¹”õí½¹½ÕÍ•‘Õ¥‘•I½Ýô(€€€€€€€€€€€€€€€€€½¹Y¥•ÝÁ½ÉÑ¡…¹¹•±%‘Ìõí½¹Y¥•ÝÁ½ÉÑ¡…¹¹•±%‘Íô(€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€ñQ¥µ•±¥¹•É¥(€€€€€€€€€€€€€€€€€¡…¹¹•±Ìõí™¥±Ñ•É•‘ô(€€€€€€€€€€€€€€€€€Ý¥¹‘½ÝMÑ…ÉÐõíÝ¥¹‘½ÝMÑ…ÉÑô(€€€€€€€€€€€€€€€€€Ý¥¹‘½Ý¹õíÝ¥¹‘½Ý¹‘ô(€€€€€€€€€€€€€€€€€¹½Üõí¹½Ýô(€€€€€€€€€€€€€€€€€½¹¡…¹¹•±AÉ•ÍÌõíÁ±…åô(€€€€€€€€€€€€€€€€€½¹AÉ½É…µAÉ•ÍÌõí½Á•¹Õ¥‘•AÉ½É…µô(€€€€€€€€€€€€€€€€€½¹AÉ½É…µ½ÕÌõí½¹½ÕÍAÉ½É…µô(€€€€€€€€€€€€€€€€€½¹¡…¹¹•±½ÕÌõí½¹½ÕÍ¡…¹¹•±ô(€€€€€€€€€€€€€€€€€½¹¡…¹¹•±1½¹AÉ•ÍÌõí½¹¡…¹¹•±1½¹AÉ•ÍÍô(€€€€€€€€€€€€€€€€€É•™É•Í¡¥¹œõíÉ•™É•Í¡¥¹ô(€€€€€€€€€€€€€€€€€½¹I•™É•Í õí¡…É‘I•™É•Í¡ô(€€€€€€€€€€€€€€€€€‘•¹Í¥ÑäõíÕ¥‘••¹Í¥Ñåô(€€€€€€€€€€€€€€€€€Í¡½Ý¡…¹¹•±9Õµ‰•ÉÌõí¡…¹¹•±9Õµ‰•ÉÍô(€€€€€€€€€€€€€€€€€¡…¹¹•±9Õµ‰•É	å%õí¡…¹¹•±9Õµ‰•É	å%‘ô(€€€€€€€€€€€€€€€€€Í¡½Ý¡…¹¹•±1½½Ìõí¥Í½ÕÍ•€˜˜¡…¹¹•±1½½Ì€˜˜€…ÍÕÉ™1½½ÍMÕÁÁÉ•ÍÍ•‘ô(€€€€€€€€€€€€€€€€€É•µ¥¹‘•É-•åÌõíÉ¥‘I•µ¥¹‘•É-•åÍô(€€€€€€€€€€€€€€€€€É•Í•ÑQ½­•¸õíÉ•Í•ÑQ½­•¹ô(€€€€€€€€€€€€€€€€€…Ñ¥Ù”õí¥Í½ÕÍ•€˜˜€……Ñ¥Ù•AÉ½É…´€˜˜€…‘É…Ý•É=Á•¹ô(€€€€€€€€€€€€€€€€€€¼¼AÉ•Ù¥•Ü¥ÌÑ¡”¹…Ñ¥Ù”1•™Ð¹•¥¡‰½ÈìÑ¡”±½Í•‘É…Ý•È¡…Ì(€€€€€€€€€€€€€€€€€€¼¼¹¼µ½Õ¹Ñ•™½ÕÌÑÉ•”…¹Ñ¡•É•™½É”¹••‘Ì¹¼Í•±˜µ±½¬¸(€€€€€€€€€€€€€€€€€±½­1•™Ñ‘”õí™…±Í•ô(€€€€€€€€€€€€€€€€€É•ÍÑ½É•¡…¹¹•±%õíÕ¥‘•M•ÍÍ¥½¹¡…¹¹•±%‘ô(€€€€€€€€€€€€€€€€€™½ÕÍ±…¥µ9½¹”õí™½ÕÍ±…¥µ9½¹•ô(€€€€€€€€€€€€€€€€€…¡•AÉ½™¥±”õíÁ½Ý•ÉAÉ½™¥±•ô(€€€€€€€€€€€€€€€€€½¹UÁ	½Õ¹‘…Éäõí½¹Õ¥‘•UÁ	½Õ¹‘…Éåô(€€€€€€€€€€€€€€€€€½¹1•™Ñ	½Õ¹‘…Éäõí½¹Õ¥‘•1•™Ñ	½Õ¹‘…Éåô(€€€€€€€€€€€€€€€€€½¹½ÕÍ•‘I½Ý¡…¹”õí½¹½ÕÍ•‘Õ¥‘•I½Ýô(€€€€€€€€€€€€€€€€€½¹Y¥•ÝÁ½ÉÑ¡…¹¹•±%‘Ìõí½¹Y¥•ÝÁ½ÉÑ¡…¹¹•±%‘Íô(€€€€€€€€€€€€€€€€€½¹	…­Q…É•Ñ¡…¹”õí½¹Õ¥‘•	…­Q…É•Ñô(€€€€€€€€€€€€€€€€€É•‘Õ•5½Ñ¥½¸õí¥¹ÍÑ…¹ÑÕ¥‘•ô(€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€ð½½ÕÍÕ¥‘”ø(€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€¥ô((€€€€€€€íµ½É•É½ÕÁÍ=Á•¸€ü€ (€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Ù•É±…åôÑ•ÍÑ%ô‰Õ¥‘”µµ½É”µÉ½ÕÁÌµ½Ù•É±…äˆø(€€€€€€€€€€€ì¼¨QÉ…ÀµÁ…¥¹Í¥‘”Ñ¡”Í¡••ÐÍ¼™½ÕÌ…¹¹½Ð™…±°½¹Ñ¼Ñ¡”Õ¥‘”É¥¸€¨½ô(€€€€€€€€€€€€ñ½ÕÍÕ¥‘”…ÕÑ½½ÕÌÑÉ…Á½ÕÍUÀÑÉ…Á½ÕÍ½Ý¸ÑÉ…Á½ÕÍ1•™ÐÑÉ…Á½ÕÍI¥¡Ðø(€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Ù•É±…å…É‘ôø(€€€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Ù•É±…å!•…‘•Éôø(€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹½Ù•É±…åQ¥Ñ±•ôù5½É”É½ÕÁÌð½Q•áÐø(€€€€€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”(€€€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøÍ•Ñ5½É•É½ÕÁÍ=Á•¸¡™…±Í”¥ô(€€€€€€€€€€€€€€€€€€€ÍÑå±”õì¡ì™½ÕÍ•ôè…¹ä¤€ôømÍÑå±•Ì¹½Ù•É±…å±½Í”°™½ÕÍ•€˜˜ÍÑå±•Ì¹™½ÕÍ•‘uô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Í•½¹‘…ÉåQ•áÑôù±½Í”ð½Q•áÐø(€€€€€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø(€€€€€€€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€€€€€€€€€ñMÉ½±±Y¥•ÜÍÑå±”õíÍÑå±•Ì¹½Ù•É±…å1¥ÍÑôÍ¡½ÝÍY•ÉÑ¥…±MÉ½±±%¹‘¥…Ñ½Èõí™…±Í•ôø(€€€€€€€€€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€±•Ð±…ÍÑ1•ÑÑ•È€ô€ˆˆì(€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸½Ù•É™±½ÝÉ½ÕÁÌ¹µ…À ¡¥Ñ•´¤€ôøì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±•ÑÑ•È€ô€¡¥Ñ•´¹ÑÉ¥´ ¤¹¡…ÉÐ À¤ñð€ˆŒˆ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ¡½Ý1•ÑÑ•È€ô±•ÑÑ•È€„ôô±…ÍÑ1•ÑÑ•Èì(€€€€€€€€€€€€€€€€€€€€€¥˜€¡Í¡½Ý1•ÑÑ•È¤±…ÍÑ1•ÑÑ•È€ô±•ÑÑ•Èì(€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€ñY¥•Ü­•äõí¥Ñ•µôø(€€€€€€€€€€€€€€€€€€€€€€€€€íÍ¡½Ý1•ÑÑ•È€ü€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹½Ù•É±…å1•ÑÑ•Éôùí±•ÑÑ•Éôð½Q•áÐø€è¹Õ±±ô(€€€€€€€€€€€€€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôø¡½½Í•É½ÕÀ¡¥Ñ•´¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹1½¹AÉ•ÍÌõì ¤€ôøÑ½±•A¥¹É½ÕÀ¡¥Ñ•´¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€‘•±…å1½¹AÉ•ÍÌõìÐÈÁô(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õì¡ì™½ÕÍ•ôè…¹ä¤€ôømÍÑå±•Ì¹½Ù•É±…åI½Ü°™½ÕÍ•€˜˜ÍÑå±•Ì¹™½ÕÍ•‘uô(€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹½Ù•É±…åI½ÝQ•áÑô¹Õµ‰•É=™1¥¹•ÌõìÅôø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í¥Ñ•µô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€íÉ½ÕÁ½Õ¹ÑÍm¥Ñ•µt€ü€€€‘íÉ½ÕÁ½Õ¹ÑÍm¥Ñ•µuõ€€è€ˆ‰ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½Q•áÐø(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø(€€€€€€€€€€€€€€€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€ð½MÉ½±±Y¥•Üø(€€€€€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€€€€€ð½½ÕÍÕ¥‘”ø(€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€¤€è¹Õ±±ô((€€€€€€€íÁ¥¹AÉ½µÁÑÉ½ÕÀ€ü€ (€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Ù•É±…åôÑ•ÍÑ%ô‰Õ¥‘”µÁ¥¸µ½Ù•É±…äˆø(€€€€€€€€€€€€ñ½ÕÍÕ¥‘”…ÕÑ½½ÕÌÑÉ…Á½ÕÍUÀÑÉ…Á½ÕÍ½Ý¸ÑÉ…Á½ÕÍ1•™ÐÑÉ…Á½ÕÍI¥¡Ðø(€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹Á¥¹…É‘ôø(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹½Ù•É±…åQ¥Ñ±•ôù¹Ñ•ÈA%8ð½Q•áÐø(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Á¥¹!¥¹ÑôùU¹±½¬ƒŠqíÁ¥¹AÉ½µÁÑÉ½ÕÁ÷Štð½Q•áÐø(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Á¥¹¥¥ÑÍôùíÁ¥¹¥¥ÑÌ¹Á…‘¹ Ð°€‹Šˆˆ¤¹Í±¥” À°€Ð¥ôð½Q•áÐø(€€€€€€€€€€€€€€€íÁ¥¹ÉÉ½È€ü€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Á¥¹ÉÉ½Éôù%¹½ÉÉ•ÐA%8ð½Q•áÐø€è¹Õ±±ô(€€€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹Á¥¹A…‘ôø(€€€€€€€€€€€€€€€€€ílˆÄˆ°€ˆÈˆ°€ˆÌˆ°€ˆÐˆ°€ˆÔˆ°€ˆØˆ°€ˆÜˆ°€ˆàˆ°€ˆäˆ°€ˆÀ‰t¹µ…À ¡‘¥¥Ð¤€ôø€ (€€€€€€€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”(€€€€€€€€€€€€€€€€€€€€€­•äõí‘¥¥Ñô(€€€€€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€Í•ÑA¥¹ÉÉ½È¡™…±Í”¤ì(€€€€€€€€€€€€€€€€€€€€€€€Í•ÑA¥¹¥¥ÑÌ ¡ÁÉ•Ø¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•áÐ€ô€¡ÁÉ•Ø€¬‘¥¥Ð¤¹Í±¥” À°€à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸¹•áÐì(€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õì¡ì™½ÕÍ•ôè…¹ä¤€ôømÍÑå±•Ì¹Á¥¹-•ä°™½ÕÍ•€˜˜ÍÑå±•Ì¹™½ÕÍ•‘uô(€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Á¥¹-•åQ•áÑôùí‘¥¥Ñôð½Q•áÐø(€€€€€€€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø(€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹Á¥¹Ñ¥½¹Íôø(€€€€€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”(€€€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€Í•ÑA¥¹AÉ½µÁÑÉ½ÕÀ¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€Í•ÑA¥¹¥¥ÑÌ ˆˆ¤ì(€€€€€€€€€€€€€€€€€€€€€Í•ÑA¥¹ÉÉ½È¡™…±Í”¤ì(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€ÍÑå±”õì¡ì™½ÕÍ•ôè…¹ä¤€ôømÍÑå±•Ì¹Í•½¹‘…Éå	ÕÑÑ½¸°™½ÕÍ•€˜˜ÍÑå±•Ì¹™½ÕÍ•‘uô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Í•½¹‘…ÉåQ•áÑôù…¹•°ð½Q•áÐø(€€€€€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø(€€€€€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”(€€€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõíÍÕ‰µ¥ÑA¥¹ô(€€€€€€€€€€€€€€€€€€€ÍÑå±”õì¡ì™½ÕÍ•ôè…¹ä¤€ôømÍÑå±•Ì¹Ý…Ñ¡	ÕÑÑ½¸°™½ÕÍ•€˜˜ÍÑå±•Ì¹™½ÕÍ•‘uô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Ý…Ñ¡Q•áÑôùU¹±½¬ð½Q•áÐø(€€€€€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø(€€€€€€€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€€€€€ð½½ÕÍÕ¥‘”ø(€€€€€€€€€€ð½Y¥•Üø(€€€€€€€€¤€è¹Õ±±ô(€€€€€€ð½Y¥•Üø(€€€€ð½AÕÉÁ±•QÙM¡•±°ø(€€¤ì)ô()½¹ÍÐÍÑå±•Ì€ôMÑå±•M¡••Ð¹É•…Ñ”¡ì(€Á…”èì™±•àè€Ä°Á…‘‘¥¹œè€ÄÈ°…Àè€Ôô°(€¡•…‘•Èèìµ¥¹!•¥¡Ðè€Ðà°™±•á¥É•Ñ¥½¸è€‰É½Üˆ°…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°Á½Í¥Ñ¥½¸è€‰É•±…Ñ¥Ù”ˆô°(€Õ¥‘•Q¥Ñ±•	±½¬èìÁ½Í¥Ñ¥½¸è€‰…‰Í½±ÕÑ”ˆ°±•™Ðè€À°Ý¥‘Ñ è€ÄÌÀô°(€É½ÕÁMÉ½±±•Èèì™±•àè€Ä°µ¥¹]¥‘Ñ è€Àô°(€­¥­•Èèì½±½ÈèÑÙ½±½ÉÌ¹ÁÕÉÁ±•M½™Ð°™½¹Ñ…µ¥±äè™½¹ÑÌ¹Í•µ¥‰½±°™½¹ÑM¥é”è€Ü¸Ô°±•ÑÑ•ÉMÁ…¥¹œè€Äô°(€Ñ¥Ñ±”èì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹‰½±°™½¹ÑM¥é”è€ÄÜ°µ…É¥¹Q½Àè€Ä°µ¥¹]¥‘Ñ è€ÄÈÀô°(€É½ÕÁI½Üèì…Àè€Ô°…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°Á…‘‘¥¹!½É¥é½¹Ñ…°è€Ðô°(€É½ÕÁ¡¥Àèì(€€€µ¥¹!•¥¡Ðè€Èà°(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÀ°(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°(€€€‰½É‘•ÉI…‘¥ÕÌè€Ø°(€€€‰½É‘•É]¥‘Ñ è€È°(€€€‰½É‘•É½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹Á…¹•°°(€ô°(€É½ÕÁ¡¥ÁY•ÉÑ¥…°èìÝ¥‘Ñ è€ˆÄÀÀ”ˆ°Á…‘‘¥¹!½É¥é½¹Ñ…°è€à°µ…É¥¹	½ÑÑ½´è€Ðô°(€É½ÕÁ¡¥ÁÑ¥Ù”èì‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹ÁÕÉÁ±”ô°(€É½ÕÁ¡¥ÁA¥¹¹•èì‰½É‘•É½±½Èè€‰É‰„ ÄØà°àÔ°ÈÐÜ°À¸ÐÔ¤ˆô°(€É½ÕÁQ•áÐèì½±½ÈèÑÙ½±½ÉÌ¹Ñ•áÑ5ÕÑ•°™½¹Ñ…µ¥±äè™½¹ÑÌ¹µ•‘¥Õ´°™½¹ÑM¥é”è€à¸Ôô°(€É½ÕÁQ•áÑÑ¥Ù”èì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹Í•µ¥‰½±ô°(€Ù•ÉÑ¥…±!•…‘•É!¥¹Ðèì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹‰½±°™½¹ÑM¥é”è€ÄÐô°(€‰½‘äèì™±•àè€Ä°™±•á¥É•Ñ¥½¸è€‰É½Üˆ°…Àè€à°µ¥¹!•¥¡Ðè€À°Á½Í¥Ñ¥½¸è€‰É•±…Ñ¥Ù”ˆô°(€Ù•ÉÑ¥…±É½ÕÁÌèìÝ¥‘Ñ è€ÄÄà°™±•áM¡É¥¹¬è€À°µ…á!•¥¡Ðè€ˆÄÀÀ”ˆô°(€Ù•ÉÑ¥…±É½ÕÁ1¥ÍÐèìÁ…‘‘¥¹Y•ÉÑ¥…°è€È°Á…‘‘¥¹I¥¡Ðè€Èô°(€É¥‘A…¹•°èì(€€€™±•àè€Ä°(€€€µ¥¹]¥‘Ñ è€À°(€€€½Ù•É™±½Üè€‰¡¥‘‘•¸ˆ°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹…¹Ù…ÍI…¥Í•°(€€€‰½É‘•É]¥‘Ñ è€Ä°(€€€‰½É‘•É½±½ÈèÑÙ½±½ÉÌ¹±¥¹”°(€€€‰½É‘•ÉI…‘¥ÕÌèÉ…‘¥ÕÌ¹Í´°(€ô°(€Ý…Ñ¡	ÕÑÑ½¸èì(€€€™±•àè€Ä°(€€€µ¥¹]¥‘Ñ è€À°(€€€µ¥¹!•¥¡Ðè€ÈÜ°(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°(€€€…Àè€Ð°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹ÁÕÉÁ±”°(€€€‰½É‘•ÉI…‘¥ÕÌè€Ô°(€€€‰½É‘•É]¥‘Ñ è€È°(€€€‰½É‘•É½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€Ì°(€ô°(€Ý…Ñ¡Q•áÐèì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹Í•µ¥‰½±°™½¹ÑM¥é”è€Ü¸Ôô°(€Í•½¹‘…Éå	ÕÑÑ½¸èì(€€€™±•àè€Ä°(€€€µ¥¹]¥‘Ñ è€À°(€€€µ¥¹!•¥¡Ðè€ÈÜ°(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°(€€€…Àè€Ð°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹Á…¹•±I…¥Í•°(€€€‰½É‘•ÉI…‘¥ÕÌè€Ô°(€€€‰½É‘•É]¥‘Ñ è€È°(€€€‰½É‘•É½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€Ì°(€ô°(€Í•½¹‘…ÉåQ•áÐèì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹µ•‘¥Õ´°™½¹ÑM¥é”è€Ü¸Èô°(€½Ù•É±…äèì(€€€€¸¸¹MÑå±•M¡••Ð¹…‰Í½±ÕÑ•¥±±=‰©•Ð°(€€€‰…­É½Õ¹‘½±½Èè€‰É‰„ À°À°À°À¸ÔÔ¤ˆ°(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°(€€€é%¹‘•àè€ÈÀ°(€€€Á…‘‘¥¹œè€ÈÐ°(€ô°(€½Ù•É±…å…Éèì(€€€Ý¥‘Ñ è€ˆÜÈ”ˆ°(€€€µ…á]¥‘Ñ è€ÐÈÀ°(€€€µ…á!•¥¡Ðè€ˆÜÀ”ˆ°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹Á…¹•°°(€€€‰½É‘•ÉI…‘¥ÕÌèÉ…‘¥ÕÌ¹Í´°(€€€‰½É‘•É]¥‘Ñ è€Ä°(€€€‰½É‘•É½±½ÈèÑÙ½±½ÉÌ¹±¥¹”°(€€€Á…‘‘¥¹œè€ÄÈ°(€ô°(€½Ù•É±…å!•…‘•Èèì™±•á¥É•Ñ¥½¸è€‰É½Üˆ°…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰ÍÁ…”µ‰•ÑÝ••¸ˆ°µ…É¥¹	½ÑÑ½´è€àô°(€½Ù•É±…åQ¥Ñ±”èì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹‰½±°™½¹ÑM¥é”è€ÄÐô°(€½Ù•É±…å±½Í”èì(€€€µ¥¹!•¥¡Ðè€Èà°(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÀ°(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°(€€€‰½É‘•ÉI…‘¥ÕÌè€Ô°(€€€‰½É‘•É]¥‘Ñ è€È°(€€€‰½É‘•É½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹Á…¹•±I…¥Í•°(€ô°(€½Ù•É±…å1¥ÍÐèìµ…á!•¥¡Ðè€ÈàÀô°(€½Ù•É±…å1•ÑÑ•Èèì(€€€½±½ÈèÑÙ½±½ÉÌ¹ÁÕÉÁ±•M½™Ð°(€€€™½¹Ñ…µ¥±äè™½¹ÑÌ¹‰½±°(€€€™½¹ÑM¥é”è€ÄÀ°(€€€µ…É¥¹Q½Àè€Ø°(€€€µ…É¥¹	½ÑÑ½´è€È°(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€Ð°(€ô°(€½Ù•É±…åI½Üèì(€€€µ¥¹!•¥¡Ðè€ÌÈ°(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€à°(€€€‰½É‘•ÉI…‘¥ÕÌè€Ô°(€€€‰½É‘•É]¥‘Ñ è€È°(€€€‰½É‘•É½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹Á…¹•±I…¥Í•°(€€€µ…É¥¹	½ÑÑ½´è€Ð°(€ô°(€½Ù•É±…åI½ÝQ•áÐèì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹µ•‘¥Õ´°™½¹ÑM¥é”è€ÄÄô°(€Á¥¹…Éèì(€€€Ý¥‘Ñ è€ÈàÀ°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹Á…¹•°°(€€€‰½É‘•ÉI…‘¥ÕÌèÉ…‘¥ÕÌ¹Í´°(€€€‰½É‘•É]¥‘Ñ è€Ä°(€€€‰½É‘•É½±½ÈèÑÙ½±½ÉÌ¹±¥¹”°(€€€Á…‘‘¥¹œè€ÄÐ°(€€€…Àè€à°(€ô°(€Á¥¹!¥¹Ðèì½±½ÈèÑÙ½±½ÉÌ¹Ñ•áÑ5ÕÑ•°™½¹Ñ…µ¥±äè™½¹ÑÌ¹µ•‘¥Õ´°™½¹ÑM¥é”è€ÄÀô°(€Á¥¹¥¥ÑÌèì(€€€½±½Èè€ˆ™™˜ˆ°(€€€™½¹Ñ…µ¥±äè™½¹ÑÌ¹‰½±°(€€€™½¹ÑM¥é”è€ÈÈ°(€€€±•ÑÑ•ÉMÁ…¥¹œè€à°(€€€Ñ•áÑ±¥¸è€‰•¹Ñ•Èˆ°(€€€µ…É¥¹Y•ÉÑ¥…°è€Ð°(€ô°(€Á¥¹ÉÉ½Èèì½±½Èè€ˆ˜àÜÄÜÄˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹µ•‘¥Õ´°™½¹ÑM¥é”è€ÄÀ°Ñ•áÑ±¥¸è€‰•¹Ñ•Èˆô°(€Á¥¹A…èì™±•á¥É•Ñ¥½¸è€‰É½Üˆ°™±•á]É…Àè€‰ÝÉ…Àˆ°…Àè€Ø°©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆô°(€Á¥¹-•äèì(€€€Ý¥‘Ñ è€ÐÐ°(€€€µ¥¹!•¥¡Ðè€ÌØ°(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°(€€€‰½É‘•ÉI…‘¥ÕÌè€Ô°(€€€‰½É‘•É]¥‘Ñ è€È°(€€€‰½É‘•É½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹Á…¹•±I…¥Í•°(€ô°(€Á¥¹-•åQ•áÐèì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹Í•µ¥‰½±°™½¹ÑM¥é”è€ÄÐô°(€Á¥¹Ñ¥½¹Ìèì™±•á¥É•Ñ¥½¸è€‰É½Üˆ°…Àè€à°µ…É¥¹Q½Àè€Ðô°(€•¹Ñ•Èèì™±•àè€Ä°…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°…ÀèÍÁ…¥¹œ¹µô°(€•¹Ñ•ÉQ•áÐèì½±½ÈèÑÙ½±½ÉÌ¹Ñ•áÑ5ÕÑ•°™½¹Ñ…µ¥±äè™½¹ÑÌ¹µ•‘¥Õ´°™½¹ÑM¥é”è€ÄÄ°Ñ•áÑ±¥¸è€‰•¹Ñ•Èˆ°µ…á]¥‘Ñ è€ÌÈÀô°(€É•ÑÉå	ÕÑÑ½¸èì(€€€µ¥¹!•¥¡Ðè€ÌÈ°(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°(€€€…Àè€Ø°(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÐ°(€€€‰½É‘•ÉI…‘¥ÕÌè€Ø°(€€€‰½É‘•É]¥‘Ñ è€È°(€€€‰½É‘•É½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°(€€€‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹ÁÕÉÁ±”°(€€€µ…É¥¹Q½Àè€Ð°(€ô°(€É•ÑÉåQ•áÐèì½±½Èè€ˆ™™˜ˆ°™½¹Ñ…µ¥±äè™½¹ÑÌ¹Í•µ¥‰½±°™½¹ÑM¥é”è€äô°(€™½ÕÍ•èì‰½É‘•É½±½Èè€ˆ™™˜ˆ°‰…­É½Õ¹‘½±½ÈèÑÙ½±½ÉÌ¹ÁÕÉÁ±•••Àô°)ô¤ì(