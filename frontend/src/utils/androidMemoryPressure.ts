import { DeviceEventEmitter, Platform } from "react-native";

export type AndroidMemoryPressure = "moderate" | "critical";

export function subscribeAndroidMemoryPressure(
  listener: (pressure: AndroidMemoryPressure) => void,
): () => void {
  if (Platform.OS !== "android") return () => undefined;
  const subscription = DeviceEventEmitter.addListener("CharmMemoryPressure", (raw: unknown) => {
    if (raw === "moderate" || raw === "critical") listener(raw);
  });
  return () => subscription.remove();
}
