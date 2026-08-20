import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { useGuideGroupTabPreferences } from "@/src/core/guideGroupTabPersistence";

const PINNED_KEY = "gs_guide_pinned_groups";
const HIDE_PREVIEW_KEY = "gs_guide_hide_preview";
const MUTE_PREVIEW_KEY = "gs_guide_mute_preview";
const START_GROUP_KEY = "gs_guide_start_group";
const PROVIDER_GROUPS_KEY = "gs_phase9_show_provider_groups";
const HIDDEN_GROUPS_KEY = "gs_phase9_hidden_guide_groups";

const DEFAULT_PINNED = ["Favorites", "Sports", "News"];
export const GUIDE_START_LAST_USED = "__last_used__";

type Snapshot = {
  pinnedGroups: string[];
  hidePreview: boolean;
  mutePreview: boolean;
  startGroup: string;
  showProviderGroups: boolean;
  hiddenGroups: string[];
};

let cached: Snapshot = {
  pinnedGroups: DEFAULT_PINNED,
  hidePreview: false,
  mutePreview: true,
  startGroup: GUIDE_START_LAST_USED,
  showProviderGroups: false,
  hiddenGroups: [],
};
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: Snapshot) => void>();

function emit() {
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
}

function sanitizeStartGroup(value: unknown): string {
  if (typeof value !== "string") return GUIDE_START_LAST_USED;
  const trimmed = value.trim();
  return trimmed || GUIDE_START_LAST_USED;
}

function sanitizeGroupList(raw: unknown, max = 48): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = typeof item === "string" ? item.trim().slice(0, 80) : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeHiddenGroups(raw: unknown): string[] {
  return sanitizeGroupList(raw).filter((name) => name !== "All");
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const [pinned, hidePreview, mutePreview, startGroup, showProviderGroups, hiddenGroups] = await Promise.all([
      storage.getItem<string[]>(PINNED_KEY, DEFAULT_PINNED),
      storage.getItem<boolean>(HIDE_PREVIEW_KEY, false),
      storage.getItem<boolean>(MUTE_PREVIEW_KEY, true),
      storage.getItem<string>(START_GROUP_KEY, GUIDE_START_LAST_USED),
      storage.getItem<boolean>(PROVIDER_GROUPS_KEY, false),
      storage.getItem<string[]>(HIDDEN_GROUPS_KEY, []),
    ]);
    const next: Snapshot = {
      pinnedGroups: sanitizeGroupList(pinned, 24).length ? sanitizeGroupList(pinned, 24) : DEFAULT_PINNED,
      hidePreview: !!hidePreview,
      mutePreview: mutePreview !== false,
      startGroup: sanitizeStartGroup(startGroup),
      showProviderGroups: showProviderGroups === true,
      hiddenGroups: sanitizeHiddenGroups(hiddenGroups),
    };
    // A user setting changed while hydration was running owns the newer state.
    // Never let an older multi-key disk snapshot overwrite that action.
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    cached = next;
    loaded = true;
    return cached;
  })();
  try { return await loadPromise; } finally { loadPromise = null; }
}

function commit(next: Snapshot) {
  mutationEpoch += 1;
  cached = next;
  loaded = true;
  emit();
}

export async function setPinnedGroups(next: string[]): Promise<void> {
  const pinnedGroups = sanitizeGroupList(next, 24);
  commit({ ...cached, pinnedGroups });
  await storage.setItem(PINNED_KEY, pinnedGroups);
}

export async function setHideGuidePreview(next: boolean): Promise<void> {
  commit({ ...cached, hidePreview: next });
  await storage.setItem(HIDE_PREVIEW_KEY, next);
}

export async function setMuteGuidePreview(next: boolean): Promise<void> {
  commit({ ...cached, mutePreview: next });
  await storage.setItem(MUTE_PREVIEW_KEY, next);
}

export async function setGuideStartGroup(next: string): Promise<void> {
  const startGroup = sanitizeStartGroup(next);
  commit({ ...cached, startGroup });
  await storage.setItem(START_GROUP_KEY, startGroup);
}

export async function setShowProviderGuideGroups(next: boolean): Promise<void> {
  commit({ ...cached, showProviderGroups: next });
  await storage.setItem(PROVIDER_GROUPS_KEY, next);
}

export async function setHiddenGuideGroups(next: string[]): Promise<void> {
  const hiddenGroups = sanitizeHiddenGroups(next);
  commit({ ...cached, hiddenGroups });
  await storage.setItem(HIDDEN_GROUPS_KEY, hiddenGroups);
}

export function useGuideUiPreferences(): Snapshot & {
  setPinnedGroups: (next: string[]) => void;
  setHidePreview: (next: boolean) => void;
  setMutePreview: (next: boolean) => void;
  setStartGroup: (next: string) => void;
  setShowProviderGroups: (next: boolean) => void;
  setHiddenGroups: (next: string[]) => void;
} {
  useGuideGroupTabPreferences();
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: Snapshot) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);

  return {
    ...value,
    setPinnedGroups: useCallback((next: string[]) => {
      const nextValue = sanitizeGroupList(next, 24);
      setValue((prev) => ({ ...prev, pinnedGroups: nextValue }));
      void setPinnedGroups(nextValue);
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
    setShowProviderGroups: useCallback((next: boolean) => {
      setValue((prev) => ({ ...prev, showProviderGroups: next }));
      void setShowProviderGuideGroups(next);
    }, []),
    setHiddenGroups: useCallback((next: string[]) => {
      const nextValue = sanitizeHiddenGroups(next);
      setValue((prev) => ({ ...prev, hiddenGroups: nextValue }));
      void setHiddenGuideGroups(nextValue);
    }, []),
  };
}
