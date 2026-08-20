import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { syncNativeCustomEpgPolicy } from "@/src/core/customEpgPolicy";

export type SourceRefreshIntervalHours = 0 | 2 | 4 | 6 | 12 | 24;

export type SourceRefreshPreferences = {
  playlistHours: SourceRefreshIntervalHours;
  epgHours: SourceRefreshIntervalHours;
  epgPastDays: 1 | 3 | 7 | 14;
  updateEpgOnAppStart: boolean;
  updateEpgOnPlaylistChange: boolean;
};

const PLAYLIST_KEY = "gs_playlist_refresh_interval_hours";
const EPG_KEY = "gs_epg_refresh_interval_hours";
const EPG_PAST_DAYS_KEY = "gs_epg_past_days";
const EPG_ON_START_KEY = "gs_epg_update_on_app_start";
const EPG_ON_PLAYLIST_CHANGE_KEY = "gs_epg_update_on_playlist_change";

const DEFAULTS: SourceRefreshPreferences = {
  playlistHours: 24,
  epgHours: 6,
  epgPastDays: 7,
  // Cold start must prefer last-good cached channels/guide. A forced provider
  // refresh is opt-in only and may be enabled explicitly from EPG settings.
  updateEpgOnAppStart: false,
  updateEpgOnPlaylistChange: true,
};

let cached: SourceRefreshPreferences = DEFAULTS;
let loaded = false;
let loadPromise: Promise<SourceRefreshPreferences> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: SourceRefreshPreferences) => void>();

function normalize(value: unknown, fallback: SourceRefreshIntervalHours): SourceRefreshIntervalHours {
  return value === 0 || value === 2 || value === 4 || value === 6 || value === 12 || value === 24
    ? value
    : fallback;
}

function emit(): void {
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try {
      listener(cached);
    } catch {}
  }
}

function commit(next: SourceRefreshPreferences): void {
  mutationEpoch += 1;
  cached = next;
  loaded = true;
  emit();
}

async function load(): Promise<SourceRefreshPreferences> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const [playlistHours, epgHours, epgPastDays, updateEpgOnAppStart, updateEpgOnPlaylistChange] = await Promise.all([
      storage.getItem<SourceRefreshIntervalHours>(PLAYLIST_KEY, DEFAULTS.playlistHours),
      storage.getItem<SourceRefreshIntervalHours>(EPG_KEY, DEFAULTS.epgHours),
      storage.getItem<SourceRefreshPreferences["epgPastDays"]>(EPG_PAST_DAYS_KEY, DEFAULTS.epgPastDays),
      storage.getItem<boolean>(EPG_ON_START_KEY, DEFAULTS.updateEpgOnAppStart),
      storage.getItem<boolean>(EPG_ON_PLAYLIST_CHANGE_KEY, DEFAULTS.updateEpgOnPlaylistChange),
    ]);
    const next: SourceRefreshPreferences = {
      playlistHours: normalize(playlistHours, DEFAULTS.playlistHours),
      epgHours: normalize(epgHours, DEFAULTS.epgHours),
      epgPastDays: epgPastDays === 1 || epgPastDays === 3 || epgPastDays === 14 ? epgPastDays : 7,
      // Missing/legacy preference must stay OFF. Only an explicit true opts into
      // a cold-start force refresh.
      updateEpgOnAppStart: updateEpgOnAppStart === true,
      updateEpgOnPlaylistChange: updateEpgOnPlaylistChange !== false,
    };
    // A user edit made while the initial multi-key storage read was in flight
    // owns the newer scheduling policy. Never reinstall the stale snapshot.
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    cached = next;
    loaded = true;
    // Keep persisted UI policy and native source rows in lock-step at startup.
    void syncNativeCustomEpgPolicy(cached.epgHours, cached.epgPastDays);
    return cached;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export async function getSourceRefreshPreferences(): Promise<SourceRefreshPreferences> {
  return load();
}

export function refreshIntervalMs(hours: SourceRefreshIntervalHours): number | null {
  return hours === 0 ? null : hours * 60 * 60 * 1000;
}

export function isRefreshDue(
  lastRefreshAt: number | null | undefined,
  intervalHours: SourceRefreshIntervalHours,
  now = Date.now(),
): boolean {
  const interval = refreshIntervalMs(intervalHours);
  if (interval == null) return false;
  if (!lastRefreshAt || lastRefreshAt <= 0) return true;
  return now - lastRefreshAt >= interval;
}

export function nextRefreshAt(
  lastRefreshAt: number | null | undefined,
  intervalHours: SourceRefreshIntervalHours,
): number | null {
  const interval = refreshIntervalMs(intervalHours);
  if (interval == null || !lastRefreshAt || lastRefreshAt <= 0) return null;
  return lastRefreshAt + interval;
}

export async function setPlaylistRefreshInterval(value: SourceRefreshIntervalHours): Promise<void> {
  await load();
  const next = normalize(value, DEFAULTS.playlistHours);
  commit({ ...cached, playlistHours: next });
  await storage.setItem(PLAYLIST_KEY, next);
}

export async function setEpgRefreshInterval(value: SourceRefreshIntervalHours): Promise<void> {
  await load();
  const next = normalize(value, DEFAULTS.epgHours);
  commit({ ...cached, epgHours: next });
  await storage.setItem(EPG_KEY, next);
  await syncNativeCustomEpgPolicy(cached.epgHours, cached.epgPastDays);
}

export async function setEpgPastDays(value: SourceRefreshPreferences["epgPastDays"]): Promise<void> {
  await load();
  const next = value === 1 || value === 3 || value === 14 ? value : 7;
  commit({ ...cached, epgPastDays: next });
  await storage.setItem(EPG_PAST_DAYS_KEY, next);
  await syncNativeCustomEpgPolicy(cached.epgHours, cached.epgPastDays);
}

export async function setUpdateEpgOnAppStart(value: boolean): Promise<void> {
  await load();
  const next = value === true;
  commit({ ...cached, updateEpgOnAppStart: next });
  await storage.setItem(EPG_ON_START_KEY, next);
}

export async function setUpdateEpgOnPlaylistChange(value: boolean): Promise<void> {
  await load();
  const next = value === true;
  commit({ ...cached, updateEpgOnPlaylistChange: next });
  await storage.setItem(EPG_ON_PLAYLIST_CHANGE_KEY, next);
}

export function useSourceRefreshPreferences(): SourceRefreshPreferences & {
  setPlaylistHours: (value: SourceRefreshIntervalHours) => void;
  setEpgHours: (value: SourceRefreshIntervalHours) => void;
  setEpgPastDays: (value: SourceRefreshPreferences["epgPastDays"]) => void;
  setUpdateEpgOnAppStart: (value: boolean) => void;
  setUpdateEpgOnPlaylistChange: (value: boolean) => void;
} {
  const [value, setValue] = useState(cached);

  useEffect(() => {
    let mounted = true;
    void load().then((next) => {
      if (mounted) setValue(next);
    });
    const listener = (next: SourceRefreshPreferences) => {
      if (mounted) setValue(next);
    };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  return {
    ...value,
    setPlaylistHours: useCallback((next: SourceRefreshIntervalHours) => {
      setValue((prev) => ({ ...prev, playlistHours: next }));
      void setPlaylistRefreshInterval(next);
    }, []),
    setEpgHours: useCallback((next: SourceRefreshIntervalHours) => {
      setValue((prev) => ({ ...prev, epgHours: next }));
      void setEpgRefreshInterval(next);
    }, []),
    setEpgPastDays: useCallback((next: SourceRefreshPreferences["epgPastDays"]) => {
      setValue((prev) => ({ ...prev, epgPastDays: next }));
      void setEpgPastDays(next);
    }, []),
    setUpdateEpgOnAppStart: useCallback((next: boolean) => {
      setValue((prev) => ({ ...prev, updateEpgOnAppStart: next }));
      void setUpdateEpgOnAppStart(next);
    }, []),
    setUpdateEpgOnPlaylistChange: useCallback((next: boolean) => {
      setValue((prev) => ({ ...prev, updateEpgOnPlaylistChange: next }));
      void setUpdateEpgOnPlaylistChange(next);
    }, []),
  };
}
