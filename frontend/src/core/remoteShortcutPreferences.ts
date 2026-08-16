import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type LongDownAction = "channels" | "guide" | "none";
export type LongSelectAction = "controls" | "guide" | "none";

export type RemoteShortcutPreferences = {
  longDown: LongDownAction;
  longSelect: LongSelectAction;
};

const KEY = "gs_remote_shortcuts_v1";
const DEFAULTS: RemoteShortcutPreferences = {
  longDown: "channels",
  longSelect: "controls",
};

let cached = DEFAULTS;
let loaded = false;
const listeners = new Set<(value: RemoteShortcutPreferences) => void>();

function normalize(value: Partial<RemoteShortcutPreferences> | null | undefined): RemoteShortcutPreferences {
  return {
    longDown: value?.longDown === "guide" || value?.longDown === "none" ? value.longDown : "channels",
    longSelect: value?.longSelect === "guide" || value?.longSelect === "none" ? value.longSelect : "controls",
  };
}

async function load(): Promise<RemoteShortcutPreferences> {
  if (loaded) return cached;
  cached = normalize(await storage.getItem<RemoteShortcutPreferences>(KEY, DEFAULTS));
  loaded = true;
  return cached;
}

export async function getRemoteShortcutPreferences(): Promise<RemoteShortcutPreferences> {
  return load();
}

export async function setRemoteShortcutPreferences(value: RemoteShortcutPreferences): Promise<void> {
  cached = normalize(value);
  loaded = true;
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
  await storage.setItem(KEY, cached);
}

export function useRemoteShortcutPreferences() {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: RemoteShortcutPreferences) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);

  const update = useCallback((patch: Partial<RemoteShortcutPreferences>) => {
    const next = normalize({ ...value, ...patch });
    setValue(next);
    void setRemoteShortcutPreferences(next);
  }, [value]);

  return {
    ...value,
    setLongDown: (next: LongDownAction) => update({ longDown: next }),
    setLongSelect: (next: LongSelectAction) => update({ longSelect: next }),
  };
}
