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

function trimChannelTracks(raw: unknown): Record<string, TrackId> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const valid = Object.entries(raw as Record<string, unknown>)
    .filter(([channelId, trackId]) => !!channelId && (typeof trackId === "string" || typeof trackId === "number"))
    .slice(-MAX_CHANNELS) as [string, TrackId][];
  return Object.fromEntries(valid);
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
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      storage.getItem<string>(LANG_KEY, ""),
      storage.getItem<Record<string, TrackId>>(CHANNEL_KEY, {}),
    ]).then(([defaultLanguage, byChannel]) => {
      const trimmed = trimChannelTracks(byChannel);
      cached = {
        defaultLanguage: normalizePreferredAudioLanguage(defaultLanguage),
        byChannel: trimmed,
      };
      // Persist pruning once so stale/unbounded historical maps do not return on next boot.
      if (Object.keys(byChannel || {}).length !== Object.keys(trimmed).length) {
        void storage.setItem(CHANNEL_KEY, trimmed);
      }
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

export function pickPreferredAudioTrack<T extends { id: TrackId; name?: string; language?: string | null }>(
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
  return tracks.find((track) => {
    const language = String(track.language || "").toLowerCase();
    const name = String(track.name || "").toLowerCase();
    return language === lang || language.startsWith(`${lang}-`) || name.includes(lang);
  });
}
