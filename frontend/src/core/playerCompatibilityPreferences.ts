import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

// Legacy types remain so the existing Settings screen does not require a broad
// UI rewrite on this safety branch. The new live-TV core is Media3-only.
export type VlcAudioOutput = "auto" | "stereo" | "passthrough";
export type Media3AudioMode = "auto" | "device" | "ffmpeg";
export type VideoDecoderMode = "device" | "software";

type Snapshot = {
  silentAudioFallback: boolean;
  vlcAudioOutput: VlcAudioOutput;
  vlcHardwareDecode: boolean;
  videoDecoderMode: VideoDecoderMode;
  media3AudioMode: Media3AudioMode;
  media3Tunneling: boolean;
};

const SILENT_KEY = "gs_silent_audio_fallback";
const VLC_AUDIO_KEY = "gs_vlc_audio_output";
const VLC_HW_KEY = "gs_vlc_hardware_decode";
const VIDEO_DECODER_KEY = "gs_video_decoder_mode";
const MEDIA3_AUDIO_KEY = "gs_media3_audio_mode";
const MEDIA3_TUNNEL_KEY = "gs_media3_tunneling";

let cached: Snapshot = {
  silentAudioFallback: false,
  vlcAudioOutput: "auto",
  vlcHardwareDecode: true,
  videoDecoderMode: "device",
  media3AudioMode: "device",
  media3Tunneling: false,
};
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(next: Snapshot) => void>();

function emit() {
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
}

function normalizeMedia3Audio(raw: unknown): Media3AudioMode {
  return raw === "device" || raw === "ffmpeg" ? raw : "auto";
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const [media3Audio, media3Tunnel] = await Promise.all([
      storage.getItem<Media3AudioMode>(MEDIA3_AUDIO_KEY, "device"),
      storage.getItem<boolean>(MEDIA3_TUNNEL_KEY, false),
    ]);
    const next: Snapshot = {
      // Legacy engine-swap controls are deliberately inert in the rebuilt core.
      silentAudioFallback: false,
      vlcAudioOutput: "auto",
      vlcHardwareDecode: true,
      videoDecoderMode: "device",
      media3AudioMode: normalizeMedia3Audio(media3Audio),
      media3Tunneling: !!media3Tunnel,
    };
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    cached = next;
    loaded = true;
    // Migrate old persisted values so future screens cannot resurrect the
    // dual-engine/software-video policy on this branch.
    void Promise.all([
      storage.setItem(SILENT_KEY, false),
      storage.setItem(VLC_AUDIO_KEY, "auto"),
      storage.setItem(VLC_HW_KEY, true),
      storage.setItem(VIDEO_DECODER_KEY, "device"),
    ]);
    return cached;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function getSilentAudioFallbackEnabled(): boolean { return false; }
export function getVlcAudioOutput(): VlcAudioOutput { return "auto"; }
export function getVlcHardwareDecode(): boolean { return true; }
export function getMedia3AudioMode(): Media3AudioMode { return cached.media3AudioMode; }
export function getMedia3Tunneling(): boolean { return cached.media3Tunneling; }

export function usePlayerCompatibilityPreferences(): Snapshot & {
  setSilentAudioFallback: (next: boolean) => void;
  setVlcAudioOutput: (next: VlcAudioOutput) => void;
  setVlcHardwareDecode: (next: boolean) => void;
  setVideoDecoderMode: (next: VideoDecoderMode) => void;
  setMedia3AudioMode: (next: Media3AudioMode) => void;
  setMedia3Tunneling: (next: boolean) => void;
} {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: Snapshot) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const keepMedia3Core = useCallback(() => {
    mutationEpoch += 1;
    cached = {
      ...cached,
      silentAudioFallback: false,
      vlcAudioOutput: "auto",
      vlcHardwareDecode: true,
      videoDecoderMode: "device",
    };
    loaded = true;
    setValue(cached);
    emit();
    void Promise.all([
      storage.setItem(SILENT_KEY, false),
      storage.setItem(VLC_AUDIO_KEY, "auto"),
      storage.setItem(VLC_HW_KEY, true),
      storage.setItem(VIDEO_DECODER_KEY, "device"),
    ]);
  }, []);

  return {
    ...value,
    setSilentAudioFallback: useCallback((_next: boolean) => keepMedia3Core(), [keepMedia3Core]),
    setVlcAudioOutput: useCallback((_next: VlcAudioOutput) => keepMedia3Core(), [keepMedia3Core]),
    setVlcHardwareDecode: useCallback((_next: boolean) => keepMedia3Core(), [keepMedia3Core]),
    setVideoDecoderMode: useCallback((_next: VideoDecoderMode) => keepMedia3Core(), [keepMedia3Core]),
    setMedia3AudioMode: useCallback((next: Media3AudioMode) => {
      mutationEpoch += 1;
      cached = { ...cached, media3AudioMode: normalizeMedia3Audio(next) };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(MEDIA3_AUDIO_KEY, cached.media3AudioMode);
    }, []),
    setMedia3Tunneling: useCallback((next: boolean) => {
      mutationEpoch += 1;
      cached = { ...cached, media3Tunneling: next };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(MEDIA3_TUNNEL_KEY, next);
    }, []),
  };
}
