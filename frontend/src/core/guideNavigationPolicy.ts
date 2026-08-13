export type GuideNavigationKey = "up" | "down" | "left" | "right" | string | undefined;
export type GuideFocusRegion = "channel" | "program";
export type GuideNavigationBoundary = "left-boundary" | "bottom-lock" | "top-boundary" | null;

export type GuideNavigationDecision = {
  axis: "vertical" | "horizontal" | null;
  boundary: GuideNavigationBoundary;
};

/** Keep imperative TV-focus scrolling inside real rendered content. */
export function clampGuideScrollOffset(
  offset: number,
  contentExtent: number,
  viewportExtent: number,
): number {
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const safeContent = Number.isFinite(contentExtent) ? Math.max(0, contentExtent) : 0;
  const safeViewport = Number.isFinite(viewportExtent) ? Math.max(0, viewportExtent) : 0;
  return Math.max(0, Math.min(Math.max(0, safeContent - safeViewport), safeOffset));
}

export function evaluateGuideNavigation(input: {
  active: boolean;
  key: GuideNavigationKey;
  gridOwnsFocus: boolean;
  focusRegion: GuideFocusRegion;
  focusedRow: number;
  lastRow: number;
}): GuideNavigationDecision {
  const { active, key, gridOwnsFocus, focusRegion } = input;
  if (!active) return { axis: null, boundary: null };

  const axis = key === "up" || key === "down"
    ? "vertical"
    : key === "left" || key === "right"
      ? "horizontal"
      : null;
  if (!axis) return { axis: null, boundary: null };

  if (key === "left" && gridOwnsFocus && focusRegion === "channel") {
    return { axis, boundary: "left-boundary" };
  }
  if (key === "down" && gridOwnsFocus && input.focusedRow >= input.lastRow) {
    return { axis, boundary: "bottom-lock" };
  }
  if (key === "up" && gridOwnsFocus && input.focusedRow <= 0) {
    return { axis, boundary: "top-boundary" };
  }
  return { axis, boundary: null };
}
