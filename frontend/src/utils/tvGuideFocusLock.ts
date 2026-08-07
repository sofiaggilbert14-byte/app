import { requestNativeFocus } from "@/src/utils/tvFocus";

/**
 * Brief arm while the guide is on its last row and Down is held.
 * Sidebar Exit/Reset can reclaim into the guide if Fire TV focus search leaks.
 */
let armedUntil = 0;
let armedNode: unknown = null;

export function armGuideBottomFocusLock(node: unknown, ms = 500) {
  armedUntil = Date.now() + ms;
  if (node) armedNode = node;
}

export function clearGuideBottomFocusLock() {
  armedUntil = 0;
}

export function reclaimGuideBottomFocusIfArmed(): boolean {
  if (Date.now() > armedUntil) return false;
  return requestNativeFocus(armedNode);
}
