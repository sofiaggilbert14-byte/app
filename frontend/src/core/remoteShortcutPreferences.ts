import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlayerRemoteAction = "channel_up" | "channel_down" | "channels" | "controls" | "favorite" | "guide" | "previous" | "none";
export type LongDownAction = Extract<PlayerRemoteAction, "channels" | "guide" | "none">;
// Kept as a compatibility type for the existing Settings screen. Native long
// Select is now reserved for contextual Quick Actions and never executes this value.
export type LongSelectAction = Extract<PlayerRemoteAction, "favorite" | "controls" | "guide" | "previous" | "none">;

export type RemoteShortcutPreferences = {
  longDown: LongDownAction;
  longSelect: LongSelectAction;
  channelUp: PlayerRemoteAction;
  channelDown: PlayerRemoteAction;
  mediaPlayPause: PlayerRemoteAction;
};

const KEY = "gs_remote_shortcuts_v1";
const DEFAULTS: RemoteShortcutPreferences = {
  longDown: "channels",
  longSelect: "controls",
  channelUp: "channel_up",
  channelDown: "channel_down",
  mediaPlayPause: "controls",
};

let cached = DEFAULTS;
let loaded = false;
let loadPromise: Promise<RemoteShortcutPreferences> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: RemoteShortcutPreferences) => void>();

function normalize(value: Partial<RemoteShortcutPreferences> | null | undefined): RemoteShortcutPreferences {
  const action = (raw: unknown, fallback: PlayerRemoteAction): PlayerRemoteAction =>
    raw === "channel_up" || raw === "channel_down" || raw === "channels" || raw === "controls" || raw === "favorite" || raw === "guide" || raw === "previous" || raw === "none" ? raw : fallback;
  const legacyLongSelect = value?.longSelect;
  return {
    longDown: value?.longDown === "guide" || value?.longDown === "none" ? value.longDown : "channels",
    // Migrate the old long-OK Favorite shortcut. Long OK is now owned by the
    // Quick Actions overlay; Favorite lives inside that overlay instead.
    longSelect: legacyLongSelect === "guide" || legacyLongSelect === "previous" || legacyLongSelect === "none"
      ? legacyLongSelect
      : "controls",
    channelUp: action(value?.channelUp, "channel_up"),
    channelDown: action(value?.channelDown, "channel_down"),
    mediaPlayPause: action(value?.mediaPlayPause, "controls"),
  };
}

async function load(): Promise<RemoteShortcutPreferences> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const next = normalize(await storage.getItem<RemoteShortcutPreferences>(KEY, DEFAULTS));
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    cached = next;
    loaded = true;
    return cached;
  })();
  try { return await loadPromise; } finally { loadPromise = null; }
}

export async function getRemoteShortcutPreferences(): Promise<RemoteShortcutPreferences> {
  return load();
}

export async function setRemoteShortcutPreferences(value: RemoteShortcutPreferences): Promise<void> {
  mutationEpoch += 1;
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
    const next = normalize({ ...cached, ...patch });
    setValue(next);
    void setRemoteShortcutPreferences(next);
  }, []);

  return {
    ...value,
    setLongDown: (next: LongDownAction) => update({ longDown: next }),
    setLongSelect: (next: LongSelectAction) => update({ longSelect: next }),
    setChannelUp: (next: PlayerRemoteAction) => update({ channelUp: next }),
    setChannelDown: (next: PlayerRemoteAction) => update({ channelDown: next }),
    setMediaPlayPause: (next: PlayerRemoteAction) => update({ mediaPlayPause: next }),
    reset: () => { setValue(DEFAULTS); void setRemoteShortcutPreferences(DEFAULTS); },
  };
}
