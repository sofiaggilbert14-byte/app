import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlaybackBufferProfile = "low_latency" | "balanced" | "stable";
const KEY = "gs_playback_buffer_profile";
let value: PlaybackBufferProfile = "stable";
let loaded = false;
let loadPromise: Promise<PlaybackBufferProfile> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(next: PlaybackBufferProfile) => void>();

function normalize(raw: unknown): PlaybackBufferProfile {
  return raw === "low_latency" || raw === "stable" ? raw : "balanced";
}

async function loadProfile(): Promise<PlaybackBufferProfile> {
  if (loaded) return value;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = storage.getItem<PlaybackBufferProfile>(KEY, "stable")
    .then((stored) => {
      const next = normalize(stored);
      if (loaded || loadEpoch !== mutationEpoch) return value;
      value = next;
      loaded = true;
      return value;
    });
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function usePlaybackBufferProfile(): [PlaybackBufferProfile, (next: PlaybackBufferProfile) => void] {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    let mounted = true;
    void loadProfile().then((stored) => {
      if (mounted) setCurrent(stored);
    });
    const listener = (next: PlaybackBufferProfile) => mounted && setCurrent(next);
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);
  return [current, useCallback((next: PlaybackBufferProfile) => {
    mutationEpoch += 1;
    value = normalize(next);
    loaded = true;
    setCurrent(value);
    void storage.setItem(KEY, value);
    for (const listener of Array.from(listeners)) {
      if (!listeners.has(listener)) continue;
      try {
        listener(value);
      } catch {
        // A settings observer must never interrupt player control.
      }
    }
  }, [])];
}
