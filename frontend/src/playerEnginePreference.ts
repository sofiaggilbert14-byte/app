import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlayerEnginePreference = "default" | "media3" | "vlc";

const PLAYER_ENGINE_KEY = "gs_player_engine_preference";
let cachedPreference: PlayerEnginePreference = "default";
let loaded = false;
let loadPromise: Promise<PlayerEnginePreference> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: PlayerEnginePreference) => void>();

async function loadPreference(): Promise<PlayerEnginePreference> {
  if (loaded) return cachedPreference;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;

  loadPromise = (async () => {
    const stored = await storage.getItem<PlayerEnginePreference>(PLAYER_ENGINE_KEY, "default");
    const next = stored === "vlc" || stored === "media3" ? stored : "default";
    if (loaded || loadEpoch !== mutationEpoch) return cachedPreference;
    cachedPreference = next;
    loaded = true;
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
  cachedPreference = value;
  loaded = true;
  await storage.setItem(PLAYER_ENGINE_KEY, value);
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try {
      listener(value);
    } catch {}
  }
}

export function usePlayerEnginePreference(): [PlayerEnginePreference, (value: PlayerEnginePreference) => void] {
  const [value, setValue] = useState<PlayerEnginePreference>(cachedPreference);

  useEffect(() => {
    let mounted = true;
    void loadPreference().then((next) => {
      if (mounted) setValue(next);
    });
    const listener = (next: PlayerEnginePreference) => {
      if (mounted) setValue(next);
    };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback((next: PlayerEnginePreference) => {
    setValue(next);
    void setPlayerEnginePreference(next);
  }, []);

  return [value, update];
}