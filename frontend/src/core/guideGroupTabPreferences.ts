import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";

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
let reverseAliases: Record<string, string> = {};
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
  const usedLabels = new Set<string>();
  if (value.aliases && typeof value.aliases === "object") {
    let count = 0;
    for (const [rawId, rawLabel] of Object.entries(value.aliases)) {
      const id = cleanName(rawId);
      const label = cleanName(rawLabel, MAX_NAME);
      const labelKey = label.toLowerCase();
      if (!id || id === RESERVED_ID || !label || label === id || label === RESERVED_ID || usedLabels.has(labelKey)) continue;
      aliases[id] = label;
      usedLabels.add(labelKey);
      count += 1;
      if (count >= MAX_GROUPS) break;
    }
  }
  return { aliases, hidden: cleanList(value.hidden), order: cleanList(value.order) };
}

function install(next: GuideGroupTabPreferences) {
  cached = next;
  const reverse: Record<string, string> = {};
  for (const [id, label] of Object.entries(next.aliases)) reverse[label] = id;
  reverseAliases = reverse;
}

async function load(): Promise<GuideGroupTabPreferences> {
  if (loaded) return cached;
  if (loading) return loading;
  loading = storage.getItem<GuideGroupTabPreferences>(KEY, cached).then((raw) => {
    install(normalize(raw));
    loaded = true;
    return cached;
  });
  try { return await loading; } finally { loading = null; }
}

function commit(next: GuideGroupTabPreferences) {
  install(normalize(next));
  loaded = true;
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
  const snapshot = cached;
  writeChain = writeChain
    .then(async () => { await storage.setItem(KEY, snapshot); })
    .catch(() => undefined);
}

export function getGuideGroupTabPreferencesSnapshot(): GuideGroupTabPreferences {
  return cached;
}

export function getGuideGroupDisplayName(groupId: string, aliases = cached.aliases): string {
  return aliases[groupId] || groupId;
}

/** O(1) hot-path lookup; Guide calls this while filtering thousands of channels. */
export function resolveGuideGroupIdentity(displayName: string): string {
  return reverseAliases[displayName] || displayName;
}

export function applyGuideGroupOrder(ids: string[], order: string[]): string[] {
  if (ids.length <= 1 || !order.length) return ids;
  const rank = new Map<string, number>();
  order.forEach((id, index) => rank.set(id, index));
  const original = new Map(ids.map((id, index) => [id, index]));
  return ids.slice().sort((a, b) => {
    if (a === RESERVED_ID) return -1;
    if (b === RESERVED_ID) return 1;
    const ar = rank.get(a);
    const br = rank.get(b);
    if (ar != null && br != null) return ar - br;
    return (original.get(a) ?? 0) - (original.get(b) ?? 0);
  });
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
    if (!id || id === RESERVED_ID || !label || label === RESERVED_ID) return false;
    const duplicate = Object.entries(cached.aliases).some(
      ([otherId, otherLabel]) => otherId !== id && otherLabel.toLowerCase() === label.toLowerCase(),
    );
    if (duplicate) return false;
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
