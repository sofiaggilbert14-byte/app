import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";
import {
  applyGuideGroupOrder,
  cleanGuideGroupName,
  getGuideGroupDisplayName,
  getGuideGroupTabPreferencesSnapshot,
  GUIDE_GROUP_RESERVED_ID,
  GUIDE_GROUP_TAB_NAME_MAX,
  installGuideGroupTabPreferences,
  normalizeGuideGroupTabPreferences,
  resolveGuideGroupIdentity,
  type GuideGroupTabPreferences,
} from "./guideGroupTabModel";

export type { GuideGroupTabPreferences } from "./guideGroupTabModel";
export {
  applyGuideGroupOrder,
  getGuideGroupDisplayName,
  getGuideGroupTabPreferencesSnapshot,
  resolveGuideGroupIdentity,
} from "./guideGroupTabModel";

const KEY = "gs_guide_group_tab_preferences_v1";
let loaded = false;
let loading: Promise<GuideGroupTabPreferences> | null = null;
let writeChain: Promise<void> = Promise.resolve();
const listeners = new Set<(value: GuideGroupTabPreferences) => void>();

async function load(): Promise<GuideGroupTabPreferences> {
  if (loaded) return getGuideGroupTabPreferencesSnapshot();
  if (loading) return loading;
  const fallback = getGuideGroupTabPreferencesSnapshot();
  loading = storage.getItem<GuideGroupTabPreferences>(KEY, fallback).then((raw) => {
    const next = installGuideGroupTabPreferences(normalizeGuideGroupTabPreferences(raw));
    loaded = true;
    return next;
  });
  try { return await loading; } finally { loading = null; }
}

function commit(next: GuideGroupTabPreferences) {
  const installed = installGuideGroupTabPreferences(next);
  loaded = true;
  for (const listener of Array.from(listeners)) {
    try { listener(installed); } catch {}
  }
  writeChain = writeChain
    .then(async () => { await storage.setItem(KEY, installed); })
    .catch(() => undefined);
}

export function useGuideGroupTabPreferences() {
  const [value, setValue] = useState(getGuideGroupTabPreferencesSnapshot());
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: GuideGroupTabPreferences) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);

  const rename = useCallback((groupId: string, rawLabel: string) => {
    const id = cleanGuideGroupName(groupId);
    const label = cleanGuideGroupName(rawLabel, GUIDE_GROUP_TAB_NAME_MAX);
    if (!id || id === GUIDE_GROUP_RESERVED_ID || !label || label === GUIDE_GROUP_RESERVED_ID) return false;
    const current = getGuideGroupTabPreferencesSnapshot();
    const duplicate = Object.entries(current.aliases).some(
      ([otherId, otherLabel]) => otherId !== id && otherLabel.toLowerCase() === label.toLowerCase(),
    );
    if (duplicate) return false;
    const aliases = { ...current.aliases };
    if (label === id) delete aliases[id]; else aliases[id] = label;
    commit({ ...current, aliases });
    return true;
  }, []);

  const setVisible = useCallback((groupId: string, visible: boolean) => {
    const id = cleanGuideGroupName(groupId);
    if (!id || id === GUIDE_GROUP_RESERVED_ID) return;
    const current = getGuideGroupTabPreferencesSnapshot();
    const hidden = new Set(current.hidden);
    if (visible) hidden.delete(id); else hidden.add(id);
    commit({ ...current, hidden: Array.from(hidden) });
  }, []);

  const move = useCallback((groupId: string, direction: -1 | 1, allIds: string[]) => {
    const id = cleanGuideGroupName(groupId);
    if (!id || id === GUIDE_GROUP_RESERVED_ID) return;
    const currentPrefs = getGuideGroupTabPreferencesSnapshot();
    const visibleIds = allIds.filter((item) => item && item !== GUIDE_GROUP_RESERVED_ID);
    const current = applyGuideGroupOrder(visibleIds, currentPrefs.order);
    const from = current.indexOf(id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(current.length - 1, from + direction));
    if (to === from) return;
    const next = current.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit({ ...currentPrefs, order: next });
  }, []);

  const reset = useCallback(() => commit({ aliases: {}, hidden: [], order: [] }), []);
  const hiddenSet = useMemo(() => new Set(value.hidden), [value.hidden]);
  return { ...value, hiddenSet, rename, setVisible, move, reset };
}
