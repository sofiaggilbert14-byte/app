import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type UserEpgOverrideMap = Record<string, string>;

export type EpgSourcePreferences = {
  primaryEnabled: boolean;
  userEnabled: boolean;
  userUrl: string;
  userOverrides: UserEpgOverrideMap;
};

const KEY = "gs_phase9_epg_source_preferences_v1";
const DEFAULTS: EpgSourcePreferences = {
  primaryEnabled: true,
  userEnabled: false,
  userUrl: "",
  userOverrides: {},
};

let cached = DEFAULTS;
let loaded = false;
let writeActive = false;
let pendingWrite: EpgSourcePreferences | null = null;
const listeners = new Set<(value: EpgSourcePreferences) => void>();

function cleanUrl(value: unknown): string {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url || url.length > 2048) return "";
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
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
    count += 1;
    if (count >= 10000) break;
  }
  return out;
}

function normalize(value: Partial<EpgSourcePreferences> | null | undefined): EpgSourcePreferences {
  return {
    primaryEnabled: value?.primaryEnabled !== false,
    userEnabled: value?.userEnabled === true,
    userUrl: cleanUrl(value?.userUrl),
    userOverrides: cleanOverrides(value?.userOverrides),
  };
}

function emit() {
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
}

async function flush() {
  if (writeActive) return;
  writeActive = true;
  try {
    while (pendingWrite) {
      const next = pendingWrite;
      pendingWrite = null;
      await storage.setItem(KEY, next);
    }
  } finally {
    writeActive = false;
  }
}

function commit(value: EpgSourcePreferences) {
  cached = normalize(value);
  loaded = true;
  emit();
  pendingWrite = cached;
  void flush();
}

async function load(): Promise<EpgSourcePreferences> {
  if (loaded) return cached;
  cached = normalize(await storage.getItem<EpgSourcePreferences>(KEY, DEFAULTS));
  loaded = true;
  return cached;
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
    const next = normalize({ ...cached, ...patch });
    setValue(next);
    commit(next);
  }, []);

  const setUserOverride = useCallback((channelId: string, xmltvId: string | null) => {
    const next = { ...cached.userOverrides };
    if (xmltvId?.trim()) next[channelId] = xmltvId.trim();
    else delete next[channelId];
    update({ userOverrides: next });
  }, [update]);

  return {
    ...value,
    setPrimaryEnabled: (next: boolean) => update({ primaryEnabled: next }),
    setUserEnabled: (next: boolean) => update({ userEnabled: next }),
    setUserUrl: (next: string) => update({ userUrl: next }),
    setUserOverride,
    clearUserOverrides: () => update({ userOverrides: {} }),
  };
}
