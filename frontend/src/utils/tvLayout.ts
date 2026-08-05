import { Platform } from "react-native";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getTvSafeInsets(width: number, height: number) {
  if (Platform.OS === "web" || !Platform.isTV) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  // Restore the smaller pre-auto-detection TV margins. These protect basic
  // edge readability without forcing a large title-safe box around the app.
  const shortSide = Math.max(1, Math.min(width, height));
  const longSide = Math.max(width, height);
  const vertical = clamp(Math.round(shortSide * 0.025), 14, 34);
  const horizontal = clamp(Math.round(longSide * 0.018), 18, 44);

  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  };
}
