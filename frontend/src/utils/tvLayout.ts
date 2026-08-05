import { Platform } from "react-native";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getTvSafeInsets(width: number, height: number) {
  if (Platform.OS === "web" || !Platform.isTV) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const aspect = Math.max(safeWidth, safeHeight) / Math.min(safeWidth, safeHeight);

  // Android TV recommends keeping important content about 5% inside the panel
  // edges. Scale that safe zone from the actual reported app window instead of
  // hard-coding a 1080p layout. Very wide displays get a small extra horizontal
  // guard while more square displays retain slightly more usable space.
  const horizontalRatio = aspect >= 2.0 ? 0.055 : aspect >= 1.6 ? 0.05 : 0.045;
  const verticalRatio = aspect >= 2.0 ? 0.05 : aspect >= 1.6 ? 0.05 : 0.045;

  const horizontal = clamp(Math.round(safeWidth * horizontalRatio), 28, 72);
  const vertical = clamp(Math.round(safeHeight * verticalRatio), 20, 54);

  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  };
}
