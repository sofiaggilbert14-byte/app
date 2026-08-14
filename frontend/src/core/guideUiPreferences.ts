import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type GuideGroupLayout = "horizontal" | "vertical";

const PINNED_KEY = "gs_guide_pinned_groups";
const LAYOUT_KEY = "gs_guide_group_layout";
const HIDE_PREVIEW_KEY = "gs_guide_hide_preview";
const MUTE_PREVIEW_KEY = "gs_guide_mute_preview";

const DEFAULT_PINNED = ["Favorites", "Sports", "News"];

type Snapshot = {
  pinnedGroups: string[];
  groupLayout: GuideGroupLayout;
  hidePreview: boolean;
  mutePreview: boolean;
};

let cached: Snapshot = {
  pinnedGroups: DEFAULT_PINNED,
  groupLayout: "horizontal",
  hidePreview: false,
  mutePreview: true,
};
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
    const pinned = await storage.getItem<string[]>(PINNED_KEY, DEFAULT_PINNED);
    const layout = await storage.getItem<GuideGroupLayout>(LAYOUT_KEY, "horizontal");
    const hidePreview = await storage.getItem<boolean>(HIDE_PREVIEW_KEY, false);
    const mutePreview = await storage.getItem<boolean>(MUTE_PREVIEW_KEY, true);
    if (versionAtStart !== mutationVersion) return cached;
    cached = {
      pinnedGroups: Array.isArray(pinned) ? pinned.filter((item) => typeof item === "string").slice(0, 24) : DEFAULT_PINNED,
      groupLayout: layout === "vertical" ? "vertical" : "horizontal",
      hidePreview: !!hidePreview,
      mutePreview: mutePreview !== false,
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

export async function setPinnedGroups(next: string[]): Promise<void> {
  mutationVersion += 1;
  cached = { ...cached, pinnedGroups: next.slice(0, 24) };
  loaded = true;
  emit();
  await storage.setItem(PINNED_KEY, cached.pinnedGroups);
}

export async function setGuideGroupLayout(next: GuideGroupLayout): Promise<void> {
  mutationVersion += 1;
  cached = { ...cached, groupLayout: next };
  loaded = true;
  emit();
  await storage.setItem(LAYOUT_KEY, next);
}

export async function setHideGuidePreview(next: boolean): Promise<void> {
  mutationVersion += 1;
  cached = { ...cached, hidePreview: next };
  loaded = true;
  emit();
  await storage.setItem(HIDE_PREVIEW_KEY, next);
}

export async function setMuteGuidePreview(next: boolean): Promise<void> {
  mutationVersion += 1;
  cached = { ...cached, mutePreview: next };
  loaded = true;
  emit();
  await storage.setItem(MUTE_PREVIEW_KEY, next);
}

export function useGuideUiPreferences(): Snapshot & {
  ready: boolean;
  setPinnedGroups: (next: string[]) => void;
  setGroupLayout: (next: GuideGroupLayout) => void;
  setHidePreview: (next: boolean) => void;
  setMutePreview: (next: boolean) => void;
} {
  const [value, setValue] = useState(cached);
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => {
      if (mounted) { setValue(next); setReady(true); }
    });
    const listener = (next: Snapshot) => {
      if (mounted) { setValue(next); setReady(true); }
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
    setPinnedGroups: useCallback((next: string[]) => {
      setValue((prev) => ({ ...prev, pinnedGroups: next.slice(0, 24) }));
      void setPinnedGroups(next);
    }, []),
    setGroupLayout: useCallback((next: GuideGroupLayout) => {
      setValue((prev) => ({ ...prev, groupLayout: next }));
      void setGuideGroupLayout(next);
    }, []),
    setHidePreview: useCallback((next: boolean) => {
      setValue((prev) => ({ ...prev, hidePreview: next }));
      void setHideGuidePreview(next);
    }, []),
    setMutePreview: useCallback((next: boolean) => {
      setValue((prev) => ({ ...prev, mutePreview: next }));
      void setMuteGuidePreview(next);
    }, []),
  };
}
