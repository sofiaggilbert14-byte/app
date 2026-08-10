/**
 * Sliding programme-cache window for TV guide surfing.
 *
 * Keep roughly N pages behind and M pages ahead of focus. Evict only channels
 * that leave an expanded hysteresis band so reversing mid-hold does not thrash.
 * Prefer ahead while holding Down; prefer behind while holding Up.
 */

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
  // Default: 2 pages back, 5 pages ahead.
  normal: { behind: 2, ahead: 5, hysteresis: 1 },
  // Weak sticks: tighter runway, still directional.
  weak: { behind: 1, ahead: 3, hysteresis: 1 },
  max_preview: { behind: 2, ahead: 6, hysteresis: 1 },
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
 * Compute the fetch window around focus, then a wider eviction band.
 * Directional stretch: Down adds +1 page ahead; Up adds +1 page behind.
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
  const direction = input.direction || "none";

  let behind = pages.behind;
  let ahead = pages.ahead;
  if (direction === "down") ahead += 1;
  if (direction === "up") behind += 1;

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
  if (prev && count > 0) {
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
