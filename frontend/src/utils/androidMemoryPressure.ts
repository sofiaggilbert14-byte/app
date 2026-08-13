import { DeviceEventEmitter, NativeModules, Platform } from "react-native";

export type AndroidMemoryPressure = "moderate" | "critical";

const ramEpgModule = NativeModules.CharmEpgRam as
  | { clearMemory?: () => Promise<boolean> }
  | undefined;

export function subscribeAndroidMemoryPressure(
  listener: (pressure: AndroidMemoryPressure) => void,
): () => void {
  if (Platform.OS !== "android") return () => undefined;
  const subscription = DeviceEventEmitter.addListener("CharmMemoryPressure", (raw: unknown) => {
    if (raw !== "moderate" && raw !== "critical") return;
    if (raw === "critical") {
      // The full native EPG snapshot is intentionally expendable. SQLite keeps
      // the last-good guide, so release RAM before JS rows/logos trim and let
      // later Guide reads fall back to disk rather than risk an Android OOM/LMK.
      void ramEpgModule?.clearMemory?.().catch(() => undefined);
    }
    listener(raw);
  });
  return () => subscription.remove();
}
