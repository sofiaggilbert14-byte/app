import { findNodeHandle } from "react-native";
import { requestNativeFocus, requestNativeFocusWithRetry } from "@/src/utils/tvFocus";

/**
 * Brief arm while the guide is on its last row and Down is held.
 * Sidebar Exit/Reset can reclaim into the guide if TV focus search leaks.
 */
let armedUntil = 0;
let armedNode: unknown = null;
/** Stable entry target used by the preview rail's explicit Guide action. */
let guideEntryNode: unknown = null;

export function armGuideBottomFocusLock(node: unknown, ms = 500) {
  armedUntil = Date.now() + ms;
  if (node) {
    armedNode = node;
    guideEntryNode = node;
  }
}

export function clearGuideBottomFocusLock() {
  armedUntil = 0;
}

export function reclaimGuideBottomFocusIfArmed(): boolean {
  if (Date.now() > armedUntil) return false;
  return requestNativeFocus(armedNode);
}

/**
 * Re-enter the guide from an auxiliary panel without relying on users knowing
 * a particular D-pad direction. Row/card refs register here as they mount.
 */
export function focusGuideSurface(): boolean {
  if (!guideEntryNode) return false;
  requestNativeFocusWithRetry(guideEntryNode, [0, 40, 120, 240]);
  return true;
}

/** Pin Left on guide cells so D-pad Left never unexpectedly opens the drawer. */
export function applyLeftFocusLock(node: any, locked: boolean) {
  if (!node) return;
  const handle = findNodeHandle(node);
  if (!handle) return;
  if (locked) guideEntryNode = node;
  try {
    node.setNativeProps?.({ nextFocusLeft: locked ? handle : -1 });
  } catch {
    /* native props optional on web */
  }
}

export function armGuideLeftFocusLock(node: unknown, ms = 400) {
  if (node) guideEntryNode = node;
  applyLeftFocusLock(node, true);
  if (node) requestNativeFocus(node);
  if (ms > 0) {
    setTimeout(() => applyLeftFocusLock(node, true), ms);
  }
}
