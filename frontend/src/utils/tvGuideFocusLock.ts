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
let focusedGuideChannelId: string | null = null;
const guideChannelNodes = new Map<string, unknown>();
/** Stable auxiliary-panel target used when leaving the guide to the left. */
let guidePreviewEntryNode: unknown = null;

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
export function registerGuideChannelNode(channelId: string, node: unknown): void {
  if (!channelId) return;
  if (node) guideChannelNodes.set(channelId, node);
  else guideChannelNodes.delete(channelId);
}

/** Record a real focus event, never a merely mounted/recycled row. */
export function noteGuideChannelFocus(channelId: string, node: unknown): void {
  if (!channelId || !node) return;
  focusedGuideChannelId = channelId;
  guideEntryNode = node;
  if (!guideChannelNodes.has(channelId)) guideChannelNodes.set(channelId, node);
}

export function focusGuideSurface(channelId?: string | null): boolean {
  const target =
    (channelId ? guideChannelNodes.get(channelId) : undefined) ||
    (focusedGuideChannelId ? guideChannelNodes.get(focusedGuideChannelId) : undefined) ||
    guideEntryNode;
  if (!target) return false;
  requestNativeFocusWithRetry(target, [0, 40, 120, 240]);
  return true;
}

/** Register the preview/actions panel's stable entry control. */
export function registerGuidePreviewEntry(node: unknown): void {
  guidePreviewEntryNode = node || null;
}

/** Move focus from the guide's left boundary into the preview/actions panel. */
export function focusGuidePreviewSurface(): boolean {
  if (!guidePreviewEntryNode) return false;
  requestNativeFocusWithRetry(guidePreviewEntryNode, [0, 40, 120, 240]);
  return true;
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
  if (node) guideEntryNode = node;
  applyLeftFocusLock(node, true);
  if (node) requestNativeFocus(node);
  if (ms > 0) {
    setTimeout(() => applyLeftFocusLock(node, true), ms);
  }
}
