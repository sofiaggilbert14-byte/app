import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";

/**
 * User-owned tab metadata layered over immutable provider/system group identities.
 * Provider group names remain the lookup key used by Guide filtering; rename only
 * changes the display label so playlist refreshes cannot destroy user organization.
 */
export type GuideGroupTabPreferences = {
  aliases: Record<string, string>;
  hidden: string[];
  order: string[];
};

const KEY = "gs_guide_group_tab_preferences_v1";
const MAX_GROUPS = 256;
const MAX_NAME = 48;
const RESERVED_ID = "All";
let cached: GuideGroupTabPreferences = { aliases: {}, hidden: [], order: [] };
let loaded = false;
let loading: Promise<GuideGroupTabPreferences> | null = null;
let writeChain: Promise<void> = Promise.resolve();
const listeners = new Set<(value: GuideGroupTabPreferences) => void>();

function cleanName(value: unknown, max = 96): string {
  return String(value || "").replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = cleanName(item);
    if (!id || id === RESERVED_ID || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_GROUPS) break;
  }
  return out;
}

function normalize(raw: unknown): GuideGroupTabPreferences {
  const value = raw && typeof raw === "object" ? raw as Partial<GuideGroupTabPreferences> : {};
  const aliases: Record<string, string> = {};
  if (value.aliases && typeof value.aliases === "object") {
    let count = 0;
    for (const [rawId, rawLabel] of Object.entries(value.aliases)) {
      const id = cleanName(rawId);
      const label = cleanName(rawLabel, MAX_NAME);
      if (!id || id === RESERVED_ID || !label || label === id) continue;
      aliases[id] = label;
      count += 1;
      if (count >= MAX_GROUPS) break;
    }
  }
  return { aliases, hidden: cleanList(value.hidden), order: cleanList(value.order) };
}

async function load(): Promise<GuideGroupTabPreferences> {
  if (loaded) return cached;
  if (loading) return loading;
  loading = storage.getItem<GuideGroupTabPreferences>(KEY, cached).then((raw) => {
    cached = normalize(raw);
    loaded = true;
    return cached;
  });
  try { return await loading; } finally { loading = null; }
}

function commit(next: GuideGroupTabPreferences) {
  cached = normalize(next);
  loaded = true;
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
  const snapshot = cached;
  writeChain = writeChain
    .then(() => storage.setItem(KEY, snapshot))
    .catch(() => undefined);
}

export function getGuideGroupDisplayName(groupId: string, aliases = cached.aliases): string {
  return aliases[groupId] || groupId;
}

export function applyGuideGroupOrder(ids: string[], order: string[]): string[] {
  if (ids.length <= 1 || !order.length) return ids;
  const rank = new Map<string, number>();
  order.forEach((id, index) => rank.set(id, index));
  return ids
    .map((id, index) => ({ id, index, rank: rank.get(id) }))
    .sort((a, b) => {
      if (a.id === RESERVED_ID) return -1;
      if (b.id === RESERVED_ID) return 1;
      if (a.rank != null && b.rank != null) return a.rank - b.rank;
      if (a.rank != null) return -1;
      if (b.rank != null) return 1;
      return a.index - b.index;
    })
    .map((row) => row.id);
}

export function useGuideGroupTabPreferences() {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: GuideGroupTabPreferences) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);

  const rename = useCallback((groupId: string, rawLabel: string) => {
    const id = cleanName(groupId);
    const label = cleanName(rawLabel, MAX_NAME);
    if (!id || id === RESERVED_ID || !label) return false;
    const aliases = { ...cached.aliases };
    if (label === id) delete aliases[id]; else aliases[id] = label;
    commit({ ...cached, aliases });
    return true;
  }, []);

  const setVisible = useCallback((groupId: string, visible: boolean) => {
    const id = cleanName(groupId);
    if (!id || id === RESERVED_ID) return;
    const hidden = new Set(cached.hidden);
    if (visible) hidden.delete(id); else hidden.add(id);
    commit({ ...cached, hidden: Array.from(hidden) });
  }, []);

  const move = useCallback((groupId: string, direction: -1 | 1, allIds: string[]) => {
    const id = cleanName(groupId);
    if (!id || id === RESERVED_ID) return;
    const visibleIds = allIds.filter((item) => item && item !== RESERVED_ID);
    const current = applyGuideGroupOrder(visibleIds, cached.order);
    const from = current.indexOf(id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(current.length - 1, from + direction));
    if (to === from) return;
    const next = current.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit({ ...cached, order: next });
  }, []);

  const reset = useCallback(() => commit({ aliases: {}, hidden: [], order: [] }), []);
  const hiddenSet = useMemo(() => new Set(value.hidden), [value.hidden]);
  return { ...value, hiddenSet, rename, setVisible, move, reset };
}
