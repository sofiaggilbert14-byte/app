import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlaybackBufferProfile = "low_latency" | "balanced" | "stable";
const KEY = "gs_playback_buffer_profile";
let value: PlaybackBufferProfile = "balanced";
let loaded = false;
let loadPromise: Promise<PlaybackBufferProfile> | null = null;
let mutationVersion = 0;
const listeners = new Set<(next: PlaybackBufferProfile) => void>();

function normalize(raw: unknown): PlaybackBufferProfile {
  return raw === "low_latency" || raw === "stable" ? raw : "balanced";
}

async function loadProfile(): Promise<PlaybackBufferProfile> {
  if (loaded) return value;
  if (loadPromise) return loadPromise;
  const versionAtStart = mutationVersion;
  loadPromise = storage.getItem<PlaybackBufferProfile>(KEY, "balanced")
    .then((stored) => {
      if (versionAtStart !== mutationVersion) return value;
      value = normalize(stored);
      loaded = true;
      return value;
    });
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function usePlaybackBufferProfile(): [PlaybackBufferProfile, (next: PlaybackBufferProfile) => void, boolean] {
  const [current, setCurrent] = useState(value);
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    let mounted = true;
    void loadProfile().then((stored) => {
      if (mounted) {
        setCurrent(stored);
        setReady(true);
      }
    });
    const listener = (next: PlaybackBufferProfile) => {
      if (!mounted) return;
      setCurrent(next);
      setReady(true);
    };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);
  return [current, useCallback((next: PlaybackBufferProfile) => {
    mutationVersion += 1;
    value = normalize(next);
    loaded = true;
    setCurrent(value);
    setReady(true);
    void storage.setItem(KEY, value);
    for (const listener of Array.from(listeners)) {
      if (!listeners.has(listener)) continue;
      try {
        listener(value);
      } catch {
        // A settings observer must never interrupt player control.
      }
    }
  }, []), ready];
}
