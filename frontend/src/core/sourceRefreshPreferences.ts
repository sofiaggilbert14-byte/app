import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type SourceRefreshIntervalHours = 0 | 2 | 4 | 6 | 12 | 24;

export type SourceRefreshPreferences = {
  playlistHours: SourceRefreshIntervalHours;
  epgHours: SourceRefreshIntervalHours;
};

const PLAYLIST_KEY = "gs_playlist_refresh_interval_hours";
const EPG_KEY = "gs_epg_refresh_interval_hours";

const DEFAULTS: SourceRefreshPreferences = {
  playlistHours: 24,
  epgHours: 6,
};

let cached: SourceRefreshPreferences = DEFAULTS;
let loaded = false;
let loadPromise: Promise<SourceRefreshPreferences> | null = null;
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

async function load(): Promise<SourceRefreshPreferences> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [playlistHours, epgHours] = await Promise.all([
      storage.getItem<SourceRefreshIntervalHours>(PLAYLIST_KEY, DEFAULTS.playlistHours),
      storage.getItem<SourceRefreshIntervalHours>(EPG_KEY, DEFAULTS.epgHours),
    ]);
    cached = {
      playlistHours: normalize(playlistHours, DEFAULTS.playlistHours),
      epgHours: normalize(epgHours, DEFAULTS.epgHours),
    };
    loaded = true;
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
  const next = normalize(value, DEFAULTS.playlistHours);
  cached = { ...cached, playlistHours: next };
  loaded = true;
  emit();
  await storage.setItem(PLAYLIST_KEY, next);
}

export async function setEpgRefreshInterval(value: SourceRefreshIntervalHours): Promise<void> {
  const next = normalize(value, DEFAULTS.epgHours);
  cached = { ...cached, epgHours: next };
  loaded = true;
  emit();
  await storage.setItem(EPG_KEY, next);
}

export function useSourceRefreshPreferences(): SourceRefreshPreferences & {
  setPlaylistHours: (value: SourceRefreshIntervalHours) => void;
  setEpgHours: (value: SourceRefreshIntervalHours) => void;
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
  };
}
