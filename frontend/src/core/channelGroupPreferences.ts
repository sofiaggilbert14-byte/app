import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";
import { DEFAULT_CHANNEL_FOLDERS } from "@/src/core/channelFolderClassifier";
import { SMART_GROUPS } from "@/src/core/guideGroups";

export type CustomChannelGroup = {
  id: string;
  name: string;
  visible: boolean;
  channelIds: string[];
};

export type ChannelGroupPreferences = {
  showProviderGroups: boolean;
  hiddenBuiltInGroups: string[];
  customGroups: CustomChannelGroup[];
};

const KEY = "phase9_channel_group_preferences_v1";
const MAX_CUSTOM_GROUPS = 48;
const MAX_CHANNEL_IDS_PER_GROUP = 10_000;
const MAX_TOTAL_CUSTOM_MEMBERSHIPS = 50_000;
const RESERVED_NAMES = new Set<string>([
  "all",
  "favorites",
  "recently watched",
  ...SMART_GROUPS.map((name) => name.toLowerCase()),
  ...DEFAULT_CHANNEL_FOLDERS.map((name) => name.toLowerCase()),
]);

const DEFAULTS: ChannelGroupPreferences = {
  // Provider group-title values remain classification hints by default; they do
  // not become dozens of visible navigation tabs unless the user opts in.
  showProviderGroups: false,
  hiddenBuiltInGroups: [],
  customGroups: [],
};

let snapshot: ChannelGroupPreferences = DEFAULTS;
let loaded = false;
let loadPromise: Promise<ChannelGroupPreferences> | null = null;
const listeners = new Set<(value: ChannelGroupPreferences) => void>();
let writeActive = false;
let pendingWrite: ChannelGroupPreferences | null = null;

function cleanName(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 48);
}

function isReservedName(name: string): boolean {
  return RESERVED_NAMES.has(name.toLowerCase());
}

function normalize(raw: unknown): ChannelGroupPreferences {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<ChannelGroupPreferences>;
  const seenNames = new Set<string>();
  const customGroups: CustomChannelGroup[] = [];
  let totalMemberships = 0;
  for (const rawGroup of Array.isArray(value.customGroups) ? value.customGroups : []) {
    if (!rawGroup || typeof rawGroup !== "object") continue;
    const group = rawGroup as Partial<CustomChannelGroup>;
    const name = cleanName(group.name);
    if (!name || isReservedName(name)) continue;
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    const ids: string[] = [];
    const seenIds = new Set<string>();
    for (const rawId of Array.isArray(group.channelIds) ? group.channelIds : []) {
      if (totalMemberships >= MAX_TOTAL_CUSTOM_MEMBERSHIPS) break;
      const id = String(rawId || "").trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      ids.push(id);
      totalMemberships += 1;
      if (ids.length >= MAX_CHANNEL_IDS_PER_GROUP) break;
    }
    customGroups.push({
      id: String(group.id || `custom-${nameKey.replace(/[^a-z0-9]+/g, "-")}-${customGroups.length}`).slice(0, 80),
      name,
      visible: group.visible !== false,
      channelIds: ids,
    });
    if (customGroups.length >= MAX_CUSTOM_GROUPS || totalMemberships >= MAX_TOTAL_CUSTOM_MEMBERSHIPS) break;
  }
  const hiddenBuiltInGroups = Array.from(new Set(
    (Array.isArray(value.hiddenBuiltInGroups) ? value.hiddenBuiltInGroups : [])
      .map(cleanName)
      .filter(Boolean),
  )).slice(0, 64);
  return {
    showProviderGroups: !!value.showProviderGroups,
    hiddenBuiltInGroups,
    customGroups,
  };
}

async function load(): Promise<ChannelGroupPreferences> {
  if (loaded) return snapshot;
  if (loadPromise) return loadPromise;
  loadPromise = storage.getItem<ChannelGroupPreferences>(KEY, DEFAULTS).then((value) => {
    snapshot = normalize(value);
    loaded = true;
    return snapshot;
  });
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function flushWrites(): Promise<void> {
  if (writeActive) return;
  writeActive = true;
  try {
    while (pendingWrite) {
      const value = pendingWrite;
      pendingWrite = null;
      await storage.setItem(KEY, value);
    }
  } finally {
    writeActive = false;
    if (pendingWrite) void flushWrites();
  }
}

/** UI mutation paths already enforce bounds. Avoid re-walking up to 50k mapping
 * IDs on every remote click; full sanitization is only needed when disk data is loaded. */
function publish(next: ChannelGroupPreferences): void {
  if (next === snapshot) return;
  snapshot = next;
  loaded = true;
  pendingWrite = snapshot;
  void flushWrites();
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try { listener(snapshot); } catch {}
  }
}

function totalMemberships(): number {
  let count = 0;
  for (const group of snapshot.customGroups) count += group.channelIds.length;
  return count;
}

export function getChannelGroupPreferences(): ChannelGroupPreferences {
  return snapshot;
}

export function useChannelGroupPreferences() {
  const [value, setValue] = useState(snapshot);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => mounted && setValue(next));
    const listener = (next: ChannelGroupPreferences) => mounted && setValue(next);
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const setShowProviderGroups = useCallback((showProviderGroups: boolean) => {
    if (snapshot.showProviderGroups === showProviderGroups) return;
    publish({ ...snapshot, showProviderGroups });
  }, []);

  const setBuiltInVisible = useCallback((name: string, visible: boolean) => {
    const clean = cleanName(name);
    if (!clean) return;
    const hidden = new Set(snapshot.hiddenBuiltInGroups);
    const alreadyVisible = !hidden.has(clean);
    if (alreadyVisible === visible) return;
    if (visible) hidden.delete(clean);
    else hidden.add(clean);
    publish({ ...snapshot, hiddenBuiltInGroups: Array.from(hidden) });
  }, []);

  const addCustomGroup = useCallback((name: string) => {
    const clean = cleanName(name);
    if (!clean || isReservedName(clean)) return;
    if (snapshot.customGroups.some((group) => group.name.toLowerCase() === clean.toLowerCase())) return;
    if (snapshot.customGroups.length >= MAX_CUSTOM_GROUPS) return;
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    publish({ ...snapshot, customGroups: [...snapshot.customGroups, { id, name: clean, visible: true, channelIds: [] }] });
  }, []);

  const renameCustomGroup = useCallback((id: string, name: string) => {
    const clean = cleanName(name);
    if (!clean || isReservedName(clean)) return;
    if (snapshot.customGroups.some((group) => group.id !== id && group.name.toLowerCase() === clean.toLowerCase())) return;
    const current = snapshot.customGroups.find((group) => group.id === id);
    if (!current || current.name === clean) return;
    publish({ ...snapshot, customGroups: snapshot.customGroups.map((group) => group.id === id ? { ...group, name: clean } : group) });
  }, []);

  const removeCustomGroup = useCallback((id: string) => {
    if (!snapshot.customGroups.some((group) => group.id === id)) return;
    publish({ ...snapshot, customGroups: snapshot.customGroups.filter((group) => group.id !== id) });
  }, []);

  const setCustomGroupVisible = useCallback((id: string, visible: boolean) => {
    const current = snapshot.customGroups.find((group) => group.id === id);
    if (!current || current.visible === visible) return;
    publish({ ...snapshot, customGroups: snapshot.customGroups.map((group) => group.id === id ? { ...group, visible } : group) });
  }, []);

  const setChannelInCustomGroup = useCallback((groupId: string, channelId: string, included: boolean) => {
    const cleanId = String(channelId || "").trim();
    if (!cleanId) return;
    const target = snapshot.customGroups.find((group) => group.id === groupId);
    if (!target) return;
    const exists = target.channelIds.includes(cleanId);
    if (included === exists) return;
    if (included && (target.channelIds.length >= MAX_CHANNEL_IDS_PER_GROUP || totalMemberships() >= MAX_TOTAL_CUSTOM_MEMBERSHIPS)) return;
    publish({
      ...snapshot,
      customGroups: snapshot.customGroups.map((group) => {
        if (group.id !== groupId) return group;
        return included
          ? { ...group, channelIds: [...group.channelIds, cleanId] }
          : { ...group, channelIds: group.channelIds.filter((id) => id !== cleanId) };
      }),
    });
  }, []);

  const reorderCustomGroups = useCallback((from: number, to: number) => {
    if (from < 0 || to < 0 || from >= snapshot.customGroups.length || to >= snapshot.customGroups.length || from === to) return;
    const customGroups = snapshot.customGroups.slice();
    const [item] = customGroups.splice(from, 1);
    customGroups.splice(to, 0, item);
    publish({ ...snapshot, customGroups });
  }, []);

  return useMemo(() => ({
    ...value,
    setShowProviderGroups,
    setBuiltInVisible,
    addCustomGroup,
    renameCustomGroup,
    removeCustomGroup,
    setCustomGroupVisible,
    setChannelInCustomGroup,
    reorderCustomGroups,
  }), [
    addCustomGroup,
    removeCustomGroup,
    renameCustomGroup,
    reorderCustomGroups,
    setBuiltInVisible,
    setChannelInCustomGroup,
    setCustomGroupVisible,
    setShowProviderGroups,
    value,
  ]);
}
