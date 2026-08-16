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
export type TvLongPressKey = "DOWN" | "SELECT" | "BACK";
export type DeviceMemoryProfile = { memoryClassMb: number; lowRamDevice: boolean };
export type CacheStorageReport = { logoDiskBytes: number; cacheDiskBytes: number; databaseBytes: number; totalDiskBytes: number };

const emitter = TvRemote ? new NativeEventEmitter(TvRemote) : null;

// Subscribe to D-pad key presses forwarded from the native Activity.
export function addTvLongPressListener(cb: (key: TvLongPressKey) => void): () => void {
  const eventName = "TvRemoteLongPress";
  if (emitter) {
    const sub = emitter.addListener(eventName, (key: TvLongPressKey) => cb(key));
    return () => sub.remove();
  }
  const sub = DeviceEventEmitter.addListener(eventName, (key: TvLongPressKey) => cb(key));
  return () => sub.remove();
}

export async function getDeviceMemoryProfile(): Promise<DeviceMemoryProfile | null> {
  try {
    if (!TvRemote?.getDeviceMemoryProfile) return null;
    const raw = await TvRemote.getDeviceMemoryProfile();
    return {
      memoryClassMb: Number(raw?.memoryClassMb) || 0,
      lowRamDevice: !!raw?.lowRamDevice,
    };
  } catch {
    return null;
  }
}

export async function getCacheStorageReport(): Promise<CacheStorageReport | null> {
  try {
    if (!TvRemote?.getCacheStorageReport) return null;
    const raw = await TvRemote.getCacheStorageReport();
    return {
      logoDiskBytes: Number(raw?.logoDiskBytes) || 0,
      cacheDiskBytes: Number(raw?.cacheDiskBytes) || 0,
      databaseBytes: Number(raw?.databaseBytes) || 0,
      totalDiskBytes: Number(raw?.totalDiskBytes) || 0,
    };
  } catch { return null; }
}

export async function pruneDiskCaches(maxAgeDays = 14): Promise<{ removedFiles: number; removedBytes: number } | null> {
  try {
    if (!TvRemote?.pruneDiskCaches) return null;
    const raw = await TvRemote.pruneDiskCaches(maxAgeDays);
    return { removedFiles: Number(raw?.removedFiles) || 0, removedBytes: Number(raw?.removedBytes) || 0 };
  } catch { return null; }
}

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

/** Configure the bounded held-key cadence used while the Guide route is active. */
export function setGuideRepeatInterval(milliseconds: number) {
  try {
    TvRemote?.setGuideRepeatInterval?.(Math.max(60, Math.min(120, milliseconds)));
  } catch {}
}

export function setNativePlaybackStarting(starting: boolean) {
  try { TvRemote?.setPlaybackStarting?.(starting); } catch {}
}

// Inject a real tap at screen coordinates (dp) so the element under the virtual
// cursor receives a normal onPress.
export function tap(x: number, y: number) {
  try {
    TvRemote?.tap?.(x, y);
  } catch {}
}
