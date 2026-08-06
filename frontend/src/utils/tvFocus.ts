import { findNodeHandle, Platform, UIManager } from "react-native";

/** Request native TV focus on a React node (Pressable ref, View ref, etc.). */
export function requestNativeFocus(node: unknown): boolean {
  if (!node) return false;
  const handle = findNodeHandle(node as any);
  if (!handle) return false;
  if (Platform.isTV) {
    try {
      UIManager.focus?.(handle);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Retry focus a few times — virtualized lists often mount cells after the first frame. */
export function requestNativeFocusWithRetry(node: unknown, delaysMs = [0, 32, 96, 200]): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  delaysMs.forEach((delay) => {
    timers.push(
      setTimeout(() => {
        requestNativeFocus(node);
      }, delay),
    );
  });
  return () => timers.forEach(clearTimeout);
}
