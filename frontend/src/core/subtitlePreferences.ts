import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type SubtitleSize = "small" | "normal" | "large";
export type SubtitleBg = "none" | "dim" | "solid";

type Snapshot = {
  defaultLanguage: string;
  size: SubtitleSize;
  background: SubtitleBg;
};

const LANG_KEY = "gs_subtitle_default_lang";
const SIZE_KEY = "gs_subtitle_size";
const BG_KEY = "gs_subtitle_bg";

let cached: Snapshot = { defaultLanguage: "", size: "normal", background: "dim" };
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
let mutationVersion = 0;
const listeners = new Set<(value: Snapshot) => void>();

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener(cached);
    } catch {}
  }
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const versionAtStart = mutationVersion;
    const [lang, size, bg] = await Promise.all([
      storage.getItem<string>(LANG_KEY, ""),
      storage.getItem<SubtitleSize>(SIZE_KEY, "normal"),
      storage.getItem<SubtitleBg>(BG_KEY, "dim"),
    ]);
    if (versionAtStart !== mutationVersion) return cached;
    cached = {
      defaultLanguage: typeof lang === "string" ? lang.slice(0, 16) : "",
      size: size === "small" || size === "large" ? size : "normal",
      background: bg === "none" || bg === "solid" ? bg : "dim",
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

export function useSubtitlePreferences() {
  const [value, setValue] = useState(cached);
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => {
      if (mounted) {
        setValue(next);
        setReady(true);
      }
    });
    const listener = (next: Snapshot) => {
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

  return {
    ...value,
    ready,
    setDefaultLanguage: useCallback((next: string) => {
      mutationVersion += 1;
      const defaultLanguage = String(next || "").slice(0, 16);
      const snap = { ...cached, defaultLanguage };
      cached = snap;
      loaded = true;
      setValue(snap);
      setReady(true);
      emit();
      void storage.setItem(LANG_KEY, defaultLanguage);
    }, []),
    setSize: useCallback((size: SubtitleSize) => {
      mutationVersion += 1;
      const snap = { ...cached, size };
      cached = snap;
      loaded = true;
      setValue(snap);
      setReady(true);
      emit();
      void storage.setItem(SIZE_KEY, size);
    }, []),
    setBackground: useCallback((background: SubtitleBg) => {
      mutationVersion += 1;
      const snap = { ...cached, background };
      cached = snap;
      loaded = true;
      setValue(snap);
      setReady(true);
      emit();
      void storage.setItem(BG_KEY, background);
    }, []),
  };
}

/** Pick default subtitle track id from a list, or undefined for Off. */
export function pickDefaultSubtitleTrack<T extends { id: string | number; name?: string; language?: string | null }>(
  tracks: T[],
  defaultLanguage: string,
): T | undefined {
  const lang = defaultLanguage.trim().toLowerCase();
  if (!lang || !tracks.length) return undefined;
  return (
    tracks.find((track) => String(track.language || "").toLowerCase().startsWith(lang)) ||
    tracks.find((track) => String(track.name || "").toLowerCase().includes(lang)) ||
    undefined
  );
}
