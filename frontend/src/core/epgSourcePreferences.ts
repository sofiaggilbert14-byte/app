import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import {
  clearNativeEpgBindings,
  importLegacyNativeEpgBindings,
  nativeEpgBindingsAvailable,
  readNativeEpgBindings,
  setNativeEpgBinding,
} from "@/src/nativeEpgBindings";

export type UserEpgOverrideMap = Record<string, string>;

export type EpgSourcePreferences = {
  primaryEnabled: boolean;
  userEnabled: boolean;
  userName: string;
  userUrl: string;
  /** Session snapshot. On Android the durable source is epg_channel_bindings. */
  userOverrides: UserEpgOverrideMap;
};

type StoredEpgSourcePreferences = Partial<EpgSourcePreferences>;

const KEY = "gs_phase9_epg_source_preferences_v1";
const DEFAULTS: EpgSourcePreferences = {
  primaryEnabled: true,
  userEnabled: false,
  userName: "Custom EPG",
  userUrl: "",
  userOverrides: {},
};

let cached = DEFAULTS;
let loaded = false;
let loadPromise: Promise<EpgSourcePreferences> | null = null;
let writeActive = false;
let pendingWrite: EpgSourcePreferences | null = null;
let nativeBindingsHydrated = false;
const listeners = new Set<(value: EpgSourcePreferences) => void>();

function cleanUrl(value: unknown): string {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url || url.length > 2048) return "";
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  return name || "Custom EPG";
}

function cleanOverrides(value: unknown): UserEpgOverrideMap {
  if (!value || typeof value !== "object") return {};
  const out: UserEpgOverrideMap = {};
  let count = 0;
  for (const [channelId, xmltvId] of Object.entries(value as Record<string, unknown>)) {
    const id = String(channelId || "").trim().slice(0, 180);
    const sourceId = String(xmltvId || "").trim().slice(0, 180);
    if (!id || !sourceId || id.includes("://") || sourceId.includes("://")) continue;
    out[id] = sourceId;
    if (++count >= 10_000) break;
  }
  return out;
}

function normalize(value: StoredEpgSourcePreferences | null | undefined): EpgSourcePreferences {
  return {
    primaryEnabled: value?.primaryEnabled !== false,
    userEnabled: value?.userEnabled === true,
    userName: cleanName(value?.userName),
    userUrl: cleanUrl(value?.userUrl),
    userOverrides: cleanOverrides(value?.userOverrides),
  };
}

function emit() {
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
}

function storedValue(value: EpgSourcePreferences): StoredEpgSourcePreferences {
  if (nativeEpgBindingsAvailable && nativeBindingsHydrated) {
    // Do not serialize thousands of assignments twice. Room owns them.
    return {
      primaryEnabled: value.primaryEnabled,
      userEnabled: value.userEnabled,
      userName: value.userName,
      userUrl: value.userUrl,
    };
  }
  // Web/legacy fallback still needs the map because there is no native binding DB.
  return value;
}

async function flush() {
  if (writeActive) return;
  writeActive = true;
  try {
    while (pendingWrite) {
      const next = pendingWrite;
      pendingWrite = null;
      await storage.setItem(KEY, storedValue(next));
    }
  } finally {
    writeActive = false;
    if (pendingWrite) void flush();
  }
}

function commitPrepared(value: EpgSourcePreferences) {
  cached = value;
  loaded = true;
  emit();
  pendingWrite = cached;
  void flush();
}

async function load(): Promise<EpgSourcePreferences> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const legacy = normalize(await storage.getItem<StoredEpgSourcePreferences>(KEY, DEFAULTS));
    if (!nativeEpgBindingsAvailable) {
      cached = legacy;
      loaded = true;
      return cached;
    }

    try {
      // One-time migration. The native bridge only imports when Room has no
      // assignments, so an already-authoritative DB can never be overwritten by
      // stale AsyncStorage data after a reinstall/update cycle.
      await importLegacyNativeEpgBindings(legacy.userOverrides);
      const nativeOverrides = cleanOverrides(await readNativeEpgBindings());
      cached = { ...legacy, userOverrides: nativeOverrides };
      nativeBindingsHydrated = true;
      loaded = true;
      // Rewrite the old preference object without the large override map only
      // after native migration + read both succeeded.
      pendingWrite = cached;
      void flush();
      return cached;
    } catch {
      // Keep the legacy map intact if the bridge/database was not ready. A later
      // process start can retry migration without losing assignments.
      cached = legacy;
      loaded = true;
      return cached;
    }
  })();
  try { return await loadPromise; }
  finally { loadPromise = null; }
}

async function reloadNativeOverridesAfterFailure() {
  if (!nativeEpgBindingsAvailable) return;
  try {
    const userOverrides = cleanOverrides(await readNativeEpgBindings());
    nativeBindingsHydrated = true;
    commitPrepared({ ...cached, userOverrides });
  } catch {}
}

export async function getEpgSourcePreferences(): Promise<EpgSourcePreferences> {
  return load();
}

export function useEpgSourcePreferences() {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: EpgSourcePreferences) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);

  const update = useCallback((patch: Partial<EpgSourcePreferences>) => {
    const next: EpgSourcePreferences = {
      primaryEnabled: patch.primaryEnabled === undefined ? cached.primaryEnabled : patch.primaryEnabled !== false,
      userEnabled: patch.userEnabled === undefined ? cached.userEnabled : patch.userEnabled === true,
      userName: patch.userName === undefined ? cached.userName : cleanName(patch.userName),
      userUrl: patch.userUrl === undefined ? cached.userUrl : cleanUrl(patch.userUrl),
      userOverrides: patch.userOverrides === undefined ? cached.userOverrides : cleanOverrides(patch.userOverrides),
    };
    setValue(next);
    commitPrepared(next);
  }, []);

  const setUserOverride = useCallback((channelId: string, xmltvId: string | null) => {
    const id = String(channelId || "").trim().slice(0, 180);
    const sourceId = String(xmltvId || "").trim().slice(0, 180);
    if (!id || id.includes("://") || sourceId.includes("://")) return;
    const existing = cached.userOverrides[id] || "";
    if (existing === sourceId || (!sourceId && !existing)) return;
    const overrides = { ...cached.userOverrides };
    if (sourceId) overrides[id] = sourceId; else delete overrides[id];
    const next = { ...cached, userOverrides: overrides };
    setValue(next);
    commitPrepared(next);
    if (nativeEpgBindingsAvailable) {
      void setNativeEpgBinding(id, sourceId || null).catch(() => void reloadNativeOverridesAfterFailure());
    }
  }, []);

  const clearUserOverrides = useCallback(() => {
    const next = { ...cached, userOverrides: {} };
    setValue(next);
    commitPrepared(next);
    if (nativeEpgBindingsAvailable) {
      void clearNativeEpgBindings().catch(() => void reloadNativeOverridesAfterFailure());
    }
  }, []);

  return {
    ...value,
    setPrimaryEnabled: (next: boolean) => update({ primaryEnabled: next }),
    setUserEnabled: (next: boolean) => update({ userEnabled: next }),
    setUserName: (next: string) => update({ userName: next }),
    setUserUrl: (next: string) => update({ userUrl: next }),
    setUserOverride,
    clearUserOverrides,
  };
}

