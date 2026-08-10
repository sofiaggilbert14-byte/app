import { DeviceEventEmitter, Platform } from "react-native";
import type { VerticalDpadKey } from "@/src/core/dpadDoubleTap";

export function subscribeVerticalDpadTaps(
  listener: (key: VerticalDpadKey) => void,
): () => void {
  if (Platform.OS !== "android") return () => undefined;
  const subscription = DeviceEventEmitter.addListener("TvDpadTap", (raw: unknown) => {
    if (raw === "UP" || raw === "DOWN") listener(raw);
  });
  return () => subscription.remove();
}
