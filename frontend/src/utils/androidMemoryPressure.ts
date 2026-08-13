import { DeviceEventEmitter, NativeModules, Platform } from "react-native";

export type AndroidMemoryPressure = "moderate" | "critical";

const ramEpgModule = NativeModules.CharmEpgRam as
  | { clearMemory?: () => Promise<boolean> }
  | undefined;

const listeners = new Set<(pressure: AndroidMemoryPressure) => void>();
let nativeSubscription: { remove: () => void } | null = null;

function ensureNativeSubscription(): void {
  if (nativeSubscription || Platform.OS !== "android") return;
  nativeSubscription = DeviceEventEmitter.addListener("CharmMemoryPressure", (raw: unknown) => {
    if (raw !== "moderate" && raw !== "critical") return;
    if (raw === "critical") {
      // One global native clear per Android event. Feature subscribers only trim
      // their own JS/logo/preview state and cannot duplicate this native work.
      void ramEpgModule?.clearMemory?.().catch(() => undefined);
    }
    for (const listener of Array.from(listeners)) listener(raw);
  });
}

export function subscribeAndroidMemoryPressure(
  listener: (pressure: AndroidMemoryPressure) => void,
): () => void {
  if (Platform.OS !== "android") return () => undefined;
  listeners.add(listener);
  ensureNativeSubscription();
  return () => listeners.delete(listener);
}
