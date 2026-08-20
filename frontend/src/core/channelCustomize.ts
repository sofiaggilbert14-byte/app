import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import {
  nativeClearChannelOrder,
  nativeCustomizationAvailable,
  nativeMoveChannel,
  nativeSetChannelHidden,
  nativeSetChannelOrder,
  nativeSetCustomNumber,
} from "@/src/nativeCustomization";
import {
  LEGACY_HIDDEN_KEY,
  LEGACY_NUMBERS_KEY,
  LEGACY_ORDER_KEY,
  loadNativeCustomizationWithMigration,
  refreshNativeCustomizationSnapshot,
} from "@/src/core/customizationPersistence";

const MAX_HIDDEN = 10000;
const MAX_ORDER = 10000;

type Snapshot = {
  hiddenIds: string[];
  customOrder: string[];
  customNumbers: Record<string, number>;
};

let cached: Snapshot = { hiddenIds: [], customOrder: [], customNumbers: {} };
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: Snapshot) => void>();

type DirtyState = { hiddenIds: boolean; customOrder: boolean; customNumbers: boolean };
let webPersistRunning = false;
let webPendingDirty: DirtyState = { hiddenIds: false, customOrder: false, customNumbers: false };

function emit() {
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
}

function commit(next: Snapshot) {
  mutationEpoch += 1;
  cached = next;
  loaded = true;
  emit();
}

function sanitizeIds(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeNumbers(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(key || "").trim();
    const num = typeof value === "number" ? value : Number(value);
    if (!id || !Number.isFinite(num) || num < 1 || num > 99999) continue;
    out[id] = Math.floor(num);
    if (++count >= MAX_ORDER) break;
  }
  return out;
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    let next: Snapshot;
    if (nativeCustomizationAvailable) {
      const native = await loadNativeCustomizationWithMigration();
      next = {
        hiddenIds: sanitizeIds(native.hiddenIds, MAX_HIDDEN),
        customOrder: sanitizeIds(native.customOrder, MAX_ORDER),
        customNumbers: sanitizeNumbers(native.customNumbers),
      };
    } else {
      const [hidden, order, numbers] = await Promise.all([
        storage.getItem<unknown>(LEGACY_HIDDEN_KEY, []),
        storage.getItem<unknown>(LEGACY_ORDER_KEY, []),
        storage.getItem<unknown>(LEGACY_NUMBERS_KEY, {}),
      ]);
      next = {
        hiddenIds: sanitizeIds(hidden, MAX_HIDDEN),
        customOrder: sanitizeIds(order, MAX_ORDER),
        customNumbers: sanitizeNumbers(numbers),
      };
    }
    // User changes made while initial hydration was in flight own the newer
    // snapshot; a stale disk/native read must never reinstall older state.
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
    commit({
      hiddenIds: sanitizeIds(native.hiddenIds, MAX_HIDDEN),
      customOrder: sanitizeIds(native.customOrder, MAX_ORDER),
      customNumbers: sanitizeNumbers(native.customNumbers),
    });
  } catch {}
}

async function flushWebPersistence(): Promise<void> {
  if (nativeCustomizationAvailable || webPersistRunning) return;
  webPersistRunning = true;
  try {
    while (webPendingDirty.hiddenIds || webPendingDirty.customOrder || webPendingDirty.customNumbers) {
      const dirty = webPendingDirty;
      webPendingDirty = { hiddenIds: false, customOrder: false, customNumbers: false };
      const snapshot = cached;
      const writes: Promise<boolean>[] = [];
      if (dirty.hiddenIds) writes.push(storage.setItem(LEGACY_HIDDEN_KEY, snapshot.hiddenIds));
      if (dirty.customOrder) writes.push(storage.setItem(LEGACY_ORDER_KEY, snapshot.customOrder));
      if (dirty.customNumbers) writes.push(storage.setItem(LEGACY_NUMBERS_KEY, snapshot.customNumbers));
      if (writes.length) await Promise.all(writes);
    }
  } finally {
    webPersistRunning = false;
    if (webPendingDirty.hiddenIds || webPendingDirty.customOrder || webPendingDirty.customNumbers) {
      void flushWebPersistence();
    }
  }
}

function persistWeb(previous: Snapshot, next: Snapshot) {
  if (nativeCustomizationAvailable) return;
  if (previous.hiddenIds !== next.hiddenIds) webPendingDirty.hiddenIds = true;
  if (previous.customOrder !== next.customOrder) webPendingDirty.customOrder = true;
  if (previous.customNumbers !== next.customNumbers) webPendingDirty.customNumbers = true;
  void flushWebPersistence();
}

function mergeCustomOrder(current: string[], channelIds: string[]): string[] {
  const available = sanitizeIds(channelIds, MAX_ORDER);
  const availableSet = new Set(available);
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of current) {
    if (!availableSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (const id of available) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function useChannelCustomize() {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: Snapshot) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);

  const hiddenSet = useCallback(() => new Set(value.hiddenIds), [value.hiddenIds]);

  const toggleHidden = useCallback((channelId: string) => {
    const id = String(channelId || "").trim();
    if (!id) return;
    const previous = cached;
    const exists = previous.hiddenIds.includes(id);
    const hiddenIds = exists
      ? previous.hiddenIds.filter((item) => item !== id)
      : [...previous.hiddenIds, id].slice(0, MAX_HIDDEN);
    const next = { ...previous, hiddenIds };
    commit(next);
    persistWeb(previous, next);
    if (nativeCustomizationAvailable) {
      void nativeSetChannelHidden(id, !exists).catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  const setCustomNumber = useCallback((channelId: string, number: number | null) => {
    const id = String(channelId || "").trim();
    if (!id) return;
    const normalized = number == null || !Number.isFinite(number)
      ? null
      : Math.max(1, Math.min(99999, Math.floor(number)));
    const previous = cached;
    const existing = previous.customNumbers[id];
    if ((normalized == null && existing == null) || normalized === existing) return;
    const customNumbers = { ...previous.customNumbers };
    if (normalized == null) delete customNumbers[id]; else customNumbers[id] = normalized;
    const next = { ...previous, customNumbers };
    commit(next);
    persistWeb(previous, next);
    if (nativeCustomizationAvailable) {
      void nativeSetCustomNumber(id, normalized).catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  const initializeCustomOrder = useCallback((channelIds: string[]) => {
    const previous = cached;
    const customOrder = mergeCustomOrder(previous.customOrder, channelIds);
    if (customOrder.length === previous.customOrder.length && customOrder.every((id, i) => id === previous.customOrder[i])) return;
    const next = { ...previous, customOrder };
    commit(next);
    persistWeb(previous, next);
    if (nativeCustomizationAvailable) {
      void nativeSetChannelOrder(customOrder).catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  const moveInCustomOrder = useCallback((channelId: string, direction: -1 | 1, channelIds?: string[]) => {
    const id = String(channelId || "").trim();
    if (!id) return;
    const previous = cached;
    const order = channelIds?.length
      ? mergeCustomOrder(previous.customOrder, channelIds)
      : previous.customOrder.slice();
    const initializedChanged = order.length !== previous.customOrder.length || order.some((item, i) => item !== previous.customOrder[i]);
    if (!order.includes(id)) order.push(id);
    const index = order.indexOf(id);
    const target = index + direction;
    if (target >= 0 && target < order.length && target !== index) {
      const [item] = order.splice(index, 1);
      order.splice(target, 0, item);
    }
    if (order.length === previous.customOrder.length && order.every((item, i) => item === previous.customOrder[i])) return;
    const next = { ...previous, customOrder: order };
    commit(next);
    persistWeb(previous, next);
    if (nativeCustomizationAvailable) {
      const write = initializedChanged
        ? nativeSetChannelOrder(order)
        : nativeMoveChannel(id, direction);
      void write.catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  const setCustomOrder = useCallback((channelIds: string[]) => {
    const customOrder = sanitizeIds(channelIds, MAX_ORDER);
    const previous = cached;
    if (customOrder.length === previous.customOrder.length && customOrder.every((id, i) => id === previous.customOrder[i])) return;
    const next = { ...previous, customOrder };
    commit(next);
    persistWeb(previous, next);
    if (nativeCustomizationAvailable) {
      void nativeSetChannelOrder(customOrder).catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  const clearCustomOrder = useCallback(() => {
    const previous = cached;
    if (!previous.customOrder.length) return;
    const next = { ...previous, customOrder: [] };
    commit(next);
    persistWeb(previous, next);
    if (nativeCustomizationAvailable) {
      void nativeClearChannelOrder().catch(() => void reloadNativeAfterFailure());
    }
  }, []);

  return {
    hiddenIds: value.hiddenIds,
    customOrder: value.customOrder,
    customNumbers: value.customNumbers,
    hiddenSet,
    toggleHidden,
    setCustomNumber,
    initializeCustomOrder,
    moveInCustomOrder,
    setCustomOrder,
    clearCustomOrder,
  };
}

export function resolveChannelNumber(
  channelId: string,
  fallbackIndex: number,
  customNumbers: Record<string, number>,
): number {
  return customNumbers[channelId] || fallbackIndex;
}
