import { useCallback, useSyncExternalStore } from "react";
import type { Program } from "@/src/api";

/**
 * TV guide programme cache deliberately lives outside the app-wide React context.
 *
 * A viewport EPG response may update one channel while a 2,000-row guide is
 * mounted. Putting that map in GuideProvider makes every consumer render and
 * makes FlashList receive a new data array. This store lets a row subscribe to
 * its own programme pointer only.
 */
const EMPTY_PROGRAMS: Program[] = [];
const MAX_PROGRAMME_ROWS = 700;

let activeWindowKey = "";
const programsByChannelId = new Map<string, Program[]>();
const listenersByChannelId = new Map<string, Set<() => void>>();

function notify(channelId: string): void {
  const listeners = listenersByChannelId.get(channelId);
  if (!listeners) return;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // One consumer must never prevent another row from refreshing.
    }
  }
}

function subscribe(channelId: string, listener: () => void): () => void {
  if (!channelId) return () => undefined;
  let listeners = listenersByChannelId.get(channelId);
  if (!listeners) {
    listeners = new Set();
    listenersByChannelId.set(channelId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = listenersByChannelId.get(channelId);
    current?.delete(listener);
    if (current && current.size === 0) listenersByChannelId.delete(channelId);
  };
}

function trim(): void {
  while (programsByChannelId.size > MAX_PROGRAMME_ROWS) {
    const oldest = programsByChannelId.keys().next().value as string | undefined;
    if (!oldest) return;
    programsByChannelId.delete(oldest);
    notify(oldest);
  }
}

/** Return a stable list reference suitable for a memoized guide row. */
export function getGuidePrograms(channelId: string | null | undefined): Program[] {
  if (!channelId) return EMPTY_PROGRAMS;
  return programsByChannelId.get(channelId) || EMPTY_PROGRAMS;
}

export function hasGuidePrograms(channelId: string | null | undefined): boolean {
  return getGuidePrograms(channelId).length > 0;
}

/** Channel ids currently held in the bounded programme cache (for Search, etc.). */
export function listCachedGuideChannelIds(): string[] {
  return Array.from(programsByChannelId.keys());
}

/**
 * Replace the visible guide window on a day/epoch change, otherwise merge a
 * sparse viewport delta. Callers must pass the exact rendered window key.
 */
export function applyGuidePrograms(
  windowKey: string,
  delta: Record<string, Program[]>,
): void {
  const nextWindow = windowKey || activeWindowKey;
  if (nextWindow && activeWindowKey && nextWindow !== activeWindowKey) {
    const previousIds = Array.from(programsByChannelId.keys());
    programsByChannelId.clear();
    for (const id of previousIds) notify(id);
  }
  if (nextWindow) activeWindowKey = nextWindow;

  for (const [channelId, programs] of Object.entries(delta)) {
    if (!channelId || !Array.isArray(programs)) continue;
    const previous = programsByChannelId.get(channelId);
    if (previous === programs) continue;
    // Preserve LRU ordering without allocating an all-channel React map.
    programsByChannelId.delete(channelId);
    programsByChannelId.set(channelId, programs);
    notify(channelId);
  }
  trim();
}

export function clearGuidePrograms(): void {
  const ids = Array.from(programsByChannelId.keys());
  programsByChannelId.clear();
  activeWindowKey = "";
  for (const id of ids) notify(id);
}

export function makeGuideProgramWindowKey(start: string, end: string, guideEpoch = 0): string {
  return `${start}|${end}|${guideEpoch}`;
}

/** Subscribe a rendered guide row to only its own programme pointer. */
export function useGuidePrograms(channelId: string | null | undefined): Program[] {
  const subscribeForChannel = useCallback(
    (listener: () => void) => subscribe(channelId || "", listener),
    [channelId],
  );
  const getSnapshot = useCallback(() => getGuidePrograms(channelId), [channelId]);
  return useSyncExternalStore(subscribeForChannel, getSnapshot, getSnapshot);
}
