import { useCallback, useEffect, useState } from "react";
import { normalizePreferredAudioLanguage } from "@/src/core/preferredAudioLanguages";
import { storage } from "@/src/utils/storage";

const LANG_KEY = "gs_audio_default_lang";
const CHANNEL_KEY = "gs_audio_tracks_by_channel";
const MAX_CHANNELS = 128;
type TrackId = string | number;
type Snapshot = { defaultLanguage: string; byChannel: Record<string, TrackId> };
let cached: Snapshot = { defaultLanguage: "", byChannel: {} };
const listeners = new Set<(snapshot: Snapshot) => void>();

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
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      storage.getItem<string>(LANG_KEY, ""),
      storage.getItem<Record<string, TrackId>>(CHANNEL_KEY, {}),
    ]).then(([defaultLanguage, byChannel]) => {
      cached = {
        defaultLanguage: normalizePreferredAudioLanguage(defaultLanguage),
        byChannel: byChannel && typeof byChannel === "object" ? byChannel : {},
      };
      if (mounted) setSnapshot(cached);
      emit();
    });
    const listener = (next: Snapshot) => mounted && setSnapshot(next);
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);
  return {
    ...snapshot,
    setDefaultLanguage: useCallback((raw: string) => {
      cached = { ...cached, defaultLanguage: normalizePreferredAudioLanguage(raw) };
      emit();
      void storage.setItem(LANG_KEY, cached.defaultLanguage);
    }, []),
    rememberChannelTrack: useCallback((channelId: string, trackId: TrackId) => {
      if (!channelId || trackId == null) return;
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
