import {
  NativeModules,
  NativeEventEmitter,
  DeviceEventEmitter,
  Platform,
} from "react-native";

// Native module injected by ./plugins/withTvRemote (Android only). Absent on web
// / iOS / Expo Go, in which case everything below is a safe no-op.
const TvRemote: any = Platform.OS === "android" ? NativeModules.TvRemote : null;

export const tvRemoteAvailable = !!TvRemote;

export type TvKey = "UP" | "DOWN" | "LEFT" | "RIGHT" | "SELECT" | "BACK";

const emitter = TvRemote ? new NativeEventEmitter(TvRemote) : null;

// Subscribe to D-pad key presses forwarded from the native Activity.
export function addTvKeyListener(cb: (key: TvKey) => void): () => void {
  if (emitter) {
    const sub = emitter.addListener("TvRemoteKey", (k: TvKey) => cb(k));
    return () => sub.remove();
  }
  // Fallback for older RN event delivery
  const sub = DeviceEventEmitter.addListener("TvRemoteKey", (k: TvKey) => cb(k));
  return () => sub.remove();
}

// Tell native whether pointer mode is active. When active, native consumes the
// D-pad keys (so the OS focus engine doesn't also move) and forwards them to JS.
export function setPointerActive(active: boolean) {
  try {
    TvRemote?.setPointerActive?.(active);
  } catch {}
}

/** Avoid duplicating every Guide D-pad repeat across the JS bridge. */
export function setGuideNavigationActive(active: boolean) {
  try {
    TvRemote?.setGuideNavigationActive?.(active);
  } catch {}
}

// Inject a real tap at screen coordinates (dp) so the element under the virtual
// cursor receives a normal onPress.
export function tap(x: number, y: number) {
  try {
    TvRemote?.tap?.(x, y);
  } catch {}
}
