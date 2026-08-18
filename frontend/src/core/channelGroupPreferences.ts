import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";

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
const MAX_CHANNEL_IDS_PER_GROUP = 25_000;

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

function normalize(raw: unknown): ChannelGroupPreferences {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<ChannelGroupPreferences>;
  const seenNames = new Set<string>();
  const customGroups: CustomChannelGroup[] = [];
  for (const rawGroup of Array.isArray(value.customGroups) ? value.customGroups : []) {
    if (!rawGroup || typeof rawGroup !== "object") continue;
    const group = rawGroup as Partial<CustomChannelGroup>;
    const name = cleanName(group.name);
    if (!name) continue;
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    const ids: string[] = [];
    const seenIds = new Set<string>();
    for (const rawId of Array.isArray(group.channelIds) ? group.channelIds : []) {
      const id = String(rawId || "").trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      ids.push(id);
      if (ids.length >= MAX_CHANNEL_IDS_PER_GROUP) break;
    }
    customGroups.push({
      id: String(group.id || `custom-${nameKey.replace(/[^a-z0-9]+/g, "-")}-${customGroups.length}`).slice(0, 80),
      name,
      visible: group.visible !== false,
      channelIds: ids,
    });
    if (customGroups.length >= MAX_CUSTOM_GROUPS) break;
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
  }
}

function publish(next: ChannelGroupPreferences): void {
  snapshot = normalize(next);
  loaded = true;
  pendingWrite = snapshot;
  void flushWrites();
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try { listener(snapshot); } catch {}
  }
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
    publish({ ...snapshot, showProviderGroups });
  }, []);

  const setBuiltInVisible = useCallback((name: string, visible: boolean) => {
    const clean = cleanName(name);
    if (!clean) return;
    const hidden = new Set(snapshot.hiddenBuiltInGroups);
    if (visible) hidden.delete(clean);
    else hidden.add(clean);
    publish({ ...snapshot, hiddenBuiltInGroups: Array.from(hidden) });
  }, []);

  const addCustomGroup = useCallback((name: string) => {
    const clean = cleanName(name);
    if (!clean) return;
    if (snapshot.customGroups.some((group) => group.name.toLowerCase() === clean.toLowerCase())) return;
    if (snapshot.customGroups.length >= MAX_CUSTOM_GROUPS) return;
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    publish({ ...snapshot, customGroups: [...snapshot.customGroups, { id, name: clean, visible: true, channelIds: [] }] });
  }, []);

  const renameCustomGroup = useCallback((id: string, name: string) => {
    const clean = cleanName(name);
    if (!clean) return;
    if (snapshot.customGroups.some((group) => group.id !== id && group.name.toLowerCase() === clean.toLowerCase())) return;
    publish({ ...snapshot, customGroups: snapshot.customGroups.map((group) => group.id === id ? { ...group, name: clean } : group) });
  }, []);

  const removeCustomGroup = useCallback((id: string) => {
    publish({ ...snapshot, customGroups: snapshot.customGroups.filter((group) => group.id !== id) });
  }, []);

  const setCustomGroupVisible = useCallback((id: string, visible: boolean) => {
    publish({ ...snapshot, customGroups: snapshot.customGroups.map((group) => group.id === id ? { ...group, visible } : group) });
  }, []);

  const setChannelInCustomGroup = useCallback((groupId: string, channelId: string, included: boolean) => {
    const cleanId = String(channelId || "").trim();
    if (!cleanId) return;
    publish({
      ...snapshot,
      customGroups: snapshot.customGroups.map((group) => {
        if (group.id !== groupId) return group;
        const exists = group.channelIds.includes(cleanId);
        if (included === exists) return group;
        if (included) {
          if (group.channelIds.length >= MAX_CHANNEL_IDS_PER_GROUP) return group;
          return { ...group, channelIds: [...group.channelIds, cleanId] };
        }
        return { ...group, channelIds: group.channelIds.filter((id) => id !== cleanId) };
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
