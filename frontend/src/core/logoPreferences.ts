import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type LogoPriority = "playlist" | "epg";

const KEY = "gs_channel_logo_priority";
const DEFAULT_PRIORITY: LogoPriority = "playlist";
let cached: LogoPriority = DEFAULT_PRIORITY;
let loaded = false;
let loadPromise: Promise<LogoPriority> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: LogoPriority) => void>();

async function load(): Promise<LogoPriority> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const value = await storage.getItem<LogoPriority>(KEY, DEFAULT_PRIORITY);
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    cached = value === "epg" ? "epg" : "playlist";
    loaded = true;
    return cached;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export async function getLogoPriority(): Promise<LogoPriority> {
  return load();
}

export async function setLogoPriority(value: LogoPriority): Promise<void> {
  mutationEpoch += 1;
  cached = value === "epg" ? "epg" : "playlist";
  loaded = true;
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
  await storage.setItem(KEY, cached);
}

export function useLogoPriority(): [LogoPriority, (value: LogoPriority) => void] {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: LogoPriority) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);
  return [value, useCallback((next: LogoPriority) => {
    setValue(next);
    void setLogoPriority(next);
  }, [])];
}
