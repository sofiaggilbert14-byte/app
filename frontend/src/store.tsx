import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager, Platform } from "react-native";
import dayjs from "dayjs";
import { storage } from "@/src/utils/storage";
import { Channel, Program } from "@/src/api";
import { loadGuide, refreshSource, subscribeSource } from "@/src/source";
import { reminderKey } from "@/src/utils/time";
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
const GUIDE_WINDOW_KEY = "gs_guide_window_hours";
// Roadmap: moving 4-hour window. Cap at native MAX_QUERY_WINDOW (24h).
export const GUIDE_WINDOW_HOURS = readGuideWindowHours(process.env.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 4);
const DEFAULT_SAFE_PREVIEW: SafePreviewMode = Platform.isTV ? "off" : "delayed";

function readGuideWindowHours(value: string | number | undefined | null, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(24, Math.max(4, Math.round(n)));
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
  mergeFavorites: (ids: string[]) => void;

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
  guideWindowHours: number;
  setGuideWindowHours: (h: 4 | 6 | 8 | 12) => void;
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
  const remindersRef = useRef<Reminder[]>([]);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<Channel[]>([]);
  const [lastChannelId, setLastChannelId] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [activeProgram, setActiveProgram] = useState<ActiveProgram>(null);
  const [pointerMode, setPointerModeState] = useState(false);
  const [guideLayout, setGuideLayoutState] = useState<GuideLayout>("cinematic");
  const [guideDensity, setGuideDensityState] = useState<GuideDensity>("normal");
  const [safePreviewMode, setSafePreviewModeState] = useState<SafePreviewMode>(DEFAULT_SAFE_PREVIEW);
  const [channelNumbers, setChannelNumbersState] = useState(false);
  const [channelLogos, setChannelLogosState] = useState(true);
  const [deviceLayoutMode, setDeviceLayoutModeState] = useState<DeviceLayoutMode>("auto");
  const [playerControlsTimeoutMs, setPlayerControlsTimeoutMsState] = useState<PlayerControlsTimeoutMs>(15000);
  const [autoRetryStreams, setAutoRetryStreamsState] = useState(true);
  const [guideWindowHours, setGuideWindowHoursState] = useState(GUIDE_WINDOW_HOURS);
  const guideWindowHoursRef = useRef(guideWindowHours);

  const channelMap = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  useEffect(() => {
    guideWindowHoursRef.current = guideWindowHours;
  }, [guideWindowHours]);

  const setPointerMode = useCallback((v: boolean) => {
    setPointerModeState(v);
    void storage.setItem(PMODE_KEY, v).catch(() => {});
  }, []);

  const setGuideLayout = useCallback((v: GuideLayout) => {
    setGuideLayoutState(v);
    void storage.setItem(GUIDE_LAYOUT_KEY, v).catch(() => {});
  }, []);

  const setGuideDensity = useCallback((v: GuideDensity) => {
    setGuideDensityState(v);
    void storage.setItem(GUIDE_DENSITY_KEY, v).catch(() => {});
  }, []);

  const setSafePreviewMode = useCallback((v: SafePreviewMode) => {
    setSafePreviewModeState(v);
    void storage.setItem(SAFE_PREVIEW_MODE_KEY, v).catch(() => {});
  }, []);

  const setChannelNumbers = useCallback((v: boolean) => {
    setChannelNumbersState(v);
    void storage.setItem(CHANNEL_NUMBERS_KEY, v).catch(() => {});
  }, []);

  const setChannelLogos = useCallback((v: boolean) => {
    setChannelLogosState(v);
    void storage.setItem(CHANNEL_LOGOS_KEY, v).catch(() => {});
  }, []);

  const setDeviceLayoutMode = useCallback((v: DeviceLayoutMode) => {
    setDeviceLayoutModeState(v);
    void storage.setItem(DEVICE_LAYOUT_MODE_KEY, v).catch(() => {});
  }, []);

  const setPlayerControlsTimeoutMs = useCallback((v: PlayerControlsTimeoutMs) => {
    setPlayerControlsTimeoutMsState(v);
    void storage.setItem(PLAYER_TIMEOUT_KEY, v).catch(() => {});
  }, []);

  const setAutoRetryStreams = useCallback((v: boolean) => {
    setAutoRetryStreamsState(v);
    void storage.setItem(AUTO_RETRY_KEY, v).catch(() => {});
  }, []);

  const setGuideWindowHours = useCallback((h: 4 | 6 | 8 | 12) => {
    const next = readGuideWindowHours(h, GUIDE_WINDOW_HOURS);
    setGuideWindowHoursState((prev) => {
      if (prev === next) return prev;
      guideWindowHoursRef.current = next;
      void storage.setItem(GUIDE_WINDOW_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const refresh = useCallback(async (silent = false) => {
    const requestId = ++refreshRequestRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const day = dayjs(dateRef.current);
      const isToday = day.isSame(dayjs(), "day");
      const start = isToday ? undefined : day.startOf("day").toISOString();
      // Keep only a moving guide window in rendered channel objects. The
      // source cache can retain more guide data without creating a huge TV UI.
      const data = await loadGuide(start, guideWindowHoursRef.current);
      // Source notifications can arrive close together (playlist first, then
      // EPG). Never let an older, slower SQLite query replace newer rows.
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
      void refresh();
    },
    [refresh],
  );

  const hardRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshSource(true);
      await refresh(true);
    } catch (e: any) {
      setError(e?.message || "Failed to refresh guide");
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [
          favs,
          recentChannels,
          lastId,
          rem,
          pmode,
          layout,
          density,
          preview,
          numbers,
          logos,
          deviceLayout,
          timeout,
          autoRetry,
          windowHours,
        ] = await Promise.all([
          storage.getItem<string[]>(FAV_KEY, []),
          storage.getItem<Channel[]>(RECENT_KEY, []),
          storage.getItem<string | null>(LAST_CHANNEL_KEY, null),
          storage.getItem<Reminder[]>(REM_KEY, []),
          storage.getItem<boolean>(PMODE_KEY, false),
          storage.getItem<GuideLayout>(GUIDE_LAYOUT_KEY, "cinematic"),
          storage.getItem<GuideDensity>(GUIDE_DENSITY_KEY, "normal"),
          storage.getItem<SafePreviewMode | null>(SAFE_PREVIEW_MODE_KEY, null),
          storage.getItem<boolean>(CHANNEL_NUMBERS_KEY, false),
          storage.getItem<boolean>(CHANNEL_LOGOS_KEY, true),
          storage.getItem<DeviceLayoutMode>(DEVICE_LAYOUT_MODE_KEY, "auto"),
          storage.getItem<PlayerControlsTimeoutMs>(PLAYER_TIMEOUT_KEY, 15000),
          storage.getItem<boolean>(AUTO_RETRY_KEY, true),
          storage.getItem<number | null>(GUIDE_WINDOW_KEY, null),
        ]);
        if (cancelled) return;
        setFavorites(favs || []);
        setRecent(recentChannels || []);
        setLastChannelId(lastId);
        setReminders(rem || []);
        setPointerModeState(pmode || false);
        setGuideLayoutState(layout || "cinematic");
        setGuideDensityState(density || "normal");
        // Only restore an explicit user choice; otherwise keep the TV-safe default.
        setSafePreviewModeState(preview || DEFAULT_SAFE_PREVIEW);
        setChannelNumbersState(numbers || false);
        setChannelLogosState(logos ?? true);
        setDeviceLayoutModeState(deviceLayout || "auto");
        setPlayerControlsTimeoutMsState(timeout || 15000);
        setAutoRetryStreamsState(autoRetry ?? true);
        // Env default first; persisted override wins when present (clamped 4–24).
        if (windowHours != null) {
          const resolved = readGuideWindowHours(windowHours, GUIDE_WINDOW_HOURS);
          setGuideWindowHoursState(resolved);
          guideWindowHoursRef.current = resolved;
        }
      } catch (e) {
        console.warn("[GuideProvider] prefs load failed", e);
      }

      requestNotificationPermission().catch(() => {});
      // Launch paints the last-good on-device guide first. The background
      // check respects the 24-hour cache and does not download on every open.
      if (!cancelled) await refresh();
      if (cancelled) return;
      void refreshSource(false).catch((e) => {
        console.warn("[GuideProvider] background refresh failed", e);
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-paint when the source finishes its staged load (channels first, then EPG)
  // or after a background refresh — reads from the in-memory cache, no network.
  useEffect(() => subscribeSource(() => {
    void refresh(true);
  }), [refresh]);

  // Re-load the rendered window when the user changes guide window hours.
  // Defer until interactions settle so Settings D-pad focus does not freeze.
  const guideWindowBootstrapped = useRef(false);
  useEffect(() => {
    if (!guideWindowBootstrapped.current) {
      guideWindowBootstrapped.current = true;
      return;
    }
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      void refresh(true);
    });
    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [guideWindowHours, refresh]);

  const channelById = useCallback((id: string) => channelMap.get(id), [channelMap]);

  const isFavorite = useCallback((id: string) => favoriteSet.has(id), [favoriteSet]);
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      void storage.setItem(FAV_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const mergeFavorites = useCallback((ids: string[]) => {
    const requested = new Set(ids.filter(Boolean));
    if (!requested.size) return;
    setFavorites((prev) => {
      const nextSet = new Set(prev);
      let changed = false;
      for (const id of requested) {
        if (!nextSet.has(id)) {
          nextSet.add(id);
          changed = true;
        }
      }
      if (!changed) return prev;
      const next = Array.from(nextSet);
      void storage.setItem(FAV_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const addRecent = useCallback((c: Channel) => {
    setLastChannelId(c.id);
    void storage.setItem(LAST_CHANNEL_KEY, c.id).catch(() => {});
    setRecent((prev) => {
      const next = [c, ...prev.filter((x) => x.id !== c.id)].slice(0, 15);
      void storage.setItem(RECENT_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const hasReminder = useCallback(
    (key: string) => reminders.some((r) => r.key === key),
    [reminders],
  );

  const addReminder = useCallback(async (program: Program, channel: Channel) => {
    const key = reminderKey(channel.id, program.start);
    if (remindersRef.current.some((r) => r.key === key)) return true;
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    const id = await scheduleProgramReminder({
      title: `${program.title} is starting`,
      body: `On ${channel.name}. Tap to switch channel.`,
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
    setReminders((prev) => {
      if (prev.some((r) => r.key === key)) return prev;
      const next = [...prev, rem];
      void storage.setItem(REM_KEY, next).catch(() => {});
      return next;
    });
    return true;
  }, []);

  const removeReminder = useCallback(async (key: string) => {
    const rem = remindersRef.current.find((r) => r.key === key);
    if (rem) {
      try {
        await cancelReminder(rem.notificationId);
      } catch (e) {
        console.warn("[GuideProvider] cancelReminder failed", e);
      }
    }
    setReminders((prev) => {
      const next = prev.filter((r) => r.key !== key);
      void storage.setItem(REM_KEY, next).catch(() => {});
      return next;
    });
  }, []);

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

  const value = useMemo<Store>(
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
      mergeFavorites,
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
      guideWindowHours,
      setGuideWindowHours,
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
      mergeFavorites,
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
      guideWindowHours,
      setGuideWindowHours,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
