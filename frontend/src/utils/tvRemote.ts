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
let focusAckGeneration = 0;
let focusAckTimer: ReturnType<typeof setTimeout> | null = null;
let guideFocusSyncEnabled = false;

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

/** Dedicated Channel/Page buttons; ordinary D-pad arrows never emit here. */
export function addGuidePageKeyListener(cb: (key: "UP" | "DOWN") => void): () => void {
  const eventName = "TvGuidePageKey";
  if (emitter) {
    const sub = emitter.addListener(eventName, (key: "UP" | "DOWN") => cb(key));
    return () => sub.remove();
  }
  const sub = DeviceEventEmitter.addListener(eventName, (key: "UP" | "DOWN") => cb(key));
  return () => sub.remove();
}

/** Avoid duplicating every Guide D-pad repeat across the JS bridge. */
export function setGuideNavigationActive(active: boolean) {
  try {
    TvRemote?.setGuideNavigationActive?.(active);
  } catch {}
}

/** Enable the one-move-at-a-time native gate only while a Guide cell owns focus. */
export function setGuideFocusSyncActive(active: boolean) {
  if (guideFocusSyncEnabled === active) return;
  guideFocusSyncEnabled = active;
  focusAckGeneration += 1;
  if (focusAckTimer) clearTimeout(focusAckTimer);
  focusAckTimer = null;
  try {
    TvRemote?.setGuideFocusSyncActive?.(active);
  } catch {}
}

/** Configure the fastest accepted held-key cadence; native focus readiness can slow it further. */
export function setGuideRepeatInterval(milliseconds: number) {
  try {
    TvRemote?.setGuideRepeatInterval?.(Math.max(60, Math.min(120, milliseconds)));
  } catch {}
}

/**
 * Release the next held-key movement only after the focused native cell and its
 * scroll offset have had a frame to paint. Loading EPG shells get one extra
 * frame so the Guide runway can advance without ever queueing invisible moves.
 */
export function acknowledgeGuideFocusAfterPaint(epgReady = true) {
  const generation = ++focusAckGeneration;
  if (focusAckTimer) clearTimeout(focusAckTimer);
  const acknowledge = () => {
    if (generation !== focusAckGeneration) return;
    focusAckTimer = null;
    requestAnimationFrame(() => {
      if (generation !== focusAckGeneration) return;
      try {
        TvRemote?.acknowledgeGuideFocusMove?.();
      } catch {}
    });
  };
  if (epgReady) acknowledge();
  else focusAckTimer = setTimeout(acknowledge, 48);
}

// Inject a real tap at screen coordinates (dp) so the element under the virtual
// cursor receives a normal onPress.
export function tap(x: number, y: number) {
  try {
    TvRemote?.tap?.(x, y);
  } catch {}
}
