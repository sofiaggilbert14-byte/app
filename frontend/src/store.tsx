import React, { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState, useMemo } from "react";
import dayjs from "dayjs";
import { storage } from "@/src/utils/storage";
import { Channel, Program } from "@/src/api";
import { loadGuide, refreshSource, subscribeSource } from "@/src/source";
import { reminderKey } from "@/src/utils/time";
import { sanitizeFavoriteIds, toggleFavoriteId } from "@/src/utils/favoriteIds";
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
const GUIDE_WINDOW_HOURS = readGuideWindowHours(process.env.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 8);

function readGuideWindowHours(value: string | undefined, fallback: number): number {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(48, Math.max(6, Math.round(n)));
}

export type GuideLayout = "cinematic" | "compact";
export type GuideDensity = "large" | "normal" | "compact";
export type SafePreviewMode = "on" | "delayed" | "off";
export type DeviceLayoutMode = "auto" | "tv" | "mobile";
export type PlayerControlsTimeoutMs = 8000 | 15000 | 30000 | 60000;

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

type Store = {
  channels: Channel[];
  windowStart: string;
  windowEnd: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
  hardRefresh: () => Promise<void>;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  channelById: (id: string) => Channel | undefined;

  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  replaceFavorites: (ids: string[]) => void;

  recent: Channel[];
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

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<Channel[]>([]);
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

  // Memoized helpers for fast lookups
  const channelByIdMap = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);

  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

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

  const channelById = useCallback((id: string) => channelByIdMap.get(id), [channelByIdMap]);

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
  const addRecent = useCallback((c: Channel) => {
    setLastChannelId(c.id);
    setRecent((prev) => {
      const next = [c, ...prev.filter((x) => x.id !== c.id)].slice(0, 15);
      // Debounce AsyncStorage writes during rapid channel surfing.
      if (recentPersistTimer.current) clearTimeout(recentPersistTimer.current);
      recentPersistTimer.current = setTimeout(() => {
        storage.setItem(LAST_CHANNEL_KEY, c.id);
        storage.setItem(RECENT_KEY, next);
      }, 450);
      return next;
    });
  }, []);

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
      remindersRef.current = [...remindersRef.current.filter((r) => r.key !== key), rem];
      setReminders((prev) => {
        const next = [...prev.filter((r) => r.key !== key), rem];
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
    const requestId = ++refreshRequestRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const day = dayjs(dateRef.current);
      const isToday = day.isSame(dayjs(), "day");
      const start = isToday ? undefined : day.startOf("day").toISOString();
      const data = await loadGuide(start, GUIDE_WINDOW_HOURS);
      if (requestId !== refreshRequestRef.current) return;
      setChannels(data.channels);
      setWindowStart(data.start);
      setWindowEnd(data.end);
    } catch (e: any) {
      if (requestId !== refreshRequestRef.current) return;
      setError(e?.message || "Failed to load guide");
    } finally {
      if (!silent && requestId === refreshRequestRef.current) setLoading(false);
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
      setRecent((await storage.getItem<Channel[]>(RECENT_KEY, [])) || []);
      setLastChannelId(await storage.getItem<string | null>(LAST_CHANNEL_KEY, null));
      setReminders((await storage.getItem<Reminder[]>(REM_KEY, [])) || []);
      setPointerModeState((await storage.getItem<boolean>(PMODE_KEY, false)) || false);
      setGuideLayoutState((await storage.getItem<GuideLayout>(GUIDE_LAYOUT_KEY, "cinematic")) || "cinematic");
      setGuideDensityState((await storage.getItem<GuideDensity>(GUIDE_DENSITY_KEY, "normal")) || "normal");
      setSafePreviewModeState((await storage.getItem<SafePreviewMode>(SAFE_PREVIEW_MODE_KEY, "delayed")) || "delayed");
      setChannelNumbersState((await storage.getItem<boolean>(CHANNEL_NUMBERS_KEY, false)) || false);
      setChannelLogosState((await storage.getItem<boolean>(CHANNEL_LOGOS_KEY, true)) ?? true);
      setDeviceLayoutModeState((await storage.getItem<DeviceLayoutMode>(DEVICE_LAYOUT_MODE_KEY, "auto")) || "auto");
      setPlayerControlsTimeoutMsState((await storage.getItem<PlayerControlsTimeoutMs>(PLAYER_TIMEOUT_KEY, 8000)) || 8000);
      setAutoRetryStreamsState((await storage.getItem<boolean>(AUTO_RETRY_KEY, true)) ?? true);

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

  useEffect(() => subscribeSource(() => refresh(true)), [refresh]);

  useEffect(
    () => () => {
      if (favoritesPersistTimer.current) clearTimeout(favoritesPersistTimer.current);
      if (favoritesPendingRef.current) void storage.setItem(FAV_KEY, favoritesPendingRef.current);
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
      if (busyRef.current) return;
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
      selectedDate,
      setSelectedDate,
      channelById,
      favorites,
      isFavorite,
      toggleFavorite,
      replaceFavorites,
      recent,
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
      selectedDate,
      setSelectedDate,
      channelById,
      favorites,
      isFavorite,
      toggleFavorite,
      replaceFavorites,
      recent,
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
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
