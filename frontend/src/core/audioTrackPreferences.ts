import { useCallback, useEffect, useState } from "react";
import { normalizePreferredAudioLanguage } from "@/src/core/preferredAudioLanguages";
import { storage } from "@/src/utils/storage";

const LANG_KEY = "gs_audio_default_lang";
const CHANNEL_KEY = "gs_audio_tracks_by_channel";
const MAX_CHANNELS = 128;
type TrackId = string | number;
type Snapshot = { defaultLanguage: string; byChannel: Record<string, TrackId> };
let cached: Snapshot = { defaultLanguage: "", byChannel: {} };
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
let mutationVersion = 0;
const listeners = new Set<(snapshot: Snapshot) => void>();

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const versionAtStart = mutationVersion;
  loadPromise = Promise.all([
    storage.getItem<string>(LANG_KEY, ""),
    storage.getItem<Record<string, TrackId>>(CHANNEL_KEY, {}),
  ]).then(([defaultLanguage, byChannel]) => {
    if (versionAtStart !== mutationVersion) return cached;
    cached = {
      defaultLanguage: normalizePreferredAudioLanguage(defaultLanguage),
      byChannel: byChannel && typeof byChannel === "object" ? byChannel : {},
    };
    loaded = true;
    emit();
    return cached;
  });
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

function emit() {
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try {
      listener(cached);
    } catch {
      // A settings observer must never interrupt player control.
    }
  }
}

export function useAudioTrackPreferences() {
  const [snapshot, setSnapshot] = useState(cached);
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => {
      if (mounted) {
        setSnapshot(next);
        setReady(true);
      }
    });
    const listener = (next: Snapshot) => {
      if (!mounted) return;
      setSnapshot(next);
      setReady(true);
    };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);
  return {
    ...snapshot,
    ready,
    setDefaultLanguage: useCallback((raw: string) => {
      mutationVersion += 1;
      loaded = true;
      cached = { ...cached, defaultLanguage: normalizePreferredAudioLanguage(raw) };
      emit();
      void storage.setItem(LANG_KEY, cached.defaultLanguage);
    }, []),
    rememberChannelTrack: useCallback((channelId: string, trackId: TrackId) => {
      if (!channelId || trackId == null) return;
      mutationVersion += 1;
      loaded = true;
      const entries = Object.entries(cached.byChannel).filter(([id]) => id !== channelId);
      entries.push([channelId, trackId]);
      cached = { ...cached, byChannel: Object.fromEntries(entries.slice(-MAX_CHANNELS)) };
      emit();
      void storage.setItem(CHANNEL_KEY, cached.byChannel);
    }, []),
  };
}

export function getPreferredAudioLanguage(): string {
  return cached.defaultLanguage;
}

export function getRememberedChannelAudioTrack(channelId: string | null | undefined): TrackId | undefined {
  if (!channelId) return undefined;
  return cached.byChannel[channelId];
}

export function pickPreferredAudioTrack<T extends { id: TrackId; name?: string }>(
  tracks: T[],
  rememberedId: TrackId | undefined,
  defaultLanguage: string,
): T | undefined {
  const remembered = rememberedId == null
    ? undefined
    : tracks.find((track) => String(track.id) === String(rememberedId));
  if (remembered) return remembered;
  const lang = defaultLanguage.trim().toLowerCase();
  if (!lang) return undefined;
  return tracks.find((track) => String(track.name || "").toLowerCase().includes(lang));
}
