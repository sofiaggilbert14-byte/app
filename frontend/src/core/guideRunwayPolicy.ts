export type GuideScanDirection = -1 | 1;

/** Held Down surfing outruns a 5-page runway on large playlists; keep 8 ahead. */
export const GUIDE_PREFETCH_PAGES_AHEAD = 8;
export const GUIDE_PREFETCH_PAGES_BEHIND = 2;

type GuideRowIdentity = { id: string };

/**
 * Build a direction-aware EPG data runway in the exact order shown on screen.
 * The focused page plus eight pages ahead are kept ready; two pages behind make
 * a rapid direction reversal instant. Previously loaded rows remain in the
 * bounded caches and are not discarded when this window advances.
 */
export function buildGuideRunwayIds(
  rows: GuideRowIdentity[],
  focusedIndex: number,
  itemsPerPage: number,
  direction: GuideScanDirection,
): string[] {
  if (!rows.length) return [];
  const pageSize = Math.max(1, Math.floor(itemsPerPage));
  const safeIndex = Math.max(0, Math.min(rows.length - 1, Math.floor(focusedIndex)));
  const currentPageStart = Math.floor(safeIndex / pageSize) * pageSize;
  const beforePages = direction < 0 ? GUIDE_PREFETCH_PAGES_AHEAD : GUIDE_PREFETCH_PAGES_BEHIND;
  const afterPages = direction < 0 ? GUIDE_PREFETCH_PAGES_BEHIND : GUIDE_PREFETCH_PAGES_AHEAD;
  const start = Math.max(0, currentPageStart - beforePages * pageSize);
  const end = Math.min(rows.length, currentPageStart + (afterPages + 1) * pageSize);
  const ids: string[] = [];
  for (let index = start; index < end; index++) {
    const id = rows[index]?.id;
    if (id) ids.push(id);
  }
  return ids;
}
