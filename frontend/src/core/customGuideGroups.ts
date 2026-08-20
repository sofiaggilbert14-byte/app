import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";
import {
  nativeCreateCustomGroup,
  nativeCustomizationAvailable,
  nativeDeleteCustomGroup,
  nativeMoveCustomGroup,
  nativeRenameCustomGroup,
  nativeSetCustomGroupMembership,
} from "@/src/nativeCustomization";
import {
  LEGACY_GROUPS_KEY,
  loadNativeCustomizationWithMigration,
  refreshNativeCustomizationSnapshot,
} from "@/src/core/customizationPersistence";

export type CustomGuideGroup = {
  id: string;
  name: string;
  channelIds: string[];
};

const MAX_GROUPS = 32;
const MAX_CHANNELS_PER_GROUP = 10000;
const RESERVED = new Set([
  "all", "favorites", "recently watched", "hd only", "24/7", "unmatched epg", "failed streams",
  "sports", "news", "movies", "kids", "music", "entertainment", "documentary", "lifestyle", "local",
  "international", "miscellaneous",
]);

let cached: CustomGuideGroup[] = [];
let loaded = false;
let loadPromise: Promise<CustomGuideGroup[]> | null = null;
let mutationEpoch = 0;
let webWriteActive = false;
let webPendingWrite: CustomGuideGroup[] | null = null;
const listeners = new Set<(value: CustomGuideGroup[]) => void>();

function cleanName(raw: string): string {
  return String(raw || "").replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
}

function sanitize(raw: unknown): CustomGuideGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomGuideGroup[] = [];
  const names = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Partial<CustomGuideGroup>;
    const name = cleanName(String(value.name || ""));
    const key = name.toLowerCase();
    if (!name || RESERVED.has(key) || names.has(key)) continue;
    const id = String(value.id || `cg_${Date.now()}_${out.length}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    if (!id) continue;
    const seen = new Set<string>();
    const ids: string[] = [];
    if (Array.isArray(value.channelIds)) {
      for (const rawId of value.channelIds) {
        const channelId = String(rawId || "").trim().slice(0, 180);
        if (!channelId || seen.has(channelId)) continue;
        seen.add(channelId);
        ids.push(channelId);
        if (ids.length >= MAX_CHANNELS_PER_GROUP) break;
      }
    }
    names.add(key);
    out.push({ id, name, channelIds: ids });
    if (out.length >= MAX_GROUPS) break;
  }
  return out;
}

function emit() {
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
}

function commit(next: CustomGuideGroup[]) {
  mutationEpoch += 1;
  cached = sanitize(next);
  loaded = true;
  emit();
  if (!nativeCustomizationAvailable) {
    webPendingWrite = cached;
    void flushWebWrites();
  }
}

async function flushWebWrites() {
  if (nativeCustomizationAvailable || webWriteActive) return;
  webWriteActive = true;
  try {
    while (webPendingWrite) {
      const snapshot = webPendingWrite;
      webPendingWrite = null;
      await storage.setItem(LEGACY_GROUPS_KEY, snapshot);
    }
  } finally {
    webWriteActive = false;
    if (webPendingWrite) void flushWebWrites();
  }
}

async function load(): Promise<CustomGuideGroup[]> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const next = nativeCustomizationAvailable
      ? sanitize((await loadNativeCustomizationWithMigration()).groups)
      : sanitize(await storage.getItem<CustomGuideGroup[]>(LEGACY_GROUPS_KEY, []));
    // A newer user mutation owns the live snapshot. An initial native/storage
    // read that began before that mutation must never reinstall stale groups.
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    cached = next;
    loaded = true;
    return cached;
  })();
  try { return await loadPromise; }
  finally { loadPromise = null; }
}

async function reloadNativeAfterFailure() {
  if (!nativeCustomizationAvailable) return;
  try {
    const native = await refreshNativeCustomizationSnapshot();
    commit(native.groups);
  } catch {}
}

export function useCustomGuideGroups() {
  const [groups, setGroups] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((value) => { if (mounted) setGroups(value); });
    const listener = (value: CustomGuideGroup[]) => { if (mounted) setGroups(value); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);

  const createGroup = useCallback((rawName: string) => {
    const name = cleanName(rawName);
    const key = name.toLowerCase();
    if (!name || RESERVED.has(key) || cached.some((group) => group.name.toLowerCase() === key) || cached.length >= MAX_GROUPS) return false;
    const id = `cg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    commit([...cached, { id, name, channelIds: [] }]);
    if (nativeCustomizationAvailable) {
      void nativeCreateCustomGroup(id, name).catch(() => void reloadNativeAfterFailure());
    }
    return true;
  }, []);

  const renameGroup = useCallback((id: string, rawName: string) => {
    const name = cleanName(rawName);
    const key = name.toLowerCase();
    if (!name || RESERVED.has(key) || cached.some((group) => group.id !== id && group.name.toLowerCase() === key)) return false;
    commit(cached.map((group) => group.id === id ? { ...group, name } : group));
    if (nativeCustomizationAvailable) {
      void nativeRenameCustomGroup(id, name).catch(() => void reloadNativeAfterFailure());
    }
    return true;
  }, []);

  const deleteGroup = useCallback((id: string) => {
    if (!cached.some((group) => group.id === id)) return;
    commit(cached.filter((group) => group.id !== id));
    if (nativeCustomizationAvailable) {
      void nativeDeleteCustomGroup(id).catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  const moveGroup = useCallback((id: string, direction: -1 | 1) => {
    const from = cached.findIndex((group) => group.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(cached.length - 1, from + direction));
    if (to === from) return;
    const next = cached.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
    if (nativeCustomizationAvailable) {
      void nativeMoveCustomGroup(id, direction).catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  const setChannelMembership = useCallback((groupId: string, channelId: string, include: boolean) => {
    const group = cached.find((item) => item.id === groupId);
    if (!group || !channelId) return;
    const exists = group.channelIds.includes(channelId);
    if (exists === include) return;
    let channelIds: string[];
    if (include) {
      if (group.channelIds.length >= MAX_CHANNELS_PER_GROUP) return;
      channelIds = [...group.channelIds, channelId];
    } else {
      channelIds = group.channelIds.filter((id) => id !== channelId);
    }
    commit(cached.map((item) => item.id === groupId ? { ...item, channelIds } : item));
    if (nativeCustomizationAvailable) {
      void nativeSetCustomGroupMembership(groupId, channelId, include).catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  const byName = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>();
    for (const group of groups) map.set(group.name, new Set(group.channelIds));
    return map;
  }, [groups]);

  return { groups, byName, createGroup, renameGroup, deleteGroup, moveGroup, setChannelMembership };
}
