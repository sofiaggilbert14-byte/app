import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { api, Channel, Program } from "@/src/api";
import { reminderKey } from "@/src/utils/time";
import {
  cancelReminder,
  requestNotificationPermission,
  scheduleProgramReminder,
} from "@/src/utils/notifications";

const FAV_KEY = "gs_favorites";
const RECENT_KEY = "gs_recent";
const REM_KEY = "gs_reminders";

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
  error: string | null;
  refresh: () => Promise<void>;
  channelById: (id: string) => Channel | undefined;

  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;

  recent: Channel[];
  addRecent: (c: Channel) => void;

  reminders: Reminder[];
  hasReminder: (key: string) => boolean;
  addReminder: (program: Program, channel: Channel) => Promise<boolean>;
  removeReminder: (key: string) => Promise<void>;

  activeProgram: ActiveProgram;
  openProgram: (program: Program, channel: Channel) => void;
  closeProgram: () => void;
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
  const [error, setError] = useState<string | null>(null);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<Channel[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [activeProgram, setActiveProgram] = useState<ActiveProgram>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.guide(24);
      setChannels(data.channels);
      setWindowStart(data.start);
      setWindowEnd(data.end);
    } catch (e: any) {
      setError(e?.message || "Failed to load guide");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setFavorites((await storage.getItem<string[]>(FAV_KEY, [])) || []);
      setRecent((await storage.getItem<Channel[]>(RECENT_KEY, [])) || []);
      setReminders((await storage.getItem<Reminder[]>(REM_KEY, [])) || []);
      requestNotificationPermission();
      refresh();
    })();
  }, [refresh]);

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
    setActiveProgram({ program, channel });
  }, []);
  const closeProgram = useCallback(() => setActiveProgram(null), []);

  const value: Store = {
    channels,
    windowStart,
    windowEnd,
    loading,
    error,
    refresh,
    channelById,
    favorites,
    isFavorite,
    toggleFavorite,
    recent,
    addRecent,
    reminders,
    hasReminder,
    addReminder,
    removeReminder,
    activeProgram,
    openProgram,
    closeProgram,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
