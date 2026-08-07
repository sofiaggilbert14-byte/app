export type GuideDensity = "large" | "normal" | "compact";

export const CHANNEL_NAME_MAX_LINES = 2;

export type GuideRailMetrics = {
  rowHeight: number;
  railWidth: number;
  logoSize: number;
  numberWidth: number;
  nameFontSize: number;
  nameLineHeight: number;
  horizontalPadding: number;
  itemGap: number;
  minimumNameWidth: number;
};

export function getGuideRailMetrics(
  screenWidth: number,
  density: GuideDensity,
  showChannelNumbers: boolean,
  showChannelLogos: boolean,
): GuideRailMetrics {
  const big = screenWidth >= 900;
  const rowHeight = big
    ? density === "large" ? 72 : density === "compact" ? 56 : 64
    : density === "large" ? 66 : density === "compact" ? 52 : 60;
  const logoSize = big
    ? density === "large" ? 42 : density === "compact" ? 32 : 38
    : density === "large" ? 36 : density === "compact" ? 28 : 32;
  const numberWidth = big ? 32 : 27;
  const horizontalPadding = big ? 8 : 6;
  const itemGap = big ? 7 : 5;
  const nameFontSize = big
    ? density === "compact" ? 10.5 : 11.5
    : density === "compact" ? 9.5 : 10.5;
  const nameLineHeight = Number((nameFontSize * 1.22).toFixed(1));
  const minimumNameWidth = big ? 116 : 88;
  const visibleItems = Number(showChannelNumbers) + Number(showChannelLogos) + 1;
  const reserved =
    horizontalPadding * 2 +
    (showChannelNumbers ? numberWidth : 0) +
    (showChannelLogos ? logoSize : 0) +
    Math.max(0, visibleItems - 1) * itemGap;
  const railWidth = reserved + minimumNameWidth;

  return {
    rowHeight,
    railWidth,
    logoSize,
    numberWidth,
    nameFontSize,
    nameLineHeight,
    horizontalPadding,
    itemGap,
    minimumNameWidth,
  };
}

export function getGuideRailNameWidth(
  metrics: GuideRailMetrics,
  showChannelNumbers: boolean,
  showChannelLogos: boolean,
): number {
  const visibleItems = Number(showChannelNumbers) + Number(showChannelLogos) + 1;
  return metrics.railWidth -
    metrics.horizontalPadding * 2 -
    (showChannelNumbers ? metrics.numberWidth : 0) -
    (showChannelLogos ? metrics.logoSize : 0) -
    Math.max(0, visibleItems - 1) * metrics.itemGap;
}
