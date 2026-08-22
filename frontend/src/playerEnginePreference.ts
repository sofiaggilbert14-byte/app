import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

/**
 * Kept as a compatibility type for existing Settings code. The rebuilt live-TV
 * core is Media3-only; legacy `vlc` values are migrated to Media3 on read.
 */
export type PlayerEnginePreference = "default" | "media3" | "vlc";

const PLAYER_ENGINE_KEY = "gs_player_engine_preference";
let cachedPreference: PlayerEnginePreference = "media3";
let loaded = false;
let loadPromise: Promise<PlayerEnginePreference> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: PlayerEnginePreference) => void>();

function normalize(value: PlayerEnginePreference | null | undefined): PlayerEnginePreference {
  return value === "default" ? "default" : "media3";
}

async function loadPreference(): Promise<PlayerEnginePreference> {
  if (loaded) return cachedPreference;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const stored = await storage.getItem<PlayerEnginePreference>(PLAYER_ENGINE_KEY, "media3");
    const next = normalize(stored);
    if (loaded || loadEpoch !== mutationEpoch) return cachedPreference;
    cachedPreference = next;
    loaded = true;
    if (stored !== next) void storage.setItem(PLAYER_ENGINE_KEY, next);
    return cachedPreference;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export async function setPlayerEnginePreference(value: PlayerEnginePreference): Promise<void> {
  mutationEpoch += 1;
  cachedPreference = normalize(value);
  loaded = true;
  await storage.setItem(PLAYER_ENGINE_KEY, cachedPreference);
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try { listener(cachedPreference); } catch {}
  }
}

export function usePlayerEnginePreference(): [PlayerEnginePreference, (value: PlayerEnginePreference) => void] {
  const [value, setValue] = useState<PlayerEnginePreference>(cachedPreference);
  useEffect(() => {
    let mounted = true;
    void loadPreference().then((next) => { if (mounted) setValue(next); });
    const listener = (next: PlayerEnginePreference) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);
  const update = useCallback((next: PlayerEnginePreference) => {
    const normalized = normalize(next);
    setValue(normalized);
    void setPlayerEnginePreference(normalized);
  }, []);
  return [value, update];
}
