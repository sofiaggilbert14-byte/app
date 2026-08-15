export const GUIDE_WINDOW_HOUR_OPTIONS = [6, 8, 12, 14, 16] as const;

export type GuideWindowHours = (typeof GUIDE_WINDOW_HOUR_OPTIONS)[number];

export const DEFAULT_GUIDE_WINDOW_HOURS: GuideWindowHours = 8;

const allowed = new Set<number>(GUIDE_WINDOW_HOUR_OPTIONS);

/** Resolve persisted/build values and migrate the retired 24-hour experiment. */
export function resolveGuideWindowHours(
  value: string | number | null | undefined,
  fallback: GuideWindowHours = DEFAULT_GUIDE_WINDOW_HOURS,
): GuideWindowHours {
  const parsed = Number(value ?? fallback);
  if (allowed.has(parsed)) return parsed as GuideWindowHours;
  if (parsed === 24) return 16;
  return fallback;
}
