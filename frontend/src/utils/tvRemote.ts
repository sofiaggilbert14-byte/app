import {
  NativeModules,
  NativeEventEmitter,
  DeviceEventEmitter,
  Platform,
  findNodeHandle,
} from "react-native";

// Native module injected by ./plugins/withTvRemote (Android only). Absent on web
// / iOS / Expo Go, in which case everything below is a safe no-op.
const TvRemote: any = Platform.OS === "android" ? NativeModules.TvRemote : null;

export const tvRemoteAvailable = !!TvRemote;

export type TvKey = "UP" | "DOWN" | "LEFT" | "RIGHT" | "SELECT" | "BACK";
export type TvFocusDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";

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

// Kept for native API compatibility. Do NOT arm this to consume Up/Down —
// Android must move guide focus; JS only handles top/bottom/left boundaries.
export function setGuideNavigationActive(active: boolean) {
  try {
    // Always clear — consuming vertical keys freezes Fire TV guide surfing.
    TvRemote?.setGuideNavigationActive?.(false);
    void active;
  } catch {}
}

// Ask Android's normal focus engine to move once in a direction. TimelineGrid
// uses this at its top boundary so Up exits naturally to the controls above it.
export function moveNativeFocus(direction: TvFocusDirection): boolean {
  try {
    if (!TvRemote?.moveFocus) return false;
    TvRemote.moveFocus(direction);
    return true;
  } catch {
    return false;
  }
}

// Request real Android input focus for a React host view or native tag.
export function focusNativeView(target: any): boolean {
  try {
    const candidate = target?.current ?? target;
    const tag = typeof candidate === "number" ? candidate : findNodeHandle(candidate);
    if (!tag) return false;
    TvRemote?.focusView?.(tag);
    return true;
  } catch {
    return false;
  }
}

// Inject a real tap at screen coordinates (dp) so the element under the virtual
// cursor receives a normal onPress.
export function tap(x: number, y: number) {
  try {
    TvRemote?.tap?.(x, y);
  } catch {}
}
