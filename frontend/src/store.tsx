import React, { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState, useMemo } from "react";
import dayjs from "dayjs";
import { storage } from "@/src/utils/storage";
import { Channel, Program } from "@/src/api";
import {
  loadGuide,
  loadGuideProgramsForChannelIds,
  refreshEpgOnly,
  refreshSource,
  setManualEpgRemaps,
  setPreferTvgIdOnlyMatching,
  subscribeSource,
} from "@/src/source";
import { isGuideSurfing, onGuideSurfSettled } from "@/src/utils/guideSurfGate";
import { reminderKey, setTimeFormat24h } from "@/src/utils/time";
import { sanitizeFavoriteIds, toggleFavoriteId } from "@/src/utils/favoriteIds";
import { pushRecentId, sanitizeRecentIds } from "@/src/utils/recentIds";
import { sanitizeReminders } from "@/src/utils/reminderIds";
import { remapStoredChannelIds } from "@/src/utils/channelIdentityMigrate";
import { getPowerProfileTuning, resolvePowerProfile, type PowerProfile } from "@/src/core/devicePowerProfile";
import { applyManualEpgRemaps, resolveEpgGuideFilter, sanitizeEpgManualRemap, type EpgGuideFilter } from "@/src/core/epgUserOverrides";
import {
  createFavoriteFolder,
  DEFAULT_FOLDER_PRESETS,
  nextFavoriteFolderName,
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

const DEFAULT_GUIDE_WINDOW_HOURS = readGuideWindowHours(process.env.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 8);

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
export type GuideDensity = "large" | "normal" | "compact";
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

export type ActiveProgram = { program: Program; channel: Channel } | null;

export type Store = {
  channels: Channel[];
  /** Normalized EPG programmes keyed by playlist channel id — patchable without remounting channels. */
  programsByChannelId: Record<string, Program[]>;
  windowStart: string;
  windowEnd: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
  hardRefresh: () => Promise<void>;
  /** Fetch/attach programmes for a viewport ring without a full guide rebuild. */
  patchProgramsForChannelIds: (channelIds: string[]) => Promise<void>;
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
  const [programsByChannelId, setProgramsByChannelId] = useState<Record<string, Program[]>>({});
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
  const patchRequestRef = useRef(0);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [lastChannelId, setLastChannelId] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const remindersRef = useRef<Reminder[]>([]);
  // Keep ref in sync during render so async add/remove see the latest list immediately
  // (useEffect would lag one frame and break hasReminder after setReminders).
  remindersRef.current = reminders;
  const remindersSet = useMemo(() => new Set(reminders.map((r) => r.key)), [reminders]);

  const [activeProgram, setActiveProgram] = useState<ActiveProgram>(null);
  const [pointerMode, setPointerModeState] = useState(false);
  const [guideLayout, setGuideLayoutState] = useState<GuideLayout>("cinematic");
  const [guideDensity, setGuideDensityState] = useState<GuideDensity>("normal");
  const [safePreviewMode, setSafePreviewModeState] = useState<SafePreviewMode>("delayed");
  const [channelNumbers, setChannelNumbersState] = useState(false);
  const [channelLogos, setChannelLogosState] = useState(true);
  const [deviceLayoutMode, setDeviceLayoutModeState] = useState<DeviceLayoutMode>("auto");
  const [playerControlsTimeoutMs, setPlayerControlsTimeoutMsState] = useState<PlayerControlsTimeoutMs>(8000);
  const [autoRetryStreams, setAutoRetryStreamsState] = useState(true);
  const [preferTvgIdOnly, setPreferTvgIdOnlyState] = useState(false);
  const [powerProfile, setPowerProfileState] = useState<PowerProfile>("normal");
  const [logosOffWhileSurfing, setLogosOffWhileSurfingState] = useState(getPowerProfileTuning("normal").logosOffWhileSurfingDefault);
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
      const programs = programsByChannelId[id];
      if (!programs?.length) return channel;
      if (channel.programs === programs) return channel;
      return { ...channel, programs };
    },
    [channelByIdMap, programsByChannelId],
  );

  const isFavorite = useCallback((id: string) => favoritesSet.has(id), [favoritesSet]);

  // Debounce AsyncStorage writes — rapid long-press favorites were hitching Fire TV I/O.
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
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) {
        return prev;
      }
      persistRecent(next);
      return next;
    });
  }, [persistRecent]);

  // Intentionally do NOT prune favorite/recent IDs when the playlist loads.
  // A partial or temporary channel list must never wipe user favorites from KV.
  // UI filters already hide IDs that are not in the current playlist.

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
        programTitle: program.title,
        start: program.start,
        stop: program.stop,
      };
      // Update ref synchronously so immediate hasReminder / toggle reads are correct.
      remindersRef.current = sanitizeReminders([
        ...remindersRef.current.filter((r) => r.key !== key),
        rem,
      ]) as Reminder[];
      setReminders((prev) => {
        const next = sanitizeReminders([...prev.filter((r) => r.key !== key), rem]) as Reminder[];
        try {
          storage.setItem(REM_KEY, next);
        } catch {}
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
      // Flip UI / store immediately; cancel the OS notification after paint.
      remindersRef.current = remindersRef.current.filter((r) => r.key !== key);
      setReminders((prev) => {
        const next = prev.filter((r) => r.key !== key);
        try {
          storage.setItem(REM_KEY, next);
        } catch {}
        return next;
      });
      if (rem?.notificationId) {
        const notificationId = rem.notificationId;
        setTimeout(() => {
          void cancelReminder(notificationId).catch(() => {});
        }, 0);
      }
    } catch {
      // Never let reminder cleanup take down the guide.
    }
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (silent && isGuideSurfing()) {
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
      // Keep channel meta stable when identity/order unchanged; always merge programmes.
      const nextChannels = applyManualEpgRemaps(data.channels, epgManualRemapsRef.current);
      const nextPrograms =
        data.programsByChannelId && Object.keys(data.programsByChannelId).length
          ? data.programsByChannelId
          : Object.fromEntries(
              nextChannels
                .filter((channel) => Array.isArray(channel.programs) && channel.programs.length)
                .map((channel) => [channel.id, channel.programs as Program[]]),
            );
      setProgramsByChannelId((prev) => ({ ...prev, ...nextPrograms }));
      setChannels((prev) => {
        if (
          prev.length === nextChannels.length &&
          prev.length > 0 &&
          prev.every((channel, index) => {
            const next = nextChannels[index];
            return (
              channel.id === next.id &&
              channel.tvg_id === next.tvg_id &&
              channel.name === next.name &&
              channel.logo === next.logo &&
              channel.group === next.group &&
              channel.url === next.url
            );
          })
        ) {
          return prev;
        }
        // Strip nested programs from channel objects — UI reads programsByChannelId.
        return nextChannels.map((channel) => {
          if (!channel.programs?.length) return channel;
          const { programs: _programs, ...meta } = channel;
          return meta;
        });
      });
      setWindowStart(data.start);
      setWindowEnd(data.end);
      // Soft-remap Phase-4 / collision IDs onto the live playlist without wiping orphans.
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
      setError(e?.message || "Failed to load guide");
    } finally {
      if (!silent && requestId === refreshRequestRef.current) setLoading(false);
    }
  }, [persistRecent]);

  refreshSilentRef.current = refresh;

  const patchProgramsForChannelIds = useCallback(async (channelIds: string[]) => {
    if (!channelIds.length) return;
    const requestId = ++patchRequestRef.current;
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    await new Promise<void>((resolve) => {
      patchTimerRef.current = setTimeout(() => resolve(), isGuideSurfing() ? 90 : 140);
    });
    if (requestId !== patchRequestRef.current) return;
    try {
      const day = dayjs(dateRef.current);
      const isToday = day.isSame(dayjs(), "day");
      const start = isToday ? undefined : day.startOf("day").toISOString();
      const delta = await loadGuideProgramsForChannelIds(channelIds, start, guideWindowHoursRef.current);
      if (requestId !== patchRequestRef.current) return;
      if (!delta || !Object.keys(delta).length) return;
      startTransition(() => {
        setProgramsByChannelId((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, list] of Object.entries(delta)) {
            if (!list?.length) continue;
            if (prev[id] === list) continue;
            next[id] = list;
            changed = true;
          }
          return changed ? next : prev;
        });
      });
    } catch {
      /* keep last-good programmes on the glass */
    }
  }, []);

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
    (async () => {
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
      setGuideLayoutState((await storage.getItem<GuideLayout>(GUIDE_LAYOUT_KEY, "cinematic")) || "cinematic");
      setGuideDensityState((await storage.getItem<GuideDensity>(GUIDE_DENSITY_KEY, "normal")) || "normal");
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

      // Health check after the UI can accept D-pad input.
      setTimeout(() => {
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
      programsByChannelId,
      windowStart,
      windowEnd,
      loading,
      refreshing,
      error,
      refresh,
      hardRefresh,
      patchProgramsForChannelIds,
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
      programsByChannelId,
      windowStart,
      windowEnd,
      loading,
      refreshing,
      error,
      refresh,
      hardRefresh,
      patchProgramsForChannelIds,
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
