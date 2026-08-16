import { DeviceEventEmitter, Platform } from "react-native";

export type AndroidMemoryPressure = "background" | "moderate" | "critical";

export function subscribeAndroidMemoryPressure(
  listener: (pressure: AndroidMemoryPressure) => void,
): () => void {
  if (Platform.OS !== "android") return () => undefined;
  const subscription = DeviceEventEmitter.addListener("CharmMemoryPressure", (raw: unknown) => {
    if (raw !== "background" && raw !== "moderate" && raw !== "critical") return;
    // Native EPG RAM subscribes directly to CharmMemoryCoordinator. Keeping
    // this event side-effect free prevents one native clear per JS subscriber.
    listener(raw);
  });
  return () => subscription.remove();
}
