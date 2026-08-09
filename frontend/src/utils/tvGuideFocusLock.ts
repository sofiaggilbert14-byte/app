import { findNodeHandle } from "react-native";
import { requestNativeFocus, requestNativeFocusWithRetry } from "@/src/utils/tvFocus";

/**
 * Brief arm while the guide is on its last row and Down is held.
 * Sidebar Exit/Reset can reclaim into the guide if TV focus search leaks.
 */
let armedUntil = 0;
let armedNode: unknown = null;
let focusedGuideChannelId: string | null = null;
const guideChannelNodes = new Map<string, unknown>();
/** Stable auxiliary-panel target used when leaving the guide to the left. */
let guidePreviewEntryNode: unknown = null;
let cancelGuideRestoreTimers: (() => void) | null = null;

export function armGuideBottomFocusLock(node: unknown, ms = 500) {
  armedUntil = Date.now() + ms;
  if (node) {
    armedNode = node;
  }
}

export function cancelGuideFocusRestore(): void {
  const cancel = cancelGuideRestoreTimers;
  cancelGuideRestoreTimers = null;
  cancel?.();
}

export function reclaimGuideBottomFocusIfArmed(): boolean {
  if (Date.now() > armedUntil) return false;
  return requestNativeFocus(armedNode);
}

/**
 * Re-enter the guide from an auxiliary panel without relying on users knowing
 * a particular D-pad direction. Row/card refs register here as they mount.
 */
export function registerGuideChannelNode(channelId: string, node: unknown): void {
  if (!channelId) return;
  if (node) {
    guideChannelNodes.set(channelId, node);
    return;
  }
  guideChannelNodes.delete(channelId);
  // FlashList recycled the row that owned focus. Never retain its program/logo
  // host as a successful restoration target.
  if (focusedGuideChannelId === channelId) {
    cancelGuideFocusRestore();
    focusedGuideChannelId = null;
    armedNode = null;
    armedUntil = 0;
  }
}

/** Record a real focus event, never a merely mounted/recycled row. */
export function noteGuideChannelFocus(channelId: string, node: unknown): void {
  if (!channelId || !node) return;
  // A real native focus event proves restoration succeeded. Cancel every later
  // retry so it cannot yank focus back after the user moves to tabs/preview.
  cancelGuideFocusRestore();
  focusedGuideChannelId = channelId;
  if (!guideChannelNodes.has(channelId)) guideChannelNodes.set(channelId, node);
}

export function focusGuideSurface(channelId?: string | null): boolean {
  const target =
    (channelId ? guideChannelNodes.get(channelId) : undefined) ||
    (focusedGuideChannelId ? guideChannelNodes.get(focusedGuideChannelId) : undefined);
  if (!target) return false;
  cancelGuideFocusRestore();
  cancelGuideRestoreTimers = requestNativeFocusWithRetry(target, [0, 40, 120, 240]);
  return true;
}

/** Register the preview/actions panel's stable entry control. */
export function registerGuidePreviewEntry(node: unknown): void {
  guidePreviewEntryNode = node || null;
}

/** Move focus from the guide's left boundary into the preview/actions panel. */
export function focusGuidePreviewSurface(): boolean {
  if (!guidePreviewEntryNode) return false;
  cancelGuideFocusRestore();
  // Preview controls are permanently mounted; retrying after focus has moved on
  // only creates a delayed focus yank.
  return requestNativeFocus(guidePreviewEntryNode);
}

/** Pin Left on guide cells so D-pad Left never unexpectedly opens the drawer. */
export function applyLeftFocusLock(node: any, locked: boolean) {
  if (!node) return;
  const handle = findNodeHandle(node);
  if (!handle) return;
  try {
    node.setNativeProps?.({ nextFocusLeft: locked ? handle : -1 });
  } catch {
    /* native props optional on web */
  }
}

export function armGuideLeftFocusLock(node: unknown, ms = 400) {
  applyLeftFocusLock(node, true);
  if (node) requestNativeFocus(node);
  if (ms > 0) {
    setTimeout(() => applyLeftFocusLock(node, true), ms);
  }
}
