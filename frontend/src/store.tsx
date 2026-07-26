import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { storage } from "@/src/utils/storage";
import { Channel, Program } from "@/src/api";
import { loadGuide, refreshSource, subscribeSource, subscribeProgress, EpgProgress } from "@/src/source";
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
const GUIDE_WINDOW_HOURS = readGuideWindowHours(process.env.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 12);

function readGuideWindowHours(value: string | undefined, fallback: number): number {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(72, Math.max(12, Math.round(n)));
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

  epgProgress: EpgProgress;
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

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<Channel[]>([]);
  const [lastChannelId, setLastChannelId] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [activeProgram, setActiveProgram] = useState<ActiveProgram>(null);
  const [pointerMode, setPointerModeState] = useState(false);
  const [guideLayout, setGuideLayoutState] = useState<GuideLayout>("cinematic");
  const [guideDensity, setGuideDensityState] = useState<GuideDensity>("normal");
  const [safePreviewMode, setSafePreviewModeState] = useState<SafePreviewMode>("delayed");
  const [channelNumbers, setChannelNumbersState] = useState(false);
  const [channelLogos, setChannelLogosState] = useState(true);
  const [deviceLayoutMode, setDeviceLayoutModeState] = useState<DeviceLayoutMode>("auto");
  const [playerControlsTimeoutMs, setPlayerControlsTimeoutMsState] = useState<PlayerControlsTimeoutMs>(60000);
  const [autoRetryStreams, setAutoRetryStreamsState] = useState(true);
  const [epgProgress, setEpgProgress] = useState<EpgProgress>({
    phase: "idle",
    ratio: 0,
    etaSeconds: null,
  });

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

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const day = dayjs(dateRef.current);
      const isToday = day.isSame(dayjs(), "day");
      const start = isToday ? undefined : day.startOf("day").toISOString();
      // Keep only a moving guide window in rendered channel objects. The
      // source cache can retain more guide data without creating a huge TV UI.
      const data = await loadGuide(start, GUIDE_WINDOW_HOURS);
      setChannels(data.channels);
      setWindowStart(data.start);
      setWindowEnd(data.end);
    } catch (e: any) {
      setError(e?.message || "Failed to load guide");
    } finally {
      if (!silent) setLoading(false);
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
      await refreshSource();
      await refresh(true);
    } catch {}
    setRefreshing(false);
  }, [refresh]);

  useEffect(() => {
    (async () => {
      setFavorites((await storage.getItem<string[]>(FAV_KEY, [])) || []);
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
      setPlayerControlsTimeoutMsState((await storage.getItem<PlayerControlsTimeoutMs>(PLAYER_TIMEOUT_KEY, 60000)) || 60000);
      setAutoRetryStreamsState((await storage.getItem<boolean>(AUTO_RETRY_KEY, true)) ?? true);
      requestNotificationPermission();
      // Launch should paint the last-good guide first so weak TV boxes do not
      // freeze waiting on a fresh EPG download. Once the screen is usable,
      // refresh Cloudflare data quietly in the background and repaint.
      await refresh();
      void (async () => {
        try {
          await refreshSource();
        } catch {}
      })();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-paint when the source finishes its staged load (channels first, then EPG)
  // or after a background refresh — reads from the in-memory cache, no network.
  useEffect(() => subscribeSource(() => refresh(true)), [refresh]);

  // Live EPG download/parse progress for the on-screen status bar + ETA.
  useEffect(() => subscribeProgress(setEpgProgress), []);

  const channelById = useCallback((id: string) => channels.find((c) => c.id === id), [channels]);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      storage.setItem(FAV_KEY, next);
      return next;
    });
  }, []);

  const addRecent = useCallback((c: Channel) => {
    setLastChannelId(c.id);
    storage.setItem(LAST_CHANNEL_KEY, c.id);
    setRecent((prev) => {
      const next = [c, ...prev.filter((x) => x.id !== c.id)].slice(0, 15);
      storage.setItem(RECENT_KEY, next);
      return next;
    });
  }, []);

  const hasReminder = useCallback(
    (key: string) => reminders.some((r) => r.key === key),
    [reminders],
  );

  const addReminder = useCallback(
    async (program: Program, channel: Channel) => {
      const key = reminderKey(channel.id, program.start);
      if (reminders.some((r) => r.key === key)) return true;
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
        const next = [...prev, rem];
        storage.setItem(REM_KEY, next);
        return next;
      });
      return true;
    },
    [reminders],
  );

  const removeReminder = useCallback(
    async (key: string) => {
      const rem = reminders.find((r) => r.key === key);
      if (rem) await cancelReminder(rem.notificationId);
      setReminders((prev) => {
        const next = prev.filter((r) => r.key !== key);
        storage.setItem(REM_KEY, next);
        return next;
      });
    },
    [reminders],
  );

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

  const value: Store = {
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
    epgProgress,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
