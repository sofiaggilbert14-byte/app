import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import {
  normalizeParentalPin,
  setParentalPinMemory,
  verifyParentalPin as verifyParentalPinCore,
} from "./parentalPinCore";

const PIN_KEY = "gs_parental_pin";
const LOCKED_GROUPS_KEY = "gs_parental_locked_groups";

/** Session unlocks — cleared when app process dies. */
const sessionUnlocked = new Set<string>();

type Snapshot = {
  pin: string | null;
  lockedGroups: string[];
};

let cached: Snapshot = { pin: null, lockedGroups: [] };
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

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const securePin = normalizeParentalPin(await storage.secureGet<string>(PIN_KEY, ""));
    const plainPin = normalizeParentalPin(await storage.getItem<string>(PIN_KEY, ""));
    const locked = await storage.getItem<string[]>(LOCKED_GROUPS_KEY, []);
    const pin = securePin || plainPin;
    setParentalPinMemory(pin);
    cached = {
      pin,
      lockedGroups: Array.isArray(locked) ? locked.filter((item) => typeof item === "string").slice(0, 40) : [],
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

export function verifyParentalPin(candidate: string): boolean {
  return verifyParentalPinCore(candidate);
}

export async function setParentalPin(pin: string | null): Promise<void> {
  const next = setParentalPinMemory(pin);
  cached = { ...cached, pin: next };
  loaded = true;
  if (!next) sessionUnlocked.clear();
  emit();
  if (next) {
    await storage.secureSet(PIN_KEY, next);
    await storage.removeItem(PIN_KEY);
  } else {
    await storage.secureRemove(PIN_KEY);
    await storage.removeItem(PIN_KEY);
  }
}

export async function setLockedGroups(groups: string[]): Promise<void> {
  cached = { ...cached, lockedGroups: groups.slice(0, 40) };
  loaded = true;
  emit();
  await storage.setItem(LOCKED_GROUPS_KEY, cached.lockedGroups);
}

export function useParentalPin() {
  const [value, setValue] = useState(cached);
  const [, setTick] = useState(0);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => {
      if (mounted) setValue(next);
    });
    const listener = (next: Snapshot) => {
      if (mounted) {
        setValue(next);
        setTick((n) => n + 1);
      }
    };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  return {
    hasPin: !!value.pin,
    lockedGroups: value.lockedGroups,
    isGroupLocked: useCallback(
      (group: string) => {
        if (!value.pin) return false;
        if (!value.lockedGroups.includes(group)) return false;
        return !sessionUnlocked.has(group);
      },
      [value.lockedGroups, value.pin],
    ),
    setPin: useCallback((pin: string | null) => {
      void setParentalPin(pin);
    }, []),
    setLockedGroups: useCallback((groups: string[]) => {
      setValue((prev) => ({ ...prev, lockedGroups: groups.slice(0, 40) }));
      void setLockedGroups(groups);
    }, []),
    unlockGroup: useCallback((group: string) => {
      sessionUnlocked.add(group);
      setTick((n) => n + 1);
      emit();
    }, []),
    verifyPin: verifyParentalPin,
    lockSession: useCallback(() => {
      sessionUnlocked.clear();
      setTick((n) => n + 1);
      emit();
    }, []),
  };
}
