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

  // TV manufacturers still ship sets with HDMI/overscan cropping enabled.
  // Use a title-safe style margin rather than assuming the reported Android
  // viewport reaches the visible panel edge. Wider panels get a little more
  // horizontal protection while 4:3-ish displays keep more usable space.
  const horizontalRatio = aspect >= 1.95 ? 0.0475 : aspect >= 1.68 ? 0.0425 : 0.0375;
  const verticalRatio = aspect >= 1.95 ? 0.04 : aspect >= 1.68 ? 0.0375 : 0.035;

  const horizontal = clamp(Math.round(safeWidth * horizontalRatio), 24, 64);
  const vertical = clamp(Math.round(safeHeight * verticalRatio), 18, 48);

  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  };
}
