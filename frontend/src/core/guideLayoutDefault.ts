import { Platform } from "react-native";

export type GuideLayout = "cinematic" | "compact";

/**
 * Phones/tablets should open the block (Mobile) guide. Living-room TV builds
 * keep the Timeline guide unless the user explicitly switches.
 */
export function defaultGuideLayoutForDevice(
  isTV: boolean = Platform.OS !== "web" && !!Platform.isTV,
  platformOS: typeof Platform.OS = Platform.OS,
): GuideLayout {
  if (platformOS === "web") return "cinematic";
  return isTV ? "cinematic" : "compact";
}

export function resolveStoredGuideLayout(
  stored: string | null | undefined,
  isTV?: boolean,
  platformOS?: typeof Platform.OS,
): GuideLayout {
  if (stored === "cinematic" || stored === "compact") return stored;
  return defaultGuideLayoutForDevice(isTV, platformOS);
}
