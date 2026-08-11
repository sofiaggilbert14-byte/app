import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type VlcAudioOutput = "auto" | "stereo" | "passthrough";
export type Media3AudioMode = "auto" | "device" | "ffmpeg";

type Snapshot = {
  silentAudioFallback: boolean;
  vlcAudioOutput: VlcAudioOutput;
  vlcHardwareDecode: boolean;
  media3AudioMode: Media3AudioMode;
  media3Tunneling: boolean;
};

const SILENT_KEY = "gs_silent_audio_fallback";
const VLC_AUDIO_KEY = "gs_vlc_audio_output";
const VLC_HW_KEY = "gs_vlc_hardware_decode";
const MEDIA3_AUDIO_KEY = "gs_media3_audio_mode";
const MEDIA3_TUNNEL_KEY = "gs_media3_tunneling";

let cached: Snapshot = {
  silentAudioFallback: true,
  vlcAudioOutput: "auto",
  vlcHardwareDecode: true,
  media3AudioMode: "auto",
  media3Tunneling: false,
};
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
const listeners = new Set<(next: Snapshot) => void>();

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener(cached);
    } catch {
      // Settings observers must never interrupt playback.
    }
  }
}

function normalizeVlcAudio(raw: unknown): VlcAudioOutput {
  return raw === "stereo" || raw === "passthrough" ? raw : "auto";
}

function normalizeMedia3Audio(raw: unknown): Media3AudioMode {
  return raw === "device" || raw === "ffmpeg" ? raw : "auto";
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [silent, vlcAudio, vlcHw, media3Audio, media3Tunnel] = await Promise.all([
      storage.getItem<boolean>(SILENT_KEY, true),
      storage.getItem<VlcAudioOutput>(VLC_AUDIO_KEY, "auto"),
      storage.getItem<boolean>(VLC_HW_KEY, true),
      storage.getItem<Media3AudioMode>(MEDIA3_AUDIO_KEY, "auto"),
      storage.getItem<boolean>(MEDIA3_TUNNEL_KEY, false),
    ]);
    cached = {
      silentAudioFallback: silent !== false,
      vlcAudioOutput: normalizeVlcAudio(vlcAudio),
      vlcHardwareDecode: vlcHw !== false,
      media3AudioMode: normalizeMedia3Audio(media3Audio),
      media3Tunneling: !!media3Tunnel,
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

export function getSilentAudioFallbackEnabled(): boolean {
  return cached.silentAudioFallback;
}

export function getVlcAudioOutput(): VlcAudioOutput {
  return cached.vlcAudioOutput;
}

export function getVlcHardwareDecode(): boolean {
  return cached.vlcHardwareDecode;
}

export function getMedia3AudioMode(): Media3AudioMode {
  return cached.media3AudioMode;
}

export function getMedia3Tunneling(): boolean {
  return cached.media3Tunneling;
}

export function usePlayerCompatibilityPreferences(): Snapshot & {
  setSilentAudioFallback: (next: boolean) => void;
  setVlcAudioOutput: (next: VlcAudioOutput) => void;
  setVlcHardwareDecode: (next: boolean) => void;
  setMedia3AudioMode: (next: Media3AudioMode) => void;
  setMedia3Tunneling: (next: boolean) => void;
} {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => {
      if (mounted) setValue(next);
    });
    const listener = (next: Snapshot) => {
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
    setSilentAudioFallback: useCallback((next: boolean) => {
      cached = { ...cached, silentAudioFallback: next };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(SILENT_KEY, next);
    }, []),
    setVlcAudioOutput: useCallback((next: VlcAudioOutput) => {
      cached = { ...cached, vlcAudioOutput: normalizeVlcAudio(next) };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(VLC_AUDIO_KEY, cached.vlcAudioOutput);
    }, []),
    setVlcHardwareDecode: useCallback((next: boolean) => {
      cached = { ...cached, vlcHardwareDecode: next };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(VLC_HW_KEY, next);
    }, []),
    setMedia3AudioMode: useCallback((next: Media3AudioMode) => {
      cached = { ...cached, media3AudioMode: normalizeMedia3Audio(next) };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(MEDIA3_AUDIO_KEY, cached.media3AudioMode);
    }, []),
    setMedia3Tunneling: useCallback((next: boolean) => {
      cached = { ...cached, media3Tunneling: next };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(MEDIA3_TUNNEL_KEY, next);
    }, []),
  };
}
