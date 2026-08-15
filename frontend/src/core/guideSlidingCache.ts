/**
 * Sliding programme-cache window for TV guide surfing (conveyor belt).
 *
 * Keep exactly N pages behind and M pages ahead of focus. This helper retains
 * optional hysteresis support for non-Guide callers, but the Guide profile uses
 * zero extra pages to enforce the requested memory bound.
 */
import {
  GUIDE_PREFETCH_PAGES_AHEAD,
  GUIDE_PREFETCH_PAGES_BEHIND,
} from "./guideRunwayPolicy.ts";

export type GuideSurfDirection = "up" | "down" | "none";

export type GuideCacheProfile = "normal" | "weak" | "max_preview";

export type SlidingCachePages = {
  behind: number;
  ahead: number;
  /** Extra pages on each side before eviction fires. */
  hysteresis: number;
};

export type SlidingCacheWindow = {
  /** Inclusive channel index. */
  start: number;
  /** Exclusive channel index. */
  end: number;
  /** Inclusive eviction start (wider than fetch window). */
  evictStart: number;
  /** Exclusive eviction end. */
  evictEnd: number;
  pageSize: number;
  behind: number;
  ahead: number;
};

const PROFILE_PAGES: Record<GuideCacheProfile, SlidingCachePages> = {
  // The requested seven-page runway is also the hard in-memory keep set.
  normal: {
    behind: GUIDE_PREFETCH_PAGES_BEHIND,
    ahead: GUIDE_PREFETCH_PAGES_AHEAD,
    hysteresis: 0,
  },
  weak: {
    behind: GUIDE_PREFETCH_PAGES_BEHIND,
    ahead: GUIDE_PREFETCH_PAGES_AHEAD,
    hysteresis: 0,
  },
  max_preview: {
    behind: GUIDE_PREFETCH_PAGES_BEHIND,
    ahead: GUIDE_PREFETCH_PAGES_AHEAD,
    hysteresis: 0,
  },
};

export function resolveGuideCacheProfile(value: string | null | undefined): GuideCacheProfile {
  if (value === "weak" || value === "max_preview" || value === "normal") return value;
  return "normal";
}

export function getSlidingCachePages(profile: GuideCacheProfile = "normal"): SlidingCachePages {
  return PROFILE_PAGES[profile] || PROFILE_PAGES.normal;
}

/** Visible channel rows on screen — one "page". */
export function resolveGuidePageSize(bodyHeight: number, rowHeight: number, fallback = 8): number {
  const rh = Math.max(1, rowHeight || 1);
  const raw = Math.floor(Math.max(0, bodyHeight) / rh);
  if (!Number.isFinite(raw) || raw <= 0) return Math.max(4, fallback);
  return Math.max(4, Math.min(24, raw));
}

export function resolveSurfDirection(
  previousFocusIndex: number,
  nextFocusIndex: number,
): GuideSurfDirection {
  if (!Number.isFinite(previousFocusIndex) || !Number.isFinite(nextFocusIndex)) return "none";
  if (nextFocusIndex > previousFocusIndex) return "down";
  if (nextFocusIndex < previousFocusIndex) return "up";
  return "none";
}

/**
 * Compute the exact symmetric fetch window around focus, then its eviction band.
 */
export function computeSlidingCacheWindow(input: {
  focusIndex: number;
  channelCount: number;
  pageSize: number;
  direction?: GuideSurfDirection;
  profile?: GuideCacheProfile;
  previousWindow?: Pick<SlidingCacheWindow, "evictStart" | "evictEnd"> | null;
}): SlidingCacheWindow {
  const count = Math.max(0, Math.floor(input.channelCount || 0));
  const pageSize = Math.max(4, Math.floor(input.pageSize || 8));
  const pages = getSlidingCachePages(input.profile);
  const behind = pages.behind;
  const ahead = pages.ahead;

  const focus = Math.max(0, Math.min(Math.max(0, count - 1), Math.floor(input.focusIndex || 0)));
  const behindRows = behind * pageSize;
  const aheadRows = ahead * pageSize;
  // Sticky neighbors: always keep at least focus ± 1 inside the fetch window.
  let start = Math.max(0, focus - Math.max(behindRows, 1));
  let end = Math.min(count, focus + 1 + Math.max(aheadRows, 1));

  const hysteresisRows = Math.max(0, Math.floor(pages.hysteresis * pageSize));
  let evictStart = Math.max(0, start - hysteresisRows);
  let evictEnd = Math.min(count, end + hysteresisRows);

  // Hysteresis vs previous band: never shrink eviction while still inside it.
  const prev = input.previousWindow;
  if (prev && pages.hysteresis > 0 && count > 0) {
    const stillInside =
      focus >= prev.evictStart && focus < Math.max(prev.evictStart + 1, prev.evictEnd);
    if (stillInside) {
      evictStart = Math.min(evictStart, Math.max(0, prev.evictStart));
      evictEnd = Math.max(evictEnd, Math.min(count, prev.evictEnd));
    }
  }

  if (end < start) end = start;
  if (evictEnd < evictStart) evictEnd = evictStart;

  return {
    start,
    end,
    evictStart,
    evictEnd,
    pageSize,
    behind,
    ahead,
  };
}

export function slidingWindowChannelIds(
  channelIds: readonly string[],
  window: Pick<SlidingCacheWindow, "start" | "end">,
): string[] {
  if (!channelIds.length) return [];
  const start = Math.max(0, Math.min(channelIds.length, window.start));
  const end = Math.max(start, Math.min(channelIds.length, window.end));
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const id = channelIds[i];
    if (id) out.push(id);
  }
  return out;
}

/** IDs currently cached that fall outside the eviction band. */
export function idsOutsideSlidingWindow(
  cachedIds: Iterable<string>,
  keepIds: ReadonlySet<string>,
): string[] {
  const drop: string[] = [];
  for (const id of cachedIds) {
    if (!id) continue;
    if (!keepIds.has(id)) drop.push(id);
  }
  return drop;
}

export function slidingWindowKeepSet(
  channelIds: readonly string[],
  window: Pick<SlidingCacheWindow, "evictStart" | "evictEnd">,
): Set<string> {
  const keep = new Set<string>();
  if (!channelIds.length) return keep;
  const start = Math.max(0, Math.min(channelIds.length, window.evictStart));
  const end = Math.max(start, Math.min(channelIds.length, window.evictEnd));
  for (let i = start; i < end; i++) {
    const id = channelIds[i];
    if (id) keep.add(id);
  }
  return keep;
}

/** Build once per filtered playlist; reuse across half-page viewport buckets. */
export function buildChannelIndexMap(
  orderedChannelIds: readonly string[],
): Map<string, number> {
  const indexById = new Map<string, number>();
  for (let i = 0; i < orderedChannelIds.length; i++) {
    const id = orderedChannelIds[i];
    if (id && !indexById.has(id)) indexById.set(id, i);
  }
  return indexById;
}

/**
 * Expand a fetched runway with ±hysteresis pages so reverse surfing does not
 * immediately drop the page the user just left.
 */
/**
 * Cap a keep list around focus so blur / memory-pressure release does not keep
 * the head of an ascending ID list (which drops the focused neighborhood).
 */
export function pickKeepIdsAroundFocus(
  sourceIds: readonly string[],
  keepLimit: number,
  focusChannelId?: string | null,
): string[] {
  const limit = Math.max(0, Math.floor(keepLimit || 0));
  if (!sourceIds.length || limit <= 0) return [];
  if (sourceIds.length <= limit) return sourceIds.filter(Boolean);
  const focusIndex = focusChannelId ? sourceIds.indexOf(focusChannelId) : -1;
  if (focusIndex < 0) {
    // Prefer the middle of the warm runway over the playlist head.
    const start = Math.max(0, Math.floor((sourceIds.length - limit) / 2));
    return sourceIds.slice(start, start + limit).filter(Boolean);
  }
  const half = Math.floor(limit / 2);
  let start = Math.max(0, focusIndex - half);
  let end = start + limit;
  if (end > sourceIds.length) {
    end = sourceIds.length;
    start = Math.max(0, end - limit);
  }
  return sourceIds.slice(start, end).filter(Boolean);
}

export function expandRunwayKeepSet(
  orderedChannelIds: readonly string[],
  runwayIds: readonly string[],
  pageSize: number,
  hysteresisPages = 1,
  indexById?: ReadonlyMap<string, number>,
): Set<string> {
  const keep = new Set<string>();
  if (!orderedChannelIds.length || !runwayIds.length) {
    for (const id of runwayIds) if (id) keep.add(id);
    return keep;
  }
  const indexMap = indexById ?? buildChannelIndexMap(orderedChannelIds);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const id of runwayIds) {
    const index = indexMap.get(id);
    if (index == null) {
      keep.add(id);
      continue;
    }
    if (index < min) min = index;
    if (index > max) max = index;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return keep;
  const pad = Math.max(0, Math.floor(hysteresisPages) * Math.max(1, Math.floor(pageSize || 1)));
  const start = Math.max(0, min - pad);
  const end = Math.min(orderedChannelIds.length, max + 1 + pad);
  for (let i = start; i < end; i++) {
    const id = orderedChannelIds[i];
    if (id) keep.add(id);
  }
  return keep;
}
