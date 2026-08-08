import { Platform } from "react-native";
import type { TvCalibration } from "@/src/tvCalibration";

export type DeviceLayoutMode = "auto" | "tv" | "mobile";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Resolve whether TV safe insets / living-room layout should apply. */
export function shouldUseTvLayout(mode: DeviceLayoutMode = "auto"): boolean {
  if (mode === "tv") return true;
  if (mode === "mobile") return false;
  return Platform.OS !== "web" && !!Platform.isTV;
}

/**
 * Light automatic overscan padding — large enough for typical Fire TV crop,
 * small enough that a 65" panel still feels full-bleed. Manual calibration
 * (TvCalibration) adds/subtracts from these values in one place.
 */
export function getTvSafeInsets(
  width: number,
  height: number,
  mode: DeviceLayoutMode = "auto",
) {
  if (!shouldUseTvLayout(mode)) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const shortSide = Math.max(1, Math.min(width, height));
  const longSide = Math.max(width, height);
  // Previously up to 34/44 — that permanently letterboxed large TVs.
  const vertical = clamp(Math.round(shortSide * 0.012), 4, 16);
  const horizontal = clamp(Math.round(longSide * 0.008), 6, 20);

  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  };
}

/**
 * Combine automatic safe insets with user calibration.
 * Positive calibration = inset more (shrink). Negative = reduce inset toward 0,
 * then use negative margin to expand past the reported window when needed.
 */
export function combineTvEdgeInsets(
  safe: { top: number; right: number; bottom: number; left: number },
  calibration: TvCalibration,
): {
  padding: { top: number; right: number; bottom: number; left: number };
  margin: { top: number; right: number; bottom: number; left: number };
} {
  const merge = (safeEdge: number, cal: number) => {
    const combined = safeEdge + cal;
    return {
      padding: Math.max(0, combined),
      margin: Math.min(0, combined),
    };
  };
  const top = merge(safe.top, calibration.top);
  const right = merge(safe.right, calibration.right);
  const bottom = merge(safe.bottom, calibration.bottom);
  const left = merge(safe.left, calibration.left);
  return {
    padding: { top: top.padding, right: right.padding, bottom: bottom.padding, left: left.padding },
    margin: { top: top.margin, right: right.margin, bottom: bottom.margin, left: left.margin },
  };
}
