import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

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
  silentAudioFallback: true,
  vlcAudioOutput: "stereo",
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

function normalizeVideoDecoder(raw: unknown, legacyHardware = true): VideoDecoderMode {
  if (raw === "software") return "software";
  if (raw === "device") return "device";
  return legacyHardware ? "device" : "software";
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const [silent, vlcAudio, vlcHw, videoDecoder, media3Audio, media3Tunnel] = await Promise.all([
      storage.getItem<boolean>(SILENT_KEY, true),
      storage.getItem<VlcAudioOutput>(VLC_AUDIO_KEY, "stereo"),
      storage.getItem<boolean>(VLC_HW_KEY, true),
      storage.getItem<VideoDecoderMode | null>(VIDEO_DECODER_KEY, null),
      storage.getItem<Media3AudioMode>(MEDIA3_AUDIO_KEY, "device"),
      storage.getItem<boolean>(MEDIA3_TUNNEL_KEY, false),
    ]);
    const resolvedVideoDecoder = normalizeVideoDecoder(videoDecoder, vlcHw !== false);
    const next: Snapshot = {
      silentAudioFallback: silent !== false,
      vlcAudioOutput: normalizeVlcAudio(vlcAudio),
      vlcHardwareDecode: resolvedVideoDecoder === "device",
      videoDecoderMode: resolvedVideoDecoder,
      media3AudioMode: normalizeMedia3Audio(media3Audio),
      media3Tunneling: !!media3Tunnel,
    };
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    cached = next;
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
  setVideoDecoderMode: (next: VideoDecoderMode) => void;
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
      mutationEpoch += 1;
      cached = { ...cached, silentAudioFallback: next };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(SILENT_KEY, next);
    }, []),
    setVlcAudioOutput: useCallback((next: VlcAudioOutput) => {
      mutationEpoch += 1;
      cached = { ...cached, vlcAudioOutput: normalizeVlcAudio(next) };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(VLC_AUDIO_KEY, cached.vlcAudioOutput);
    }, []),
    setVlcHardwareDecode: useCallback((next: boolean) => {
      mutationEpoch += 1;
      const videoDecoderMode: VideoDecoderMode = next ? "device" : "software";
      cached = { ...cached, vlcHardwareDecode: next, videoDecoderMode };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(VLC_HW_KEY, next);
      void storage.setItem(VIDEO_DECODER_KEY, videoDecoderMode);
    }, []),
    setVideoDecoderMode: useCallback((next: VideoDecoderMode) => {
      mutationEpoch += 1;
      const videoDecoderMode = normalizeVideoDecoder(next);
      const vlcHardwareDecode = videoDecoderMode === "device";
      cached = { ...cached, videoDecoderMode, vlcHardwareDecode };
      loaded = true;
      setValue(cached);
      emit();
      void storage.setItem(VIDEO_DECODER_KEY, videoDecoderMode);
      void storage.setItem(VLC_HW_KEY, vlcHardwareDecode);
    }, []),
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
