import React, { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState, useMemo } from "react";
import { Platform } from "react-native";
import dayjs from "dayjs";
import { storage } from "@/src/utils/storage";
import { Channel, Program } from "@/src/api";
import {
  loadGuide,
  loadGuideProgramsForChannelIds,
  refreshEpgOnly,
  refreshSource,
  retainProgrammeWindowCache,
  setManualEpgRemaps,
  setPreferTvgIdOnlyMatching,
  setProgrammeWindowCacheLimit,
  trimProgrammeWindowCacheForMemoryPressure,
  subscribeSource,
} from "@/src/source";
import { isGuideSurfing, onGuideSurfSettled } from "@/src/utils/guideSurfGate";
import {
  applyGuidePrograms,
  getGuidePrograms,
  makeGuideProgramWindowKey,
  retainGuidePrograms,
  setGuideProgramRowLimit,
  trimGuideProgramRows,
} from "@/src/core/guideProgramsStore";
import { reminderKey, setTimeFormat24h } from "@/src/utils/time";
import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";
import { clearChannelLogoMemory } from "@/src/components/ChannelLogo";
import { sanitizeFavoriteIds, toggleFavoriteId } from "@/src/utils/favoriteIds";
import { pushRecentId, sanitizeRecentIds } from "@/src/utils/recentIds";
import { sanitizeReminders } from "@/src/utils/reminderIds";
import { remapStoredChannelIds } from "@/src/utils/channelIdentityMigrate";
import { getPowerProfileTuning, resolvePowerProfile, type PowerProfile } from "@/src/core/devicePowerProfile";
import { resolveStoredGuideLayout } from "@/src/core/guideLayoutDefault";
import { applyManualEpgRemaps, resolveEpgGuideFilter, sanitizeEpgManualRemap, type EpgGuideFilter } from "@/src/core/epgUserOverrides";
import {
  createFavoriteFolder,
  DEFAULT_FOLDER_PRESETS,
  renameFavoriteFolder,
  sanitizeFavoriteFolders,
  toggleChannelInFolder,
  type FavoriteFolder,
} from "@/src/core/favoriteFolders";
import {
  cancelReminder,
  requestNotificationPermission,
  scheduleProgramReminder,
} from "@/src/utils/notifications";

const FAV_KEY = "gs_favorites";
const RECENT_KEY = "gs_recent";
const LAST_CHANNEL_KEY = "gs_last_channel";
const REM_KEY = "gs_reminders";
const PMODE_KEY = "gs_pointer_mode";
const GUIDE_LAYOUT_KEY = "gs_guide_layout";
const GUIDE_DENSITY_KEY = "gs_guide_density";
const EXTRA_COMPACT_DEFAULT_MIGRATION_KEY = "gs_extra_compact_default_v1";
const SAFE_PREVIEW_MODE_KEY = "gs_safe_preview_mode";
const CHANNEL_NUMBERS_KEY = "gs_channel_numbers";
const CHANNEL_LOGOS_KEY = "gs_channel_logos";
const DEVICE_LAYOUT_MODE_KEY = "gs_device_layout_mode";
const PLAYER_TIMEOUT_KEY = "gs_player_timeout_ms";
const AUTO_RETRY_KEY = "gs_auto_retry_streams";
const PREFER_TVG_ID_ONLY_KEY = "gs_prefer_tvg_id_only";
const POWER_PROFILE_KEY = "gs_power_profile";
const LOGOS_OFF_SURF_KEY = "gs_logos_off_while_surfing";
const EPG_GUIDE_FILTER_KEY = "gs_epg_guide_filter";
const EPG_MANUAL_REMAPS_KEY = "gs_epg_manual_remaps";
const FAVORITE_FOLDERS_KEY = "gs_favorite_folders";
const FAVORITE_FOLDERS_SEEDED_KEY = "gs_favorite_folders_seeded";
const GUIDE_WINDOW_HOURS_KEY = "gs_guide_window_hours";
const CLOCK_24H_KEY = "gs_clock_24h";
const START_SCREEN_KEY = "gs_start_screen";
const SLEEP_TIMER_MINUTES_KEY = "gs_sleep_timer_minutes";
const INSTANT_GUIDE_KEY = "gs_instant_guide";

const DEFAULT_GUIDE_WINDOW_HOURS = readGuideWindowHours(process.env.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 6);

function readGuideWindowHours(value: string | number | null | undefined, fallback: GuideWindowHours): GuideWindowHours {
  const n = Number(value || fallback);
  if (n === 6 || n === 8 || n === 12 || n === 24) return n;
  return fallback;
}

function resolveStartScreen(value: string | null | undefined): StartScreen {
  if (value === "guide" || value === "last_channel" || value === "home") return value;
  return "home";
}

function resolveSleepTimerMinutes(value: unknown): SleepTimerMinutes {
  const n = Number(value);
  if (n === 15 || n === 30 || n === 60 || n === 90) return n;
  return 0;
}

export type GuideLayout = "cinematic" | "compact";
export type GuideDensity = "large" | "normal" | "compact" | "extra_compact";
export type SafePreviewMode = "on" | "delayed" | "surf" | "off";
export type DeviceLayoutMode = "auto" | "tv" | "mobile";
export type PlayerControlsTimeoutMs = 8000 | 15000 | 30000 | 60000;
export type GuideWindowHours = 6 | 8 | 12 | 24;
export type StartScreen = "home" | "guide" | "last_channel";
export type SleepTimerMinutes = 0 | 15 | 30 | 60 | 90;
export type { EpgGuideFilter, FavoriteFolder, PowerProfile };

export type Reminder = {
  key: string;
  notificationId: string;
  channelId: string;
  channelName: string;
  programTitle: string;
  start: string;
  stop: string | null;
};

export type ReminderToggleResult = "added" | "removed" | "failed";

export type ActiveProgram = { program: Program; channel: Channel } | null;

export type Store = {
  channels: Channel[];
  windowStart: string;
  windowEnd: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
  hardRefresh: () => Promise<void>;
  /** Fetch/attach programmes for a viewport ring without a full guide rebuild. */
  patchProgramsForChannelIds: (channelIds: string[], priorityIds?: string[]) => Promise<void>;
  /** Conveyor-belt eviction — keep only the hysteresis band around the runway. */
  retainGuideSlidingCache: (keepIds: Iterable<string>) => void;
  /** Release off-screen Guide rows before fullscreen playback keeps decoders alive. */
  releaseGuideSlidingCache: () => void;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  channelById: (id: string) => Channel | undefined;

  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  replaceFavorites: (ids: string[]) => void;

  /** Resolved live channels for recent IDs (never fat persisted program payloads). */
  recent: Channel[];
  recentIds: string[];
  lastChannelId: string | null;
  addRecent: (c: Channel) => void;

  reminders: Reminder[];
  hasReminder: (key: string) => boolean;
  addReminder: (program: Program, channel: Channel) => Promise<boolean>;
  removeReminder: (key: string) => Promise<void>;
  /** Single reminder mutation path shared by Guide preview and ProgramModal. */
  toggleReminder: (program: Program, channel: Channel) => Promise<ReminderToggleResult>;

  activeProgram: ActiveProgram;
  openProgram: (program: Program, channel: Channel) => void;
  closeProgram: () => void;

  pointerMode: boolean;
  setPointerMode: (v: boolean) => void;

  guideLayout: GuideLayout;
  setGuideLayout: (v: GuideLayout) => void;
  guideDensity: GuideDensity;
  setGuideDensity: (v: GuideDensity) => void;
  safePreviewMode: SafePreviewMode;
  setSafePreviewMode: (v: SafePreviewMode) => void;
  channelNumbers: boolean;
  setChannelNumbers: (v: boolean) => void;
  channelLogos: boolean;
  setChannelLogos: (v: boolean) => void;
  deviceLayoutMode: DeviceLayoutMode;
  setDeviceLayoutMode: (v: DeviceLayoutMode) => void;
  playerControlsTimeoutMs: PlayerControlsTimeoutMs;
  setPlayerControlsTimeoutMs: (v: PlayerControlsTimeoutMs) => void;
  autoRetryStreams: boolean;
  setAutoRetryStreams: (v: boolean) => void;
  preferTvgIdOnly: boolean;
  setPreferTvgIdOnly: (v: boolean) => void;
  powerProfile: PowerProfile;
  setPowerProfile: (v: PowerProfile) => void;
  logosOffWhileSurfing: boolean;
  setLogosOffWhileSurfing: (v: boolean) => void;
  instantGuide: boolean;
  setInstantGuide: (v: boolean) => void;
  epgGuideFilter: EpgGuideFilter;
  setEpgGuideFilter: (v: EpgGuideFilter) => void;
  epgManualRemaps: Record<string, string>;
  setEpgManualRemaps: (v: Record<string, string>) => void;
  favoriteFolders: FavoriteFolder[];
  setFavoriteFolders: (folders: FavoriteFolder[]) => void;
  addFavoriteFolder: (name: string) => FavoriteFolder | null;
  toggleFavoriteFolderChannel: (folderId: string, channelId: string) => void;
  renameFavoriteFolder: (folderId: string, name: string) => void;
  removeFavoriteFolder: (id: string) => void;
  guideWindowHours: GuideWindowHours;
  setGuideWindowHours: (v: GuideWindowHours) => void;
  clock24h: boolean;
  setClock24h: (v: boolean) => void;
  startScreen: StartScreen;
  setStartScreen: (v: StartScreen) => void;
  sleepTimerMinutes: SleepTimerMinutes;
  setSleepTimerMinutes: (v: SleepTimerMinutes) => void;
};

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used inside GuideProvider");
  return c;
}

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDateState] = useState(dayjs().format("YYYY-MM-DD"));
  const dateRef = useRef(selectedDate);
  const refreshRequestRef = useRef(0);
  const refreshSilentRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);
  const pendingSilentRefreshRef = useRef(false);
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchInFlightRef = useRef(false);
  const pendingPatchIdsRef = useRef(new Set<string>());
  const pendingPatchPriorityIdsRef = useRef<string[]>([]);
  const lastPatchRunwayIdsRef = useRef<string[]>([]);
  const runwayGenerationRef = useRef(0);
  const pendingPatchGenerationRef = useRef(0);
  const windowStartRef = useRef("");
  const windowEndRef = useRef("");
  const guideEpochRef = useRef(0);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [lastChannelId, setLastChannelId] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const remindersRef = useRef<Reminder[]>([]);
  const reminderDesiredStateRef = useRef(new Map<string, boolean>());
  const reminderMutationRef = useRef(new Map<string, Promise<ReminderToggleResult>>());
  // Keep ref in sync during render so async add/remove see the latest list immediately
  // (useEffect would lag one frame and break hasReminder after setReminders).
  remindersRef.current = reminders;
  const remindersSet = useMemo(() => new Set(reminders.map((r) => r.key)), [reminders]);

  const [activeProgram, setActiveProgram] = useState<ActiveProgram>(null);
  const [pointerMode, setPointerModeState] = useState(false);
  const [guideLayout, setGuideLayoutState] = useState<GuideLayout>(() =>
    resolveStoredGuideLayout(null, Platform.isTV, Platform.OS),
  );
  const [guideDensity, setGuideDensityState] = useState<GuideDensity>("extra_compact");
  const [safePreviewMode, setSafePreviewModeState] = useState<SafePreviewMode>("delayed");
  const [channelNumbers, setChannelNumbersState] = useState(false);
  const [channelLogos, setChannelLogosState] = useState(true);
  const [deviceLayoutMode, setDeviceLayoutModeState] = useState<DeviceLayoutMode>("auto");
  const [playerControlsTimeoutMs, setPlayerControlsTimeoutMsState] = useState<PlayerControlsTimeoutMs>(8000);
  const [autoRetryStreams, setAutoRetryStreamsState] = useState(true);
  const [preferTvgIdOnly, setPreferTvgIdOnlyState] = useState(false);
  const [powerProfile, setPowerProfileState] = useState<PowerProfile>("normal");
  const [logosOffWhileSurfing, setLogosOffWhileSurfingState] = useState(getPowerProfileTuning("normal").logosOffWhileSurfingDefault);
  const [instantGuide, setInstantGuideState] = useState(true);
  useEffect(() => {
    const limit = getPowerProfileTuning(powerProfile).programmeRowCacheLimit;
    setGuideProgramRowLimit(limit);
    setProgrammeWindowCacheLimit(limit);
  }, [powerProfile]);
  useEffect(
    () => subscribeAndroidMemoryPressure((pressure) => {
      const critical = pressure === "critical";
      // Mounted Guide rows are protected by subscriptions; SQLite/user data are
      // never touched by Android memory-pressure cleanup.
      trimGuideProgramRows(lastPatchRunwayIdsRef.current, critical);
      trimProgrammeWindowCacheForMemoryPressure(lastPatchRunwayIdsRef.current, critical);
      clearChannelLogoMemory();
    }),
    [],
  );
  const [epgGuideFilter, setEpgGuideFilterState] = useState<EpgGuideFilter>("all");
  const [epgManualRemaps, setEpgManualRemapsState] = useState<Record<string, string>>({});
  const epgManualRemapsRef = useRef<Record<string, string>>({});
  epgManualRemapsRef.current = epgManualRemaps;
  const [favoriteFolders, setFavoriteFoldersState] = useState<FavoriteFolder[]>([]);
  const [guideWindowHours, setGuideWindowHoursState] = useState<GuideWindowHours>(DEFAULT_GUIDE_WINDOW_HOURS);
  const guideWindowHoursRef = useRef<GuideWindowHours>(DEFAULT_GUIDE_WINDOW_HOURS);
  const [clock24h, setClock24hState] = useState(false);
  const [startScreen, setStartScreenState] = useState<StartScreen>("home");
  const [sleepTimerMinutes, setSleepTimerMinutesState] = useState<SleepTimerMinutes>(0);

  // Memoized helpers for fast lookups
  const channelByIdMap = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);

  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  // Resolve recent IDs against the live channel list — never keep fat Channel+programs in KV.
  const recent = useMemo(() => {
    const out: Channel[] = [];
    for (const id of recentIds) {
      const channel = channelByIdMap.get(id);
      if (channel) out.push(channel);
    }
    return out;
  }, [channelByIdMap, recentIds]);

  const setPointerMode = useCallback((v: boolean) => {
    setPointerModeState(v);
    storage.setItem(PMODE_KEY, v);
  }, []);

  const setGuideLayout = useCallback((v: GuideLayout) => {
    setGuideLayoutState(v);
    storage.setItem(GUIDE_LAYOUT_KEY, v);
  }, []);

  const setGuideDensity = useCallback((v: GuideDensity) => {
    setGuideDensityState(v);
    storage.setItem(GUIDE_DENSITY_KEY, v);
  }, []);

  const setSafePreviewMode = useCallback((v: SafePreviewMode) => {
    setSafePreviewModeState(v);
    storage.setItem(SAFE_PREVIEW_MODE_KEY, v);
  }, []);

  const setChannelNumbers = useCallback((v: boolean) => {
    setChannelNumbersState(v);
    storage.setItem(CHANNEL_NUMBERS_KEY, v);
  }, []);

  const setChannelLogos = useCallback((v: boolean) => {
    setChannelLogosState(v);
    storage.setItem(CHANNEL_LOGOS_KEY, v);
  }, []);

  const setDeviceLayoutMode = useCallback((v: DeviceLayoutMode) => {
    setDeviceLayoutModeState(v);
    storage.setItem(DEVICE_LAYOUT_MODE_KEY, v);
  }, []);

  const setPlayerControlsTimeoutMs = useCallback((v: PlayerControlsTimeoutMs) => {
    setPlayerControlsTimeoutMsState(v);
    storage.setItem(PLAYER_TIMEOUT_KEY, v);
  }, []);

  const setAutoRetryStreams = useCallback((v: boolean) => {
    setAutoRetryStreamsState(v);
    storage.setItem(AUTO_RETRY_KEY, v);
  }, []);

  const setPreferTvgIdOnly = useCallback((v: boolean) => {
    setPreferTvgIdOnlyState(v);
    setPreferTvgIdOnlyMatching(v);
    storage.setItem(PREFER_TVG_ID_ONLY_KEY, v);
    void (async () => {
      try {
        await refreshEpgOnly();
        await refreshSilentRef.current(true);
      } catch (error) {
        console.warn("preferTvgIdOnly rematch failed", error);
      }
    })();
  }, []);

  const setPowerProfile = useCallback((v: PowerProfile) => {
    const next = resolvePowerProfile(v);
    setPowerProfileState(next);
    storage.setItem(POWER_PROFILE_KEY, next);
    const tuning = getPowerProfileTuning(next);
    setLogosOffWhileSurfingState(tuning.logosOffWhileSurfingDefault);
    storage.setItem(LOGOS_OFF_SURF_KEY, tuning.logosOffWhileSurfingDefault);
  }, []);

  const setLogosOffWhileSurfing = useCallback((v: boolean) => {
    setLogosOffWhileSurfingState(v);
    storage.setItem(LOGOS_OFF_SURF_KEY, v);
  }, []);

  const setInstantGuide = useCallback((v: boolean) => {
    setInstantGuideState(v);
    storage.setItem(INSTANT_GUIDE_KEY, v);
  }, []);

  const setEpgGuideFilter = useCallback((v: EpgGuideFilter) => {
    const next = resolveEpgGuideFilter(v);
    setEpgGuideFilterState(next);
    storage.setItem(EPG_GUIDE_FILTER_KEY, next);
  }, []);

  const setEpgManualRemaps = useCallback((v: Record<string, string>) => {
    const next = sanitizeEpgManualRemap(v);
    setEpgManualRemapsState(next);
    setManualEpgRemaps(next);
    storage.setItem(EPG_MANUAL_REMAPS_KEY, next);
    // Reload from auto-matched MEM + remaps at read time (handles clear correctly).
    void refreshSilentRef.current(true);
  }, []);

  const setFavoriteFolders = useCallback((folders: FavoriteFolder[]) => {
    const next = sanitizeFavoriteFolders(folders);
    setFavoriteFoldersState(next);
    storage.setItem(FAVORITE_FOLDERS_KEY, next);
  }, []);

  const addFavoriteFolder = useCallback((name: string) => {
    const folder = createFavoriteFolder(name, favoriteFolders);
    if (!folder) return null;
    const next = sanitizeFavoriteFolders([...favoriteFolders, folder]);
    setFavoriteFoldersState(next);
    storage.setItem(FAVORITE_FOLDERS_KEY, next);
    return folder;
  }, [favoriteFolders]);

  const toggleFavoriteFolderChannel = useCallback((folderId: string, channelId: string) => {
    if (!folderId || !channelId) return;
    setFavoriteFoldersState((prev) => {
      const next = sanitizeFavoriteFolders(toggleChannelInFolder(prev, folderId, channelId));
      storage.setItem(FAVORITE_FOLDERS_KEY, next);
      return next;
    });
  }, []);

  const renameFavoriteFolderById = useCallback((folderId: string, name: string) => {
    if (!folderId) return;
    setFavoriteFoldersState((prev) => {
      const next = sanitizeFavoriteFolders(renameFavoriteFolder(prev, folderId, name));
      storage.setItem(FAVORITE_FOLDERS_KEY, next);
      return next;
    });
  }, []);

  const removeFavoriteFolder = useCallback((id: string) => {
    if (!id) return;
    setFavoriteFoldersState((prev) => {
      const next = prev.filter((folder) => folder.id !== id);
      storage.setItem(FAVORITE_FOLDERS_KEY, next);
      return next;
    });
  }, []);

  const setGuideWindowHours = useCallback((v: GuideWindowHours) => {
    const next = readGuideWindowHours(v, DEFAULT_GUIDE_WINDOW_HOURS);
    guideWindowHoursRef.current = next;
    setGuideWindowHoursState(next);
    storage.setItem(GUIDE_WINDOW_HOURS_KEY, next);
    void refreshSilentRef.current(true);
  }, []);

  const setClock24h = useCallback((v: boolean) => {
    setClock24hState(v);
    setTimeFormat24h(v);
    storage.setItem(CLOCK_24H_KEY, v);
  }, []);

  const setStartScreen = useCallback((v: StartScreen) => {
    const next = resolveStartScreen(v);
    setStartScreenState(next);
    storage.setItem(START_SCREEN_KEY, next);
  }, []);

  const setSleepTimerMinutes = useCallback((v: SleepTimerMinutes) => {
    const next = resolveSleepTimerMinutes(v);
    setSleepTimerMinutesState(next);
    storage.setItem(SLEEP_TIMER_MINUTES_KEY, next);
  }, []);

  const channelById = useCallback(
    (id: string) => {
      const channel = channelByIdMap.get(id);
      if (!channel) return undefined;
      const programs = getGuidePrograms(id);
      if (!programs?.length) return channel;
      if (channel.programs === programs) return channel;
      return { ...channel, programs: [...progra…2695 tokens truncated…efreshRequestRef.current) setLoading(false);
    }
  }, [persistRecent]);

  refreshSilentRef.current = refresh;

  const flushProgramPatchQueue = useCallback(async () => {
    if (patchInFlightRef.current || pendingPatchIdsRef.current.size === 0) return;
    if (!windowStartRef.current || !windowEndRef.current) return;

    patchInFlightRef.current = true;
    const ids = Array.from(pendingPatchIdsRef.current);
    const priorityOrder = pendingPatchPriorityIdsRef.current;
    const prioritySet = new Set(priorityOrder);
    const runwayGeneration = pendingPatchGenerationRef.current;
    pendingPatchIdsRef.current.clear();
    pendingPatchPriorityIdsRef.current = [];
    const start = windowStartRef.current;
    const end = windowEndRef.current;
    const guideEpoch = guideEpochRef.current;
    try {
      const focusedIds = priorityOrder.slice(0, 1).filter((id) => ids.includes(id));
      const immediateIds = priorityOrder.slice(1, 3).filter((id) => ids.includes(id));
      const visibleIds = priorityOrder.slice(3).filter((id) => ids.includes(id));
      const urgentIds = [...focusedIds, ...immediateIds, ...visibleIds];
      const remainingIds = ids.filter((id) => !prioritySet.has(id));
      const applyTier = async (tierIds: string[]) => {
        if (!tierIds.length) return true;
        const delta = await loadGuideProgramsForChannelIds(tierIds, start, guideWindowHoursRef.current);
        // Date/window changed while SQLite was reading. Do not paint an old day.
        if (start !== windowStartRef.current || end !== windowEndRef.current) return false;
        // A background guide refresh replaced the native cache while this tier
        // was reading. Keep last-good rows and enqueue the newest runway again.
        if (guideEpoch !== guideEpochRef.current) {
          pendingPatchIdsRef.current.clear();
          for (const id of lastPatchRunwayIdsRef.current) {
            if (id) pendingPatchIdsRef.current.add(id);
          }
          pendingPatchPriorityIdsRef.current = lastPatchRunwayIdsRef.current.slice(0, 3);
          pendingPatchGenerationRef.current = runwayGenerationRef.current;
          return false;
        }
        // Focus advanced while SQLite was reading. Discard the obsolete result
        // and reapply the newest conveyor keep set because the completed native
        // request may have repopulated rows that the newer runway already evicted.
        if (runwayGeneration !== runwayGenerationRef.current) {
          retainGuidePrograms(lastPatchRunwayIdsRef.current);
          retainProgrammeWindowCache(lastPatchRunwayIdsRef.current);
          return false;
        }
        // Native returns explicit empty arrays too, clearing stale rows without
        // waiting for the complete five-page runway.
        if (delta && Object.keys(delta).length) {
          applyGuidePrograms(makeGuideProgramWindowKey(start, end, guideEpochRef.current), delta);
        }
        return true;
      };
      const tiers = urgentIds.length
        ? [focusedIds, immediateIds, visibleIds, remainingIds]
        : [ids];
      for (const tier of tiers) {
        if (!(await applyTier(tier))) return;
        // A newer runway supersedes the old tail. Finish its focused tier next
        // instead of making held-D-pad input wait behind obsolete bridge work.
        if (pendingPatchIdsRef.current.size > 0) return;
      }
    } catch {
      /* keep last-good programmes on the glass */
    } finally {
      patchInFlightRef.current = false;
      if (pendingPatchIdsRef.current.size > 0) {
        if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
        patchTimerRef.current = setTimeout(() => {
          patchTimerRef.current = null;
          void flushProgramPatchQueue();
        }, isGuideSurfing() ? 24 : 0);
      }
    }
  }, []);

  const patchProgramsForChannelIds = useCallback(async (channelIds: string[], priorityIds: string[] = []) => {
    // Each call is a complete eight-page runway. Keep only the newest pending
    // window while SQLite is busy; the previous completed/in-flight pages remain
    // cached inside the conveyor hysteresis band until retain drops them.
    pendingPatchIdsRef.current.clear();
    pendingPatchPriorityIdsRef.current = [];
    const runwayGeneration = runwayGenerationRef.current + 1;
    runwayGenerationRef.current = runwayGeneration;
    pendingPatchGenerationRef.current = runwayGeneration;
    lastPatchRunwayIdsRef.current = channelIds.filter(Boolean);
    for (const id of channelIds) {
      if (id) pendingPatchIdsRef.current.add(id);
    }
    for (const id of priorityIds) {
      if (
        id &&
        pendingPatchIdsRef.current.has(id) &&
        !pendingPatchPriorityIdsRef.current.includes(id)
      ) {
        pendingPatchPriorityIdsRef.current.push(id);
      }
    }
    if (!pendingPatchIdsRef.current.size || patchInFlightRef.current || patchTimerRef.current) return;
    // Leading-edge work keeps the next rows populated while the key is held.
    patchTimerRef.current = setTimeout(() => {
      patchTimerRef.current = null;
      void flushProgramPatchQueue();
    }, isGuideSurfing() ? 16 : 32);
  }, [flushProgramPatchQueue]);

  /**
   * Advance the conveyor-belt keep set: drop JS + native programme rows that
   * left the hysteresis band so held surfing cannot accumulate the playlist.
   */
  const retainGuideSlidingCache = useCallback((keepIds: Iterable<string>) => {
    const keep = Array.from(keepIds).filter(Boolean);
    if (!keep.length) return;
    retainGuidePrograms(keep);
    retainProgrammeWindowCache(keep);
  }, []);

  const releaseGuideSlidingCache = useCallback(() => {
    // Preserve a small warm runway for a fast return to Guide while releasing
    // the bulk of programme arrays before fullscreen video decoders start.
    const keepLimit = powerProfile === "weak" ? 48 : powerProfile === "max_preview" ? 128 : 96;
    const keep = lastPatchRunwayIdsRef.current.slice(0, keepLimit);
    lastPatchRunwayIdsRef.current = keep;
    runwayGenerationRef.current += 1;
    pendingPatchGenerationRef.current = runwayGenerationRef.current;
    pendingPatchIdsRef.current.clear();
    pendingPatchPriorityIdsRef.current = [];
    if (patchTimerRef.current) {
      clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    trimGuideProgramRows(keep, true);
    trimProgrammeWindowCacheForMemoryPressure(keep, true);
    clearChannelLogoMemory();
  }, [powerProfile]);

  const setSelectedDate = useCallback(
    (d: string) => {
      dateRef.current = d;
      setSelectedDateState(d);
      refresh();
    },
    [refresh],
  );

  const hardRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshSource(true);
      await refresh(true);
    } catch (e) {
      console.warn("hardRefresh error:", e);
    }
    setRefreshing(false);
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let healthTimer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      const rawFavorites = await storage.getItem<unknown>(FAV_KEY, []);
      const cleanedFavorites = sanitizeFavoriteIds(rawFavorites);
      setFavorites(cleanedFavorites);
      // Rewrite compacted ID-only list if older/fatter data was stored.
      if (JSON.stringify(rawFavorites) !== JSON.stringify(cleanedFavorites)) {
        void storage.setItem(FAV_KEY, cleanedFavorites);
      }
      const rawRecent = await storage.getItem<unknown>(RECENT_KEY, []);
      const cleanedRecent = sanitizeRecentIds(rawRecent);
      setRecentIds(cleanedRecent);
      if (JSON.stringify(rawRecent) !== JSON.stringify(cleanedRecent)) {
        void storage.setItem(RECENT_KEY, cleanedRecent);
      }
      setLastChannelId(await storage.getItem<string | null>(LAST_CHANNEL_KEY, null));
      setReminders(sanitizeReminders((await storage.getItem<Reminder[]>(REM_KEY, [])) || []) as Reminder[]);
      setPointerModeState((await storage.getItem<boolean>(PMODE_KEY, false)) || false);
      const storedGuideLayout = await storage.getItem<string | null>(GUIDE_LAYOUT_KEY, null);
      setGuideLayoutState(resolveStoredGuideLayout(storedGuideLayout, Platform.isTV, Platform.OS));
      const extraCompactDefaultApplied = await storage.getItem<boolean>(EXTRA_COMPACT_DEFAULT_MIGRATION_KEY, false);
      const storedDensity = extraCompactDefaultApplied
        ? await storage.getItem<GuideDensity>(GUIDE_DENSITY_KEY, "extra_compact")
        : "extra_compact";
      setGuideDensityState(
        storedDensity === "large" || storedDensity === "normal" || storedDensity === "compact"
          ? storedDensity
          : "extra_compact",
      );
      if (!extraCompactDefaultApplied) {
        void storage.setItem(GUIDE_DENSITY_KEY, "extra_compact");
        void storage.setItem(EXTRA_COMPACT_DEFAULT_MIGRATION_KEY, true);
      }
      setSafePreviewModeState((await storage.getItem<SafePreviewMode>(SAFE_PREVIEW_MODE_KEY, "delayed")) || "delayed");
      setChannelNumbersState((await storage.getItem<boolean>(CHANNEL_NUMBERS_KEY, false)) || false);
      setChannelLogosState((await storage.getItem<boolean>(CHANNEL_LOGOS_KEY, true)) ?? true);
      setDeviceLayoutModeState((await storage.getItem<DeviceLayoutMode>(DEVICE_LAYOUT_MODE_KEY, "auto")) || "auto");
      setPlayerControlsTimeoutMsState((await storage.getItem<PlayerControlsTimeoutMs>(PLAYER_TIMEOUT_KEY, 8000)) || 8000);
      setAutoRetryStreamsState((await storage.getItem<boolean>(AUTO_RETRY_KEY, true)) ?? true);
      const tvgOnly = (await storage.getItem<boolean>(PREFER_TVG_ID_ONLY_KEY, false)) || false;
      setPreferTvgIdOnlyState(tvgOnly);
      setPreferTvgIdOnlyMatching(tvgOnly);
      const profile = resolvePowerProfile(await storage.getItem<string>(POWER_PROFILE_KEY, "normal"));
      setPowerProfileState(profile);
      const rawLogosOffWhileSurfing = await storage.getItem<boolean | null>(LOGOS_OFF_SURF_KEY, null);
      setLogosOffWhileSurfingState(
        typeof rawLogosOffWhileSurfing === "boolean"
          ? rawLogosOffWhileSurfing
          : getPowerProfileTuning(profile).logosOffWhileSurfingDefault,
      );
      setInstantGuideState((await storage.getItem<boolean>(INSTANT_GUIDE_KEY, true)) ?? true);
      setEpgGuideFilterState(resolveEpgGuideFilter(await storage.getItem<string>(EPG_GUIDE_FILTER_KEY, "all")));
      const manualRemaps = sanitizeEpgManualRemap(await storage.getItem<Record<string, string>>(EPG_MANUAL_REMAPS_KEY, {}));
      setEpgManualRemapsState(manualRemaps);
      setManualEpgRemaps(manualRemaps);
      // Seed useful TV folder presets once (even if the user later deletes all folders).
      const foldersSeeded = (await storage.getItem<boolean>(FAVORITE_FOLDERS_SEEDED_KEY, false)) || false;
      const storedFolders = sanitizeFavoriteFolders(await storage.getItem<FavoriteFolder[]>(FAVORITE_FOLDERS_KEY, []));
      if (!foldersSeeded && !storedFolders.length) {
        const seeded: FavoriteFolder[] = [];
        for (const name of DEFAULT_FOLDER_PRESETS) {
          const folder = createFavoriteFolder(name, seeded);
          if (folder) seeded.push(folder);
        }
        const next = sanitizeFavoriteFolders(seeded);
        setFavoriteFoldersState(next);
        void storage.setItem(FAVORITE_FOLDERS_KEY, next);
        void storage.setItem(FAVORITE_FOLDERS_SEEDED_KEY, true);
      } else {
        setFavoriteFoldersState(storedFolders);
        if (!foldersSeeded) void storage.setItem(FAVORITE_FOLDERS_SEEDED_KEY, true);
      }
      const storedGuideWindowHours = readGuideWindowHours(
        await storage.getItem<number>(GUIDE_WINDOW_HOURS_KEY, DEFAULT_GUIDE_WINDOW_HOURS),
        DEFAULT_GUIDE_WINDOW_HOURS,
      );
      guideWindowHoursRef.current = storedGuideWindowHours;
      setGuideWindowHoursState(storedGuideWindowHours);
      const storedClock24h = (await storage.getItem<boolean>(CLOCK_24H_KEY, false)) || false;
      setClock24hState(storedClock24h);
      setTimeFormat24h(storedClock24h);
      setStartScreenState(resolveStartScreen(await storage.getItem<string>(START_SCREEN_KEY, "home")));
      setSleepTimerMinutesState(resolveSleepTimerMinutes(await storage.getItem<number>(SLEEP_TIMER_MINUTES_KEY, 0)));

      // Fast paint from cache only — never block first focus with permission dialogs
      // or stacked source rebuilds (those freeze Fire TV focus on open).
      await refresh();
      if (disposed) return;

      // Health check after the UI can accept D-pad input.
      healthTimer = setTimeout(() => {
        if (disposed) return;
        void (async () => {
          try {
            const status = await refreshSource(false);
            if (status.channel_count === 0 || status.error) {
              await refreshSource(true);
              await refresh(true);
            }
          } catch {
            // Leave the cached guide up; user can Retry from the guide screen.
          }
        })();
      }, 4500);
    })();
    return () => {
      disposed = true;
      if (healthTimer) clearTimeout(healthTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    // Native EPG emits partial + final phases. Coalesce them so one refresh does
    // not rebuild every channel/TimelineGrid row multiple times on weak sticks.
    const unsubscribe = subscribeSource(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (disposed) return;
        if (isGuideSurfing()) {
          pendingSilentRefreshRef.current = true;
          return;
        }
        void refresh(true);
      }, 500);
    });
    const unsubSettle = onGuideSurfSettled(() => {
      if (disposed || !pendingSilentRefreshRef.current) return;
      pendingSilentRefreshRef.current = false;
      void refresh(true);
    });
    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
      unsubSettle();
    };
  }, [refresh]);

  useEffect(
    () => () => {
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      runwayGenerationRef.current += 1;
      pendingPatchIdsRef.current.clear();
      pendingPatchPriorityIdsRef.current = [];
      lastPatchRunwayIdsRef.current = [];
      if (favoritesPersistTimer.current) clearTimeout(favoritesPersistTimer.current);
      if (favoritesPendingRef.current) void storage.setItem(FAV_KEY, favoritesPendingRef.current);
      if (recentPersistTimer.current) clearTimeout(recentPersistTimer.current);
      if (recentPendingRef.current) {
        const payload = recentPendingRef.current;
        void storage.setItem(RECENT_KEY, payload);
        if (payload[0]) void storage.setItem(LAST_CHANNEL_KEY, payload[0]);
      }
    },
    [],
  );

  // Keep the guide window rolling while the app stays open (silent, low frequency).
  // Skip while a refresh is already running so weak Fire TVs don't hitch mid-surf.
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = loading || refreshing;
  }, [loading, refreshing]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current || isGuideSurfing()) return;
      void refresh(true);
    }, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openProgram = useCallback((program: Program, channel: Channel) => {
    if (!program || !channel || !channel.id || !program.start || Number.isNaN(Date.parse(program.start))) {
      return;
    }
    setActiveProgram({
      program: {
        title: program.title || "No Title",
        desc: program.desc || "",
        category: program.category || "",
        start: program.start,
        stop: program.stop && !Number.isNaN(Date.parse(program.stop)) ? program.stop : null,
      },
      channel,
    });
  }, []);

  const closeProgram = useCallback(() => setActiveProgram(null), []);

  const value: Store = useMemo(
    () => ({
      channels,
      windowStart,
      windowEnd,
      loading,
      refreshing,
      error,
      refresh,
      hardRefresh,
      patchProgramsForChannelIds,
      retainGuideSlidingCache,
      releaseGuideSlidingCache,
      selectedDate,
      setSelectedDate,
      channelById,
      favorites,
      isFavorite,
      toggleFavorite,
      replaceFavorites,
      recent,
      recentIds,
      lastChannelId,
      addRecent,
      reminders,
      hasReminder,
      addReminder,
      removeReminder,
      toggleReminder,
      activeProgram,
      openProgram,
      closeProgram,
      pointerMode,
      setPointerMode,
      guideLayout,
      setGuideLayout,
      guideDensity,
      setGuideDensity,
      safePreviewMode,
      setSafePreviewMode,
      channelNumbers,
      setChannelNumbers,
      channelLogos,
      setChannelLogos,
      deviceLayoutMode,
      setDeviceLayoutMode,
      playerControlsTimeoutMs,
      setPlayerControlsTimeoutMs,
      autoRetryStreams,
      setAutoRetryStreams,
      preferTvgIdOnly,
      setPreferTvgIdOnly,
      powerProfile,
      setPowerProfile,
      logosOffWhileSurfing,
      setLogosOffWhileSurfing,
      instantGuide,
      setInstantGuide,
      epgGuideFilter,
      setEpgGuideFilter,
      epgManualRemaps,
      setEpgManualRemaps,
      favoriteFolders,
      setFavoriteFolders,
      addFavoriteFolder,
      toggleFavoriteFolderChannel,
      renameFavoriteFolder: renameFavoriteFolderById,
      removeFavoriteFolder,
      guideWindowHours,
      setGuideWindowHours,
      clock24h,
      setClock24h,
      startScreen,
      setStartScreen,
      sleepTimerMinutes,
      setSleepTimerMinutes,
    }),
    [
      channels,
      windowStart,
      windowEnd,
      loading,
      refreshing,
      error,
      refresh,
      hardRefresh,
      patchProgramsForChannelIds,
      retainGuideSlidingCache,
      releaseGuideSlidingCache,
      selectedDate,
      setSelectedDate,
      channelById,
      favorites,
      isFavorite,
      toggleFavorite,
      replaceFavorites,
      recent,
      recentIds,
      lastChannelId,
      addRecent,
      reminders,
      hasReminder,
      addReminder,
      removeReminder,
      toggleReminder,
      activeProgram,
      openProgram,
      closeProgram,
      pointerMode,
      setPointerMode,
      guideLayout,
      setGuideLayout,
      guideDensity,
      setGuideDensity,
      safePreviewMode,
      setSafePreviewMode,
      channelNumbers,
      setChannelNumbers,
      channelLogos,
      setChannelLogos,
      deviceLayoutMode,
      setDeviceLayoutMode,
      playerControlsTimeoutMs,
      setPlayerControlsTimeoutMs,
      autoRetryStreams,
      setAutoRetryStreams,
      preferTvgIdOnly,
      setPreferTvgIdOnly,
      powerProfile,
      setPowerProfile,
      logosOffWhileSurfing,
      setLogosOffWhileSurfing,
      instantGuide,
      setInstantGuide,
      epgGuideFilter,
      setEpgGuideFilter,
      epgManualRemaps,
      setEpgManualRemaps,
      favoriteFolders,
      setFavoriteFolders,
      addFavoriteFolder,
      toggleFavoriteFolderChannel,
      renameFavoriteFolderById,
      removeFavoriteFolder,
      guideWindowHours,
      setGuideWindowHours,
      clock24h,
      setClock24h,
      startScreen,
      setStartScreen,
      sleepTimerMinutes,
      setSleepTimerMinutes,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
