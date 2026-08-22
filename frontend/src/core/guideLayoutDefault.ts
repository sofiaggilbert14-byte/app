import { Platform } from "react-native";

export type GuideLayout = "cinematic" | "compact";

/**
 * Timeline is the shipped default on every device. The explicit Device layout
 * preference controls TV vs Mobile chrome independently.
 */
export function defaultGuideLayoutForDevice(
  isTV: boolean = Platform.OS !== "web" && !!Platform.isTV,
  platformOS: typeof Platform.OS = Platform.OS,
): GuideLayout {
  void isTV;
  void platformOS;
  return "cinematic";
}

export function resolveStoredGuideLayout(
  stored: string | null | undefined,
  isTV?: boolean,
  platformOS?: typeof Platform.OS,
): GuideLayout {
  if (stored === "cinematic" || stored === "compact") return stored;
  return defaultGuideLayoutForDevice(isTV, platformOS);
}
