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

// Guide route intent and overlay ownership are intentionally separate. Only
// applyGuideNavigationOwnership() writes the native flag, so drawer/modal state
// can never race an older Guide useFocusEffect and accidentally reactivate it.
let guideRouteWantsNavigation = false;
let guideNavigationSuppressed = false;
let lastAppliedGuideNavigation: boolean | null = null;

function applyGuideNavigationOwnership() {
  const active = guideRouteWantsNavigation && !guideNavigationSuppressed;
  if (lastAppliedGuideNavigation === active) return;
  lastAppliedGuideNavigation = active;
  try {
    TvRemote?.setGuideNavigationActive?.(active);
  } catch {}
}

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

/**
 * Register whether the mounted/focused Guide route wants native navigation.
 * Native ownership is still withheld whenever the global drawer/modal gate is
 * active.
 */
export function setGuideNavigationActive(active: boolean) {
  guideRouteWantsNavigation = !!active;
  applyGuideNavigationOwnership();
}

/**
 * Global overlay gate. The drawer/program sheet has exclusive D-pad ownership
 * while this is true, regardless of stale route effects or recycled Guide views.
 */
export function setGuideNavigationSuppressed(suppressed: boolean) {
  guideNavigationSuppressed = !!suppressed;
  applyGuideNavigationOwnership();
}

/** Configure the bounded held-key cadence used while the Guide route is active. */
export function setGuideRepeatInterval(milliseconds: number) {
  try {
    TvRemote?.setGuideRepeatInterval?.(Math.max(60, Math.min(120, milliseconds)));
  } catch {}
}

// Inject a real tap at screen coordinates (dp) so the element under the virtual
// cursor receives a normal onPress.
export function tap(x: number, y: number) {
  try {
    TvRemote?.tap?.(x, y);
  } catch {}
}
