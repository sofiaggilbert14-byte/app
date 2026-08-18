import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

const HIDDEN_KEY = "gs_hidden_channel_ids";
const ORDER_KEY = "gs_channel_custom_order";
const NUMBERS_KEY = "gs_channel_custom_numbers";

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
const listeners = new Set<(value: Snapshot) => void>();

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener(cached);
    } catch {}
  }
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
    count += 1;
    if (count >= MAX_ORDER) break;
  }
  return out;
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [hidden, order, numbers] = await Promise.all([
      storage.getItem<unknown>(HIDDEN_KEY, []),
      storage.getItem<unknown>(ORDER_KEY, []),
      storage.getItem<unknown>(NUMBERS_KEY, {}),
    ]);
    cached = {
      hiddenIds: sanitizeIds(hidden, MAX_HIDDEN),
      customOrder: sanitizeIds(order, MAX_ORDER),
      customNumbers: sanitizeNumbers(numbers),
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

async function persist(next: Snapshot): Promise<void> {
  cached = next;
  loaded = true;
  emit();
  await Promise.all([
    storage.setItem(HIDDEN_KEY, next.hiddenIds),
    storage.setItem(ORDER_KEY, next.customOrder),
    storage.setItem(NUMBERS_KEY, next.customNumbers),
  ]);
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
  return next.slice(0, MAX_ORDER);
}

export function useChannelCustomize() {
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

  const hiddenSet = useCallback(() => new Set(value.hiddenIds), [value.hiddenIds]);

  const toggleHidden = useCallback((channelId: string) => {
    const id = String(channelId || "").trim();
    if (!id) return;
    setValue((prev) => {
      const exists = prev.hiddenIds.includes(id);
      const hiddenIds = exists
        ? prev.hiddenIds.filter((item) => item !== id)
        : [...prev.hiddenIds, id].slice(0, MAX_HIDDEN);
      const next = { ...prev, hiddenIds };
      void persist(next);
      return next;
    });
  }, []);

  const setCustomNumber = useCallback((channelId: string, number: number | null) => {
    const id = String(channelId || "").trim();
    if (!id) return;
    setValue((prev) => {
      const customNumbers = { ...prev.customNumbers };
      if (number == null || !Number.isFinite(number)) delete customNumbers[id];
      else customNumbers[id] = Math.max(1, Math.min(99999, Math.floor(number)));
      const next = { ...prev, customNumbers };
      void persist(next);
      return next;
    });
  }, []);

  const initializeCustomOrder = useCallback((channelIds: string[]) => {
    setValue((prev) => {
      const customOrder = mergeCustomOrder(prev.customOrder, channelIds);
      if (
        customOrder.length === prev.customOrder.length &&
        customOrder.every((id, index) => id === prev.customOrder[index])
      ) {
        return prev;
      }
      const next = { ...prev, customOrder };
      void persist(next);
      return next;
    });
  }, []);

  const moveInCustomOrder = useCallback((channelId: string, direction: -1 | 1, channelIds?: string[]) => {
    const id = String(channelId || "").trim();
    if (!id) return;
    setValue((prev) => {
      const order = channelIds?.length
        ? mergeCustomOrder(prev.customOrder, channelIds)
        : prev.customOrder.slice();
      if (!order.includes(id)) order.push(id);
      const index = order.indexOf(id);
      const target = index + direction;
      if (target < 0 || target >= order.length) {
        if (order.length === prev.customOrder.length && order.every((item, i) => item === prev.customOrder[i])) return prev;
        const next = { ...prev, customOrder: order.slice(0, MAX_ORDER) };
        void persist(next);
        return next;
      }
      const [item] = order.splice(index, 1);
      order.splice(target, 0, item);
      const next = { ...prev, customOrder: order.slice(0, MAX_ORDER) };
      void persist(next);
      return next;
    });
  }, []);

  const setCustomOrder = useCallback((channelIds: string[]) => {
    const customOrder = sanitizeIds(channelIds, MAX_ORDER);
    setValue((prev) => {
      const next = { ...prev, customOrder };
      void persist(next);
      return next;
    });
  }, []);

  const clearCustomOrder = useCallback(() => {
    setValue((prev) => {
      if (!prev.customOrder.length) return prev;
      const next = { ...prev, customOrder: [] };
      void persist(next);
      return next;
    });
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
