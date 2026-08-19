import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlayerRemoteAction = "channel_up" | "channel_down" | "channels" | "controls" | "favorite" | "guide" | "previous" | "none";
export type LongDownAction = Extract<PlayerRemoteAction, "channels" | "guide" | "none">;
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
  longSelect: "favorite",
  channelUp: "channel_up",
  channelDown: "channel_down",
  mediaPlayPause: "controls",
};

let cached = DEFAULTS;
let loaded = false;
const listeners = new Set<(value: RemoteShortcutPreferences) => void>();

function normalize(value: Partial<RemoteShortcutPreferences> | null | undefined): RemoteShortcutPreferences {
  const action = (raw: unknown, fallback: PlayerRemoteAction): PlayerRemoteAction =>
    raw === "channel_up" || raw === "channel_down" || raw === "channels" || raw === "controls" || raw === "favorite" || raw === "guide" || raw === "previous" || raw === "none" ? raw : fallback;
  return {
    longDown: value?.longDown === "guide" || value?.longDown === "none" ? value.longDown : "channels",
    longSelect: value?.longSelect === "favorite" || value?.longSelect === "guide" || value?.longSelect === "controls" || value?.longSelect === "previous" || value?.longSelect === "none" ? value.longSelect : "favorite",
    channelUp: action(value?.channelUp, "channel_up"),
    channelDown: action(value?.channelDown, "channel_down"),
    mediaPlayPause: action(value?.mediaPlayPause, "controls"),
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
    setChannelUp: (next: PlayerRemoteAction) => update({ channelUp: next }),
    setChannelDown: (next: PlayerRemoteAction) => update({ channelDown: next }),
    setMediaPlayPause: (next: PlayerRemoteAction) => update({ mediaPlayPause: next }),
    reset: () => { setValue(DEFAULTS); void setRemoteShortcutPreferences(DEFAULTS); },
  };
}

