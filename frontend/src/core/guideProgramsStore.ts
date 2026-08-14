import { useCallback, useSyncExternalStore } from "react";
import type { Program } from "@/src/api";

/**
 * TV guide programme cache deliberately lives outside the app-wide React context.
 *
 * A viewport EPG response may update one channel while a 2,000-row guide is
 * mounted. Putting that map in GuideProvider makes every consumer render and
 * makes FlashList receive a new data array. This store lets a row subscribe to
 * its own programme pointer only.
 *
 * SQLite/native EPG storage is authoritative. This JS layer is only a bounded,
 * row-local pointer cache so guide focus never depends on an all-channel React
 * update completing first.
 */
const EMPTY_PROGRAMS: Program[] = [];
// Programme arrays are shared with the source cache rather than copied. A wider
// bounded row index lets a 2,000-channel playlist reverse direction without
// immediately rebuilding rows that were already visited.
let maxProgrammeRows = 20_000;

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

function trim(keepIds: ReadonlySet<string> = new Set(), force = false): void {
  if (programsByChannelId.size <= maxProgrammeRows) return;

  // Prefer keeping mounted (subscribed) rows during normal surfing so focus
  // stays stable. Critical / force paths may empty off-keep subscribed rows —
  // subscribers re-render to EMPTY_PROGRAMS without dropping their identity.
  for (const channelId of Array.from(programsByChannelId.keys())) {
    if (programsByChannelId.size <= maxProgrammeRows) return;
    if (keepIds.has(channelId)) continue;
    if (!force && (listenersByChannelId.get(channelId)?.size || 0) > 0) continue;
    programsByChannelId.delete(channelId);
    notify(channelId);
  }
}

export function setGuideProgramRowLimit(limit: number): void {
  // Full-guide experiment: power profiles cannot evict off-screen programme
  // rows after the all-channel response has reached JavaScript.
  maxProgrammeRows = Math.max(20_000, Math.floor(limit || 20_000));
  trim();
}

/** Memory-pressure trim. Critical force-evicts subscribed off-keep rows. */
export function trimGuideProgramRows(keepIds: Iterable<string>, critical = false): void {
  const keep = new Set(Array.from(keepIds).filter(Boolean));
  const previous = maxProgrammeRows;
  maxProgrammeRows = critical
    ? Math.max(128, keep.size)
    : Math.max(256, Math.floor(previous / 2), keep.size);
  trim(keep, critical);
  maxProgrammeRows = previous;
}

/** Return a stable list reference suitable for a memoized guide row. */
export function getGuidePrograms(channelId: string | null | undefined): Program[] {
  if (!channelId) return EMPTY_PROGRAMS;
  return programsByChannelId.get(channelId) || EMPTY_PROGRAMS;
}

export function hasGuidePrograms(channelId: string | null | undefined): boolean {
  return getGuidePrograms(channelId).length > 0;
}

export type GuideProgramRowState = "loading" | "ready" | "empty";

export function getGuideProgramRowState(channelId: string | null | undefined): GuideProgramRowState {
  if (!channelId || !programsByChannelId.has(channelId)) return "loading";
  return (programsByChannelId.get(channelId)?.length || 0) > 0 ? "ready" : "empty";
}

/** Channel ids currently held in the bounded programme cache (for Search, etc.). */
export function listCachedGuideChannelIds(): string[] {
  return Array.from(programsByChannelId.keys());
}

/**
 * Replace the visible time window only when the actual start/end window changes.
 * Guide-epoch changes for the same rendered window are stale-while-revalidate:
 * existing row pointers remain visible/focusable until fresh row deltas arrive.
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

export type RetainGuideProgramsOptions = {
  /** When true, also empty subscribed off-keep rows (blur / critical pressure). */
  force?: boolean;
};

/**
 * Keep only the sliding-window channel ids. Off-window rows are dropped so a
 * held D-pad run cannot accumulate the whole playlist in JS heap. Mounted
 * (subscribed) rows stay until FlashList recycles them unless `force` is set.
 */
export function retainGuidePrograms(
  keepIds: Iterable<string>,
  options?: RetainGuideProgramsOptions,
): void {
  const keep = keepIds instanceof Set ? keepIds : new Set(Array.from(keepIds).filter(Boolean));
  if (!keep.size) return;
  const force = !!options?.force;
  const drop: string[] = [];
  for (const id of programsByChannelId.keys()) {
    if (keep.has(id)) continue;
    if (!force && (listenersByChannelId.get(id)?.size || 0) > 0) continue;
    drop.push(id);
  }
  if (!drop.length) return;
  for (const id of drop) {
    programsByChannelId.delete(id);
    notify(id);
  }
}

/**
 * The JS render cache is keyed by the displayed time window, not native guide
 * epoch. Native epoch still invalidates native query caches; keeping it out of
 * this key prevents a background refresh from blanking every mounted row.
 */
export function makeGuideProgramWindowKey(start: string, end: string, _guideEpoch = 0): string {
  return `${start}|${end}`;
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

