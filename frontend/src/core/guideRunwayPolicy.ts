export type GuideScanDirection = -1 | 1;

/** Keep an equal warm runway in both directions so reversing never cold-loads. */
export const GUIDE_PREFETCH_PAGES_AHEAD = 7;
export const GUIDE_PREFETCH_PAGES_BEHIND = 7;

type GuideRowIdentity = { id: string };

export type GuideRunwayPages = {
  ahead: number;
  behind: number;
};

/** Keep in sync with PROFILE_PAGES in guideSlidingCache.ts. */
const PROFILE_RUNWAY: Record<string, GuideRunwayPages> = {
  normal: { ahead: GUIDE_PREFETCH_PAGES_AHEAD, behind: GUIDE_PREFETCH_PAGES_BEHIND },
  weak: { ahead: GUIDE_PREFETCH_PAGES_AHEAD, behind: GUIDE_PREFETCH_PAGES_BEHIND },
  max_preview: { ahead: GUIDE_PREFETCH_PAGES_AHEAD, behind: GUIDE_PREFETCH_PAGES_BEHIND },
};

/** Resolve direction-aware runway page counts from the device power profile. */
export function guideRunwayPagesForProfile(
  profile: string | null | undefined,
): GuideRunwayPages {
  if (profile === "weak" || profile === "max_preview") return PROFILE_RUNWAY[profile];
  return PROFILE_RUNWAY.normal;
}

/**
 * Build a direction-aware EPG data runway in the exact order shown on screen.
 * Every power profile uses seven pages on both sides. Rows that leave this hard
 * keep set are discarded so memory cannot grow with playlist depth.
 */
export function buildGuideRunwayIds(
  rows: GuideRowIdentity[],
  focusedIndex: number,
  itemsPerPage: number,
  direction: GuideScanDirection,
  pages?: Partial<GuideRunwayPages> | string | null,
): string[] {
  if (!rows.length) return [];
  const resolved =
    typeof pages === "string" || pages == null
      ? guideRunwayPagesForProfile(pages)
      : {
          ahead: pages.ahead ?? GUIDE_PREFETCH_PAGES_AHEAD,
          behind: pages.behind ?? GUIDE_PREFETCH_PAGES_BEHIND,
        };
  const pageSize = Math.max(1, Math.floor(itemsPerPage));
  const safeIndex = Math.max(0, Math.min(rows.length - 1, Math.floor(focusedIndex)));
  const currentPageStart = Math.floor(safeIndex / pageSize) * pageSize;
  const beforePages = direction < 0 ? resolved.ahead : resolved.behind;
  const afterPages = direction < 0 ? resolved.behind : resolved.ahead;
  const start = Math.max(0, currentPageStart - beforePages * pageSize);
  const end = Math.min(rows.length, currentPageStart + (afterPages + 1) * pageSize);
  const ids: string[] = [];
  for (let index = start; index < end; index++) {
    const id = rows[index]?.id;
    if (id) ids.push(id);
  }
  return ids;
}
