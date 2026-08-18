import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";

export type CustomGuideGroup = {
  id: string;
  name: string;
  channelIds: string[];
};

const KEY = "gs_phase9_custom_guide_groups_v1";
const MAX_GROUPS = 32;
const MAX_CHANNELS_PER_GROUP = 10000;
const RESERVED = new Set([
  "all", "favorites", "recently watched", "hd only", "24/7", "unmatched epg", "failed streams",
  "sports", "news", "movies", "kids", "music", "entertainment", "documentary", "lifestyle", "local",
  "international", "miscellaneous",
]);

let cached: CustomGuideGroup[] = [];
let loaded = false;
let writeActive = false;
let pendingWrite: CustomGuideGroup[] | null = null;
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

async function flushWrites() {
  if (writeActive) return;
  writeActive = true;
  try {
    while (pendingWrite) {
      const snapshot = pendingWrite;
      pendingWrite = null;
      await storage.setItem(KEY, snapshot);
    }
  } finally {
    writeActive = false;
  }
}

function commit(next: CustomGuideGroup[]) {
  cached = sanitize(next);
  loaded = true;
  emit();
  pendingWrite = cached;
  void flushWrites();
}

async function load() {
  if (loaded) return cached;
  cached = sanitize(await storage.getItem<CustomGuideGroup[]>(KEY, []));
  loaded = true;
  return cached;
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
    commit([...cached, { id: `cg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name, channelIds: [] }]);
    return true;
  }, []);

  const renameGroup = useCallback((id: string, rawName: string) => {
    const name = cleanName(rawName);
    const key = name.toLowerCase();
    if (!name || RESERVED.has(key) || cached.some((group) => group.id !== id && group.name.toLowerCase() === key)) return false;
    commit(cached.map((group) => group.id === id ? { ...group, name } : group));
    return true;
  }, []);

  const deleteGroup = useCallback((id: string) => commit(cached.filter((group) => group.id !== id)), []);

  const moveGroup = useCallback((id: string, direction: -1 | 1) => {
    const from = cached.findIndex((group) => group.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(cached.length - 1, from + direction));
    if (to === from) return;
    const next = cached.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
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
  }, []);

  const byName = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>();
    for (const group of groups) map.set(group.name, new Set(group.channelIds));
    return map;
  }, [groups]);

  return { groups, byName, createGroup, renameGroup, deleteGroup, moveGroup, setChannelMembership };
}
