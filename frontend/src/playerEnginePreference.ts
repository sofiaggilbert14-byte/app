import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlayerEnginePreference = "default" | "media3" | "vlc";

const PLAYER_ENGINE_KEY = "gs_player_engine_preference";
// VLC is the product default on native builds. An explicitly stored Media3 or
// VLC choice still wins; the legacy "default" value follows the current
// product default without rewriting user storage.
let cachedPreference: PlayerEnginePreference = "vlc";
let loaded = false;
let loadPromise: Promise<PlayerEnginePreference> | null = null;
let mutationVersion = 0;
const listeners = new Set<(value: PlayerEnginePreference) => void>();

async function loadPreference(): Promise<PlayerEnginePreference> {
  if (loaded) return cachedPreference;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const versionAtStart = mutationVersion;
    const stored = await storage.getItem<PlayerEnginePreference>(PLAYER_ENGINE_KEY, "vlc");
    if (versionAtStart !== mutationVersion) return cachedPreference;
    cachedPreference = stored === "media3" ? "media3" : "vlc";
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
  mutationVersion += 1;
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

export function usePlayerEnginePreference(): [PlayerEnginePreference, (value: PlayerEnginePreference) => void, boolean] {
  const [value, setValue] = useState<PlayerEnginePreference>(cachedPreference);
  const [ready, setReady] = useState(loaded);

  useEffect(() => {
    let mounted = true;
    void loadPreference().then((next) => {
      if (mounted) {
        setValue(next);
        setReady(true);
      }
    });
    const listener = (next: PlayerEnginePreference) => {
      if (mounted) {
        setValue(next);
        setReady(true);
      }
    };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback((next: PlayerEnginePreference) => {
    setValue(next);
    setReady(true);
    void setPlayerEnginePreference(next);
  }, []);

  return [value, update, ready];
}
