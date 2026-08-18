import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

const PINNED_KEY = "gs_guide_pinned_groups";
const HIDE_PREVIEW_KEY = "gs_guide_hide_preview";
const MUTE_PREVIEW_KEY = "gs_guide_mute_preview";
const START_GROUP_KEY = "gs_guide_start_group";

const DEFAULT_PINNED = ["Favorites", "Sports", "News"];
export const GUIDE_START_LAST_USED = "__last_used__";

type Snapshot = {
  pinnedGroups: string[];
  hidePreview: boolean;
  mutePreview: boolean;
  startGroup: string;
};

let cached: Snapshot = {
  pinnedGroups: DEFAULT_PINNED,
  hidePreview: false,
  mutePreview: true,
  startGroup: GUIDE_START_LAST_USED,
};
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
const listeners = new Set<(value: Snapshot) => void>();

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener(cached);
    } catch {}
  }
}

function sanitizeStartGroup(value: unknown): string {
  if (typeof value !== "string") return GUIDE_START_LAST_USED;
  const trimmed = value.trim();
  return trimmed || GUIDE_START_LAST_USED;
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [pinned, hidePreview, mutePreview, startGroup] = await Promise.all([
      storage.getItem<string[]>(PINNED_KEY, DEFAULT_PINNED),
      storage.getItem<boolean>(HIDE_PREVIEW_KEY, false),
      storage.getItem<boolean>(MUTE_PREVIEW_KEY, true),
      storage.getItem<string>(START_GROUP_KEY, GUIDE_START_LAST_USED),
    ]);
    cached = {
      pinnedGroups: Array.isArray(pinned) ? pinned.filter((item) => typeof item === "string").slice(0, 24) : DEFAULT_PINNED,
      hidePreview: !!hidePreview,
      mutePreview: mutePreview !== false,
      startGroup: sanitizeStartGroup(startGroup),
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
  cached = { ...cached, pinnedGroups: next.slice(0, 24) };
  loaded = true;
  emit();
  await storage.setItem(PINNED_KEY, cached.pinnedGroups);
}

export async function setHideGuidePreview(next: boolean): Promise<void> {
  cached = { ...cached, hidePreview: next };
  loaded = true;
  emit();
  await storage.setItem(HIDE_PREVIEW_KEY, next);
}

export async function setMuteGuidePreview(next: boolean): Promise<void> {
  cached = { ...cached, mutePreview: next };
  loaded = true;
  emit();
  await storage.setItem(MUTE_PREVIEW_KEY, next);
}

export async function setGuideStartGroup(next: string): Promise<void> {
  const startGroup = sanitizeStartGroup(next);
  cached = { ...cached, startGroup };
  loaded = true;
  emit();
  await storage.setItem(START_GROUP_KEY, startGroup);
}

export function useGuideUiPreferences(): Snapshot & {
  setPinnedGroups: (next: string[]) => void;
  setHidePreview: (next: boolean) => void;
  setMutePreview: (next: boolean) => void;
  setStartGroup: (next: string) => void;
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
    setPinnedGroups: useCallback((next: string[]) => {
      setValue((prev) => ({ ...prev, pinnedGroups: next.slice(0, 24) }));
      void setPinnedGroups(next);
    }, []),
    setHidePreview: useCallback((next: boolean) => {
      setValue((prev) => ({ ...prev, hidePreview: next }));
      void setHideGuidePreview(next);
    }, []),
    setMutePreview: useCallback((next: boolean) => {
      setValue((prev) => ({ ...prev, mutePreview: next }));
      void setMuteGuidePreview(next);
    }, []),
    setStartGroup: useCallback((next: string) => {
      setValue((prev) => ({ ...prev, startGroup: sanitizeStartGroup(next) }));
      void setGuideStartGroup(next);
    }, []),
  };
}
