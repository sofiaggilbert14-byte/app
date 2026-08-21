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
import { isGuideScreenActive, isGuideSurfing, onGuideSurfSettled } from "@/src/utils/guideSurfGate";
import {
  applyGuidePrograms,
  getGuidePrograms,
  makeGuideProgramWindowKey,
  retainGuidePrograms,
  setGuideProgramRowLimit,
  trimGuideProgramRows,
} from "@/src/core/guideProgramsStore";
import { pickKeepIdsAroundFocus } from "@/src/core/guideSlidingCache";
import { buildGuidePatchTiers, keepUsefulGuidePatch } from "@/src/core/guidePatchPolicy";
import { formatNativeEpgError } from "@/src/core/epgMatching";
import { reminderKey, setTimeFormat24h } from "@/src/utils/time";
import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";
import { getSessionPhase } from "@/src/core/playbackSession";
import { clearChannelLogoMemory, setChannelLogoMemoryProfile } from "@/src/components/ChannelLogo";
import { sanitizeFavoriteIds, toggleFavoriteId } from "@/src/utils/favoriteIds";
import { pushRecentId, sanitizeRecentIds } from "@/src/utils/recentIds";
import { sanitizeReminders } from "@/src/utils/reminderIds";
import { remapStoredChannelIds } from "@/src/utils/channelIdentityMigrate";
import {
  getPowerProfileTuning,
  resolvePowerProfile,
  setDeviceLowRamCacheCap,
  type PowerProfile,
} from "@/src/core/devicePowerProfile";
import { readDeviceMemoryProfile, shouldUseLowRamTuning } from "@/src/core/deviceMemoryProfile";
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

function fullscreenPlaybackOwnsDecoder(): boolean {
  return getSessionPhase("fullscreen") !== "idle";
}

const DEFAULT_GUIDE_WINDOW_HOURS = readGuideWindowHours(process.env.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 12);

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
  channelLogo?: string | null;
  programTitle: string;
  programDesc?: string;
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
  /** Expanded conveyor keep set (± hysteresis). Prefer this over raw runway on retain. */
  const lastKeepIdsRef = useRef<string[]>([]);
  const windowStartRef = useRef("");
  const windowEndRef = useRef("");
  const guideEpochRef = useRef(0);
  // Bootstrap storage reads are asynchronous. A user edit made before a read
  // resolves owns that setting and must never be overwritten by the stale disk value.
  const settingsTouchedRef = useRef(new Set<string>());

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [lastChannelId, setLastChannelId] = useState<string | null>(null);
  const lastChannelIdRef = useRef<string | null>(null);
  lastChannelIdRef.current = lastChannelId;
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const remindersRef = useRef<Reminder[]>([]);
  const reminderDesiredStateRef = useRef(new Map<string, boolean>());
  const reminderMutationRef = useRef(new Map<string, Promise<ReminderToggleResult>>());
  remindersRef.current = reminders;
  const remindersSet = useMemo(() => new Set(reminders.map((r) => r.key)), [reminders]);

  const [activeProgram, setActiveProgram] = useState<ActiveProgram>(null);
  const [pointerMode, setPointerModeState] = useState(false);
  const [guideLayout, setGuideLayoutState] = useState<GuideLayout>(() =>
    resolveStoredGuideLayout(null, Platform.isTV, Platform.OS),
  );
  const [guideDensity, setGuideDensityState] = useState<GuideDensity>("extra_compact");
  const [safePreviewMode, setSafePreviewModeState] = useState<SafePreviewMode>("surf");
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
      const source = lastKeepIdsRef.current.length
        ? lastKeepIdsRef.current
        : lastPatchRunwayIdsRef.current;
      const keepLimit = critical
        ? powerProfile === "weak" ? 8 : powerProfile === "max_preview" ? 16 : 12
        : powerProfile === "weak" ? 16 : powerProfile === "max_preview" ? 48 : 32;
      const keep = pickKeepIdsAroundFocus(source, keepLimit, lastChannelIdRef.current);
      if (critical) {
        lastPatchRunwayIdsRef.current = keep;
        lastKeepIdsRef.current = keep;
        pendingPatchIdsRef.current.clear();
        pendingPatchPriorityIdsRef.current = [];
        if (patchTimerRef.current) {
          clearTimeout(patchTimerRef.current);
          patchTimerRef.current = null;
        }
        retainGuidePrograms(keep, { force: true });
        retainProgrammeWindowCache(keep);
      }
      trimGuideProgramRows(keep, critical);
      trimProgrammeWindowCacheForMemoryPressure(keep, critical);
      clearChannelLogoMemory();
    }),
    [powerProfile],
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

  const channelByIdMap = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);
  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);
  const recent = useMemo(() => {
    const out: Channel[] = [];
    for (const id of recentIds) {
      const channel = channelByIdMap.get(id);
      if (channel) out.push(channel);
    }
    return out;
  }, [channelByIdMap, recentIds]);

  const setPointerMode = useCallback((v: boolean) => {
    settingsTouchedRef.current.add(PMODE_KEY);
    setPointerModeState(v);
    storage.setItem(PMODE_KEY, v);
  }, []);
  const setGuideLayout = useCallback((v: GuideLayout) => {
    settingsTouchedRef.current.add(GUIDE_LAYOUT_KEY);
    setGuideLayoutState(v);
    storage.setItem(GUIDE_LAYOUT_KEY, v);
  }, []);
  const setGuideDensity = useCallback((v: GuideDensity) => {
    settingsTouchedRef.current.add(GUIDE_DENSITY_KEY);
    setGuideDensityState(v);
    storage.setItem(GUIDE_DENSITY_KEY, v);
  }, []);
  const setSafePreviewMode = useCallback((v: SafePreviewMode) => {
    settingsTouchedRef.current.add(SAFE_PREVIEW_MODE_KEY);
    setSafePreviewModeState(v);
    storage.setItem(SAFE_PREVIEW_MODE_KEY, v);
  }, []);
  const setChannelNumbers = useCallback((v: boolean) => {
    settingsTouchedRef.current.add(CHANNEL_NUMBERS_KEY);
    setChannelNumbersState(v);
    storage.setItem(CHANNEL_NUMBERS_KEY, v);
  }, []);
  const setChannelLogos = useCallback((v: boolean) => {
    settingsTouchedRef.current.add(CHANNEL_LOGOS_KEY);
    setChannelLogosState(v);
    storage.setItem(CHANNEL_LOGOS_KEY, v);
  }, []);
  const setDeviceLayoutMode = useCallback((v: DeviceLayoutMode) => {
    settingsTouchedRef.current.add(DEVICE_LAYOUT_MODE_KEY);
    setDeviceLayoutModeState(v);
    storage.setItem(DEVICE_LAYOUT_MODE_KEY, v);
  }, []);
  const setPlayerControlsTimeoutMs = useCallback((v: PlayerControlsTimeoutMs) => {
    settingsTouchedRef.current.add(PLAYER_TIMEOUT_KEY);
    setPlayerControlsTimeoutMsState(v);
    storage.setItem(PLAYER_TIMEOUT_KEY, v);
  }, []);
  const setAutoRetryStreams = useCallback((v: boolean) => {
    settingsTouchedRef.current.add(AUTO_RETRY_KEY);
    setAutoRetryStreamsState(v);
    storage.setItem(AUTO_RETRY_KEY, v);
  }, []);
  const setPreferTvgIdOnly = useCallback((v: boolean) => {
    settingsTouchedRef.current.add(PREFER_TVG_ID_ONLY_KEY);
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
    settingsTouchedRef.current.add(POWER_PROFILE_KEY);
    settingsTouchedRef.current.add(LOGOS_OFF_SURF_KEY);
    const next = resolvePowerProfile(v);
    setPowerProfileState(next);
    storage.setItem(POWER_PROFILE_KEY, next);
    const visualTuning = getPowerProfileTuning(next);
    void readDeviceMemoryProfile().then((memory) => {
      const lowRam = shouldUseLowRamTuning(memory);
      setDeviceLowRamCacheCap(lowRam);
      const memorySafeTuning = getPowerProfileTuning(next);
      setGuideProgramRowLimit(memorySafeTuning.programmeRowCacheLimit);
      setProgrammeWindowCacheLimit(memorySafeTuning.programmeRowCacheLimit);
      setChannelLogoMemoryProfile(next === "weak" || lowRam, memory?.logoMemoryBytes);
    });
    setLogosOffWhileSurfingState(visualTuning.logosOffWhileSurfingDefault);
    storage.setItem(LOGOS_OFF_SURF_KEY, visualTuning.logosOffWhileSurfingDefault);
  }, []);
  const setLogosOffWhileSurfing = useCallback((v: boolean) => {
    settingsTouchedRef.current.add(LOGOS_OFF_SURF_KEY);
    setLogosOffWhileSurfingState(v);
    storage.setItem(LOGOS_OFF_SURF_KEY, v);
  }, []);
  const setInstantGuide = useCallback((v: boolean) => {
    settingsTouchedRef.current.add(INSTANT_GUIDE_KEY);
    setInstantGuideState(v);
    storage.setItem(INSTANT_GUIDE_KEY, v);
  }, []);
  const setEpgGuideFilter = useCallback((v: EpgGuideFilter) => {
    settingsTouchedRef.current.add(EPG_GUIDE_FILTER_KEY);
    const next = resolveEpgGuideFilter(v);
    setEpgGuideFilterState(next);
    storage.setItem(EPG_GUIDE_FILTER_KEY, next);
  }, []);
  const setEpgManualRemaps = useCallback((v: Record<string, string>) => {
    settingsTouchedRef.current.add(EPG_MANUAL_REMAPS_KEY);
    const next = sanitizeEpgManualRemap(v);
    setEpgManualRemapsState(next);
    setManualEpgRemaps(next);
    storage.setItem(EPG_MANUAL_REMAPS_KEY, next);
    void refreshSilentRef.current(true);
  }, []);
  const setFavoriteFolders = useCallback((folders: FavoriteFolder[]) => {
    settingsTouchedRef.current.add(FAVORITE_FOLDERS_KEY);
    const next = sanitizeFavoriteFolders(folders);
    setFavoriteFoldersState(next);
    storage.setItem(FAVORITE_FOLDERS_KEY, next);
  }, []);
  const addFavoriteFolder = useCallback((name: string) => {
    settingsTouchedRef.current.add(FAVORITE_FOLDERS_KEY);
    const folder = createFavoriteFolder(name, favoriteFolders);
    if (!folder) return null;
    const next = sanitizeFavoriteFolders([...favoriteFolders, folder]);
    setFavoriteFoldersState(next);
    storage.setItem(FAVORITE_FOLDERS_KEY, next);
    return folder;
  }, [favoriteFolders]);
  const toggleFavoriteFolderChannel = useCallback((folderId: string, channelId: string) => {
    settingsTouchedRef.current.add(FAVORITE_FOLDERS_KEY);
    if (!folderId || !channelId) return;
    setFavoriteFoldersState((prev) => {
      const next = sanitizeFavoriteFolders(toggleChannelInFolder(prev, folderId, channelId));
      storage.setItem(FAVORITE_FOLDERS_KEY, next);
      return next;
    });
  }, []);
  const renameFavoriteFolderById = useCallback((folderId: string, name: string) => {
    settingsTouchedRef.current.add(FAVORITE_FOLDERS_KEY);
    if (!folderId) return;
    setFavoriteFoldersState((prev) => {
      const next = sanitizeFavoriteFolders(renameFavoriteFolder(prev, folderId, name));
      storage.setItem(FAVORITE_FOLDERS_KEY, next);
      return next;
    });
  }, []);
  const removeFavoriteFolder = useCallback((id: string) => {
    settingsTouchedRef.current.add(FAVORITE_FOLDERS_KEY);
    if (!id) return;
    setFavoriteFoldersState((prev) => {
      const next = prev.filter((folder) => folder.id !== id);
      storage.setItem(FAVORITE_FOLDERS_KEY, next);
      return next;
    });
  }, []);
  const setGuideWindowHours = useCallback((v: GuideWindowHours) => {
    settingsTouchedRef.current.add(GUIDE_WINDOW_HOURS_KEY);
    const next = readGuideWindowHours(v, DEFAULT_GUIDE_WINDOW_HOURS);
    guideWindowHoursRef.current = next;
    setGuideWindowHoursState(next);
    storage.setItem(GUIDE_WINDOW_HOURS_KEY, next);
    void refreshSilentRef.current(true);
  }, []);
  const setClock24h = useCallback((v: boolean) => {
    settingsTouchedRef.current.add(CLOCK_24H_KEY);
    setClock24hState(v);
    setTimeFormat24h(v);
    storage.setItem(CLOCK_24H_KEY, v);
  }, []);
  const setStartScreen = useCallback((v: StartScreen) => {
    settingsTouchedRef.current.add(START_SCREEN_KEY);
    const next = resolveStartScreen(v);
    setStartScreenState(next);
    storage.setItem(START_SCREEN_KEY, next);
  }, []);
  const setSleepTimerMinutes = useCallback((v: SleepTimerMinutes) => {
    settingsTouchedRef.current.add(SLEEP_TIMER_MINUTES_KEY);
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
      return { ...channel, programs: [...programs] };
    },
    [channelByIdMap],
  );
  const isFavorite = useCallback((id: string) => favoritesSet.has(id), [favoritesSet]);

  const favoritesPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const favoritesPendingRef = useRef<string[] | null>(null);
  const persistFavorites = useCallback((next: string[]) => {
    favoritesPendingRef.current = next;
    if (favoritesPersistTimer.current) clearTimeout(favoritesPersistTimer.current);
    favoritesPersistTimer.current = setTimeout(() => {
      const payload = favoritesPendingRef.current;
      favoritesPendingRef.current = null;
      if (payload) void storage.setItem(FAV_KEY, payload);
    }, 450);
  }, []);
  const toggleFavorite = useCallback((id: string) => {
    startTransition(() => {
      setFavorites((prev) => {
        const next = toggleFavoriteId(prev, id);
        if (next === prev) return prev;
        persistFavorites(next);
        return next;
      });
    });
  }, [persistFavorites]);
  const replaceFavorites = useCallback((ids: string[]) => {
    const next = sanitizeFavoriteIds(ids);
    startTransition(() => setFavorites(next));
    persistFavorites(next);
  }, [persistFavorites]);

  const recentPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentPendingRef = useRef<string[] | null>(null);
  const persistRecent = useCallback((next: string[]) => {
    recentPendingRef.current = next;
    if (recentPersistTimer.current) clearTimeout(recentPersistTimer.current);
    recentPersistTimer.current = setTimeout(() => {
      const payload = recentPendingRef.current;
      recentPendingRef.current = null;
      if (!payload) return;
      void storage.setItem(RECENT_KEY, payload);
      if (payload[0]) void storage.setItem(LAST_CHANNEL_KEY, payload[0]);
    }, 450);
  }, []);
  const addRecent = useCallback((c: Channel) => {
    if (!c?.id) return;
    setLastChannelId(c.id);
    setRecentIds((prev) => {
      const next = pushRecentId(prev, c.id);
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      persistRecent(next);
      return next;
    });
  }, [persistRecent]);

  const hasReminder = useCallback((key: string) => remindersSet.has(key), [remindersSet]);
  const addReminder = useCallback(async (program: Program, channel: Channel) => {
    try {
      if (!program?.start || !channel?.id) return false;
      const key = reminderKey(channel.id, program.start);
      if (remindersRef.current.some((r) => r.key === key)) return true;
      const granted = await requestNotificationPermission();
      if (!granted) return false;
      const id = await scheduleProgramReminder({
        title: `${program.title || "Program"} is starting`,
        body: `On ${channel.name || "channel"}. Tap to switch channel.`,
        date: new Date(program.start),
        data: { channelId: channel.id },
      });
      if (!id) return false;
      const rem: Reminder = {
        key,
        notificationId: id,
        channelId: channel.id,
        channelName: channel.name,
        channelLogo: channel.logo || null,
        programTitle: program.title,
        programDesc: program.desc || "",
        start: program.start,
        stop: program.stop,
      };
      remindersRef.current = sanitizeReminders([
        ...remindersRef.current.filter((r) => r.key !== key),
        rem,
      ]) as Reminder[];
      setReminders((prev) => {
        const next = sanitizeReminders([...prev.filter((r) => r.key !== key), rem]) as Reminder[];
        try { storage.setItem(REM_KEY, next); } catch {}
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }, []);
  const removeReminder = useCallback(async (key: string) => {
    try {
      if (!key) return;
      const rem = remindersRef.current.find((r) => r.key === key);
      remindersRef.current = remindersRef.current.filter((r) => r.key !== key);
      setReminders((prev) => {
        const next = prev.filter((r) => r.key !== key);
        try { storage.setItem(REM_KEY, next); } catch {}
        return next;
      });
      if (rem?.notificationId) {
        const notificationId = rem.notificationId;
        setTimeout(() => { void cancelReminder(notificationId).catch(() => {}); }, 0);
      }
    } catch {}
  }, []);
  const toggleReminder = useCallback(
    (program: Program, channel: Channel): Promise<ReminderToggleResult> => {
      if (!program?.start || !channel?.id) return Promise.resolve("failed");
      const key = reminderKey(channel.id, program.start);
      const actual = remindersRef.current.some((reminder) => reminder.key === key);
      const desired = reminderDesiredStateRef.current.has(key)
        ? !!reminderDesiredStateRef.current.get(key)
        : actual;
      reminderDesiredStateRef.current.set(key, !desired);
      const inFlight = reminderMutationRef.current.get(key);
      if (inFlight) return inFlight;
      const mutation = (async (): Promise<ReminderToggleResult> => {
        while (true) {
          const current = remindersRef.current.some((reminder) => reminder.key === key);
          const target = reminderDesiredStateRef.current.get(key) ?? current;
          if (current === target) {
            reminderDesiredStateRef.current.delete(key);
            return current ? "added" : "removed";
          }
          if (target) {
            const added = await addReminder(program, channel);
            if (!added) {
              reminderDesiredStateRef.current.delete(key);
              return "failed";
            }
          } else {
            await removeReminder(key);
          }
        }
      })().finally(() => reminderMutationRef.current.delete(key));
      reminderMutationRef.current.set(key, mutation);
      return mutation;
    },
    [addReminder, removeReminder],
  );

  const refresh = useCallback(async (silent = false) => {
    if (silent && (isGuideSurfing() || fullscreenPlaybackOwnsDecoder())) {
      pendingSilentRefreshRef.current = true;
      return;
    }
    const requestId = ++refreshRequestRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const day = dayjs(dateRef.current);
      const isToday = day.isSame(dayjs(), "day");
      const start = isToday ? undefined : day.startOf("day").toISOString();
      const data = await loadGuide(start, guideWindowHoursRef.current);
      if (requestId !== refreshRequestRef.current) return;
      if (silent && (isGuideSurfing() || fullscreenPlaybackOwnsDecoder())) {
        pendingSilentRefreshRef.current = true;
        return;
      }
      const nextChannels = applyManualEpgRemaps(data.channels, epgManualRemapsRef.current);
      const nextPrograms = data.programsByChannelId && Object.keys(data.programsByChannelId).length
        ? data.programsByChannelId
        : Object.fromEntries(
            nextChannels
              .filter((channel) => Array.isArray(channel.programs) && channel.programs.length)
              .map((channel) => [channel.id, channel.programs as Program[]]),
          );
      windowStartRef.current = data.start;
      windowEndRef.current = data.end;
      guideEpochRef.current = data.guideEpoch || 0;
      applyGuidePrograms(makeGuideProgramWindowKey(data.start, data.end, guideEpochRef.current), nextPrograms);
      setChannels((prev) => {
        if (
          prev.length === nextChannels.length &&
          prev.length > 0 &&
          prev.every((channel, index) => {
            const next = nextChannels[index];
            return channel.id === next.id && channel.tvg_id === next.tvg_id && channel.name === next.name &&
              channel.logo === next.logo && channel.group === next.group && channel.url === next.url;
          })
        ) return prev;
        return nextChannels.map((channel) => ({
          id: channel.id,
          tvg_id: channel.tvg_id,
          name: channel.name,
          logo: channel.logo,
          group: channel.group,
          url: channel.url,
          stream_type: channel.stream_type,
        }));
      });
      setWindowStart(data.start);
      setWindowEnd(data.end);
      setFavorites((prev) => {
        const { ids } = remapStoredChannelIds(prev, nextChannels);
        if (ids.length === prev.length && ids.every((id, i) => id === prev[i])) return prev;
        void storage.setItem(FAV_KEY, ids);
        return ids;
      });
      setRecentIds((prev) => {
        const { ids } = remapStoredChannelIds(prev, nextChannels);
        if (ids.length === prev.length && ids.every((id, i) => id === prev[i])) return prev;
        persistRecent(ids);
        return ids;
      });
      setLastChannelId((prev) => {
        if (!prev) return prev;
        const { ids } = remapStoredChannelIds([prev], nextChannels);
        const next = ids[0] || prev;
        if (next !== prev) void storage.setItem(LAST_CHANNEL_KEY, next);
        return next;
      });
    } catch (e: any) {
      if (requestId !== refreshRequestRef.current) return;
      setError(formatNativeEpgError(e));
    } finally {
      if (!silent && requestId === refreshRequestRef.current) setLoading(false);
    }
  }, [persistRecent]);
  refreshSilentRef.current = refresh;

  const flushProgramPatchQueue = useCallback(async () => {
    if (patchInFlightRef.current || pendingPatchIdsRef.current.size === 0) return;
    if (!windowStartRef.current || !windowEndRef.current) return;
    patchInFlightRef.current = true;
    const ids = Array.from(pendingPatchIdsRef.current);
    const priorityOrder = pendingPatchPriorityIdsRef.current;
    pendingPatchIdsRef.current.clear();
    pendingPatchPriorityIdsRef.current = [];
    const start = windowStartRef.current;
    const end = windowEndRef.current;
    const guideEpoch = guideEpochRef.current;
    try {
      const applyTier = async (tierIds: string[]) => {
        if (!tierIds.length) return true;
        const delta = await loadGuideProgramsForChannelIds(tierIds, start, guideWindowHoursRef.current);
        if (start !== windowStartRef.current || end !== windowEndRef.current) return false;
        if (guideEpoch !== guideEpochRef.current) {
          pendingPatchIdsRef.current.clear();
          for (const id of lastPatchRunwayIdsRef.current) if (id) pendingPatchIdsRef.current.add(id);
          pendingPatchPriorityIdsRef.current = lastPatchRunwayIdsRef.current.slice(0, 3);
          return false;
        }
        const keep = lastKeepIdsRef.current.length ? lastKeepIdsRef.current : lastPatchRunwayIdsRef.current;
        const usefulDelta = keepUsefulGuidePatch(delta || {}, keep);
        if (Object.keys(usefulDelta).length) {
          applyGuidePrograms(makeGuideProgramWindowKey(start, end, guideEpochRef.current), usefulDelta);
        }
        retainGuidePrograms(keep);
        retainProgrammeWindowCache(keep);
        return true;
      };
      const tiers = buildGuidePatchTiers(ids, priorityOrder, 12, 24);
      for (const tier of tiers) {
        if (!(await applyTier(tier))) return;
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
    pendingPatchIdsRef.current.clear();
    pendingPatchPriorityIdsRef.current = [];
    lastPatchRunwayIdsRef.current = channelIds.filter(Boolean);
    for (const id of channelIds) if (id) pendingPatchIdsRef.current.add(id);
    for (const id of priorityIds) {
      if (id && pendingPatchIdsRef.current.has(id) && !pendingPatchPriorityIdsRef.current.includes(id)) {
        pendingPatchPriorityIdsRef.current.push(id);
      }
    }
    if (!pendingPatchIdsRef.current.size || patchInFlightRef.current || patchTimerRef.current) return;
    patchTimerRef.current = setTimeout(() => {
      patchTimerRef.current = null;
      void flushProgramPatchQueue();
    }, isGuideSurfing() ? 16 : 32);
  }, [flushProgramPatchQueue]);

  const retainGuideSlidingCache = useCallback((keepIds: Iterable<string>) => {
    const keep = Array.from(keepIds).filter(Boolean);
    if (!keep.length) return;
    lastKeepIdsRef.current = keep;
    retainGuidePrograms(keep);
    retainProgrammeWindowCache(keep);
  }, []);
  const releaseGuideSlidingCache = useCallback(() => {
    const keepLimit = powerProfile === "weak" ? 24 : powerProfile === "max_preview" ? 72 : 48;
    const source = lastKeepIdsRef.current.length ? lastKeepIdsRef.current : lastPatchRunwayIdsRef.current;
    const keep = pickKeepIdsAroundFocus(source, keepLimit, lastChannelId);
    lastPatchRunwayIdsRef.current = keep;
    lastKeepIdsRef.current = keep;
    pendingPatchIdsRef.current.clear();
    pendingPatchPriorityIdsRef.current = [];
    if (patchTimerRef.current) {
      clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    retainGuidePrograms(keep, { force: true });
    retainProgrammeWindowCache(keep);
    trimGuideProgramRows(keep, true);
    trimProgrammeWindowCacheForMemoryPressure(keep, true);
    clearChannelLogoMemory();
  }, [lastChannelId, powerProfile]);

  const setSelectedDate = useCallback((d: string) => {
    dateRef.current = d;
    setSelectedDateState(d);
    refresh();
  }, [refresh]);

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
    void (async () => {
      const rawFavorites = await storage.getItem<unknown>(FAV_KEY, []);
      const cleanedFavorites = sanitizeFavoriteIds(rawFavorites);
      setFavorites(cleanedFavorites);
      if (JSON.stringify(rawFavorites) !== JSON.stringify(cleanedFavorites)) void storage.setItem(FAV_KEY, cleanedFavorites);
      const rawRecent = await storage.getItem<unknown>(RECENT_KEY, []);
      const cleanedRecent = sanitizeRecentIds(rawRecent);
      setRecentIds(cleanedRecent);
      if (JSON.stringify(rawRecent) !== JSON.stringify(cleanedRecent)) void storage.setItem(RECENT_KEY, cleanedRecent);
      setLastChannelId(await storage.getItem<string | null>(LAST_CHANNEL_KEY, null));
      setReminders(sanitizeReminders((await storage.getItem<Reminder[]>(REM_KEY, [])) || []) as Reminder[]);
      const storedPointerMode = (await storage.getItem<boolean>(PMODE_KEY, false)) || false;
      if (!settingsTouchedRef.current.has(PMODE_KEY)) setPointerModeState(storedPointerMode);
      const storedGuideLayout = await storage.getItem<string | null>(GUIDE_LAYOUT_KEY, null);
      if (!settingsTouchedRef.current.has(GUIDE_LAYOUT_KEY)) setGuideLayoutState(resolveStoredGuideLayout(storedGuideLayout, Platform.isTV, Platform.OS));
      const extraCompactDefaultApplied = await storage.getItem<boolean>(EXTRA_COMPACT_DEFAULT_MIGRATION_KEY, false);
      const storedDensity = extraCompactDefaultApplied
        ? await storage.getItem<GuideDensity>(GUIDE_DENSITY_KEY, "extra_compact")
        : "extra_compact";
      if (!settingsTouchedRef.current.has(GUIDE_DENSITY_KEY)) {
        setGuideDensityState(storedDensity === "large" || storedDensity === "normal" || storedDensity === "compact" ? storedDensity : "extra_compact");
        if (!extraCompactDefaultApplied) void storage.setItem(GUIDE_DENSITY_KEY, "extra_compact");
      }
      if (!extraCompactDefaultApplied) void storage.setItem(EXTRA_COMPACT_DEFAULT_MIGRATION_KEY, true);
      const storedSafePreviewMode = (await storage.getItem<SafePreviewMode>(SAFE_PREVIEW_MODE_KEY, "surf")) || "surf";
      if (!settingsTouchedRef.current.has(SAFE_PREVIEW_MODE_KEY)) setSafePreviewModeState(storedSafePreviewMode);
      const storedChannelNumbers = (await storage.getItem<boolean>(CHANNEL_NUMBERS_KEY, false)) || false;
      if (!settingsTouchedRef.current.has(CHANNEL_NUMBERS_KEY)) setChannelNumbersState(storedChannelNumbers);
      const storedChannelLogos = (await storage.getItem<boolean>(CHANNEL_LOGOS_KEY, true)) ?? true;
      if (!settingsTouchedRef.current.has(CHANNEL_LOGOS_KEY)) setChannelLogosState(storedChannelLogos);
      const storedDeviceLayout = (await storage.getItem<DeviceLayoutMode>(DEVICE_LAYOUT_MODE_KEY, "auto")) || "auto";
      if (!settingsTouchedRef.current.has(DEVICE_LAYOUT_MODE_KEY)) setDeviceLayoutModeState(storedDeviceLayout);
      const storedPlayerTimeout = (await storage.getItem<PlayerControlsTimeoutMs>(PLAYER_TIMEOUT_KEY, 8000)) || 8000;
      if (!settingsTouchedRef.current.has(PLAYER_TIMEOUT_KEY)) setPlayerControlsTimeoutMsState(storedPlayerTimeout);
      const storedAutoRetry = (await storage.getItem<boolean>(AUTO_RETRY_KEY, true)) ?? true;
      if (!settingsTouchedRef.current.has(AUTO_RETRY_KEY)) setAutoRetryStreamsState(storedAutoRetry);
      const tvgOnly = (await storage.getItem<boolean>(PREFER_TVG_ID_ONLY_KEY, false)) || false;
      if (!settingsTouchedRef.current.has(PREFER_TVG_ID_ONLY_KEY)) {
        setPreferTvgIdOnlyState(tvgOnly);
        setPreferTvgIdOnlyMatching(tvgOnly);
      }
      const profile = resolvePowerProfile(await storage.getItem<string>(POWER_PROFILE_KEY, "normal"));
      const deviceMemory = await readDeviceMemoryProfile();
      const lowRamDevice = shouldUseLowRamTuning(deviceMemory);
      setDeviceLowRamCacheCap(lowRamDevice);
      if (!settingsTouchedRef.current.has(POWER_PROFILE_KEY)) {
        setPowerProfileState(profile);
        const memorySafeTuning = getPowerProfileTuning(profile);
        setGuideProgramRowLimit(memorySafeTuning.programmeRowCacheLimit);
        setProgrammeWindowCacheLimit(memorySafeTuning.programmeRowCacheLimit);
        setChannelLogoMemoryProfile(profile === "weak" || lowRamDevice, deviceMemory?.logoMemoryBytes);
      }
      const rawLogosOffWhileSurfing = await storage.getItem<boolean | null>(LOGOS_OFF_SURF_KEY, null);
      if (!settingsTouchedRef.current.has(LOGOS_OFF_SURF_KEY)) {
        setLogosOffWhileSurfingState(typeof rawLogosOffWhileSurfing === "boolean" ? rawLogosOffWhileSurfing : getPowerProfileTuning(profile).logosOffWhileSurfingDefault);
      }
      const storedInstantGuide = (await storage.getItem<boolean>(INSTANT_GUIDE_KEY, true)) ?? true;
      if (!settingsTouchedRef.current.has(INSTANT_GUIDE_KEY)) setInstantGuideState(storedInstantGuide);
      const storedEpgGuideFilter = resolveEpgGuideFilter(await storage.getItem<string>(EPG_GUIDE_FILTER_KEY, "all"));
      if (!settingsTouchedRef.current.has(EPG_GUIDE_FILTER_KEY)) setEpgGuideFilterState(storedEpgGuideFilter);
      const manualRemaps = sanitizeEpgManualRemap(await storage.getItem<Record<string, string>>(EPG_MANUAL_REMAPS_KEY, {}));
      if (!settingsTouchedRef.current.has(EPG_MANUAL_REMAPS_KEY)) {
        setEpgManualRemapsState(manualRemaps);
        setManualEpgRemaps(manualRemaps);
      }
      const foldersSeeded = (await storage.getItem<boolean>(FAVORITE_FOLDERS_SEEDED_KEY, false)) || false;
      const storedFolders = sanitizeFavoriteFolders(await storage.getItem<FavoriteFolder[]>(FAVORITE_FOLDERS_KEY, []));
      if (!settingsTouchedRef.current.has(FAVORITE_FOLDERS_KEY)) {
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
      }
      const storedGuideWindowHours = readGuideWindowHours(
        await storage.getItem<number>(GUIDE_WINDOW_HOURS_KEY, DEFAULT_GUIDE_WINDOW_HOURS),
        DEFAULT_GUIDE_WINDOW_HOURS,
      );
      if (!settingsTouchedRef.current.has(GUIDE_WINDOW_HOURS_KEY)) {
        guideWindowHoursRef.current = storedGuideWindowHours;
        setGuideWindowHoursState(storedGuideWindowHours);
      }
      const storedClock24h = (await storage.getItem<boolean>(CLOCK_24H_KEY, false)) || false;
      if (!settingsTouchedRef.current.has(CLOCK_24H_KEY)) {
        setClock24hState(storedClock24h);
        setTimeFormat24h(storedClock24h);
      }
      const storedStartScreen = resolveStartScreen(await storage.getItem<string>(START_SCREEN_KEY, "home"));
      if (!settingsTouchedRef.current.has(START_SCREEN_KEY)) setStartScreenState(storedStartScreen);
      const storedSleepTimer = resolveSleepTimerMinutes(await storage.getItem<number>(SLEEP_TIMER_MINUTES_KEY, 0));
      if (!settingsTouchedRef.current.has(SLEEP_TIMER_MINUTES_KEY)) setSleepTimerMinutesState(storedSleepTimer);

      // Cold start is local/cache only. TiViMate-style provider/EPG synchronization
      // is owned by the route-aware scheduler after its startup deferral; it must
      // never be launched from this interactive bootstrap effect.
      await refresh();
      if (disposed) return;
    })();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const unsubscribe = subscribeSource(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (disposed) return;
        if (isGuideSurfing() || fullscreenPlaybackOwnsDecoder()) {
          pendingSilentRefreshRef.current = true;
          return;
        }
        void refresh(true);
      }, 500);
    });
    const unsubSettle = onGuideSurfSettled(() => {
      if (disposed || !pendingSilentRefreshRef.current || fullscreenPlaybackOwnsDecoder()) return;
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

  useEffect(() => () => {
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    pendingPatchIdsRef.current.clear();
    pendingPatchPriorityIdsRef.current = [];
    lastPatchRunwayIdsRef.current = [];
    lastKeepIdsRef.current = [];
    if (favoritesPersistTimer.current) clearTimeout(favoritesPersistTimer.current);
    if (favoritesPendingRef.current) void storage.setItem(FAV_KEY, favoritesPendingRef.current);
    if (recentPersistTimer.current) clearTimeout(recentPersistTimer.current);
    if (recentPendingRef.current) {
      const payload = recentPendingRef.current;
      void storage.setItem(RECENT_KEY, payload);
      if (payload[0]) void storage.setItem(LAST_CHANNEL_KEY, payload[0]);
    }
  }, []);

  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = loading || refreshing; }, [loading, refreshing]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current || isGuideScreenActive() || isGuideSurfing() || fullscreenPlaybackOwnsDecoder()) return;
      void refresh(true);
    }, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openProgram = useCallback((program: Program, channel: Channel) => {
    if (!program || !channel || !channel.id || !program.start || Number.isNaN(Date.parse(program.start))) return;
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

  const value: Store = useMemo(() => ({
    channels, windowStart, windowEnd, loading, refreshing, error, refresh, hardRefresh,
    patchProgramsForChannelIds, retainGuideSlidingCache, releaseGuideSlidingCache,
    selectedDate, setSelectedDate, channelById,
    favorites, isFavorite, toggleFavorite, replaceFavorites,
    recent, recentIds, lastChannelId, addRecent,
    reminders, hasReminder, addReminder, removeReminder, toggleReminder,
    activeProgram, openProgram, closeProgram,
    pointerMode, setPointerMode,
    guideLayout, setGuideLayout, guideDensity, setGuideDensity,
    safePreviewMode, setSafePreviewMode, channelNumbers, setChannelNumbers,
    channelLogos, setChannelLogos, deviceLayoutMode, setDeviceLayoutMode,
    playerControlsTimeoutMs, setPlayerControlsTimeoutMs, autoRetryStreams, setAutoRetryStreams,
    preferTvgIdOnly, setPreferTvgIdOnly, powerProfile, setPowerProfile,
    logosOffWhileSurfing, setLogosOffWhileSurfing, instantGuide, setInstantGuide,
    epgGuideFilter, setEpgGuideFilter, epgManualRemaps, setEpgManualRemaps,
    favoriteFolders, setFavoriteFolders, addFavoriteFolder, toggleFavoriteFolderChannel,
    renameFavoriteFolder: renameFavoriteFolderById, removeFavoriteFolder,
    guideWindowHours, setGuideWindowHours, clock24h, setClock24h,
    startScreen, setStartScreen, sleepTimerMinutes, setSleepTimerMinutes,
  }), [
    channels, windowStart, windowEnd, loading, refreshing, error, refresh, hardRefresh,
    patchProgramsForChannelIds, retainGuideSlidingCache, releaseGuideSlidingCache,
    selectedDate, setSelectedDate, channelById,
    favorites, isFavorite, toggleFavorite, replaceFavorites,
    recent, recentIds, lastChannelId, addRecent,
    reminders, hasReminder, addReminder, removeReminder, toggleReminder,
    activeProgram, openProgram, closeProgram,
    pointerMode, setPointerMode, guideLayout, setGuideLayout, guideDensity, setGuideDensity,
    safePreviewMode, setSafePreviewMode, channelNumbers, setChannelNumbers,
    channelLogos, setChannelLogos, deviceLayoutMode, setDeviceLayoutMode,
    playerControlsTimeoutMs, setPlayerControlsTimeoutMs, autoRetryStreams, setAutoRetryStreams,
    preferTvgIdOnly, setPreferTvgIdOnly, powerProfile, setPowerProfile,
    logosOffWhileSurfing, setLogosOffWhileSurfing, instantGuide, setInstantGuide,
    epgGuideFilter, setEpgGuideFilter, epgManualRemaps, setEpgManualRemaps,
    favoriteFolders, setFavoriteFolders, addFavoriteFolder, toggleFavoriteFolderChannel,
    renameFavoriteFolderById, removeFavoriteFolder, guideWindowHours, setGuideWindowHours,
    clock24h, setClock24h, startScreen, setStartScreen, sleepTimerMinutes, setSleepTimerMinutes,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
