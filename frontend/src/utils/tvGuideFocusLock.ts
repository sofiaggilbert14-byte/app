import { findNodeHandle } from "react-native";
import { requestNativeFocus } from "@/src/utils/tvFocus";

/**
 * Brief arm while the guide is on its last row and Down is held.
 * Sidebar Exit/Reset can reclaim into the guide if TV focus search leaks.
 */
let armedUntil = 0;
let armedNode: unknown = null;
let focusedGuideChannelId: string | null = null;

type GuideChannelEntry = {
  node: unknown;
  /** Left from this node should land on Play in the preview/actions rail. */
  handOffLeftToPreview: boolean;
};

const guideChannelNodes = new Map<string, GuideChannelEntry>();
/** Stable auxiliary-panel target used when leaving the guide to the left. */
let guidePreviewEntryNode: unknown = null;
let cancelGuideRestoreTimers: (() => void) | null = null;
let previewFocusAttempt = 0;
let previewFocusTimers: ReturnType<typeof setTimeout>[] = [];

function cancelPreviewFocusAttempts(): void {
  previewFocusAttempt += 1;
  for (const timer of previewFocusTimers) clearTimeout(timer);
  previewFocusTimers = [];
}

function previewFocusHandle(): number | null {
  return findNodeHandle(guidePreviewEntryNode as any) || null;
}

function wireChannelLeftFocus(entry: GuideChannelEntry): void {
  if (!entry.handOffLeftToPreview || !entry.node) return;
  applyLeftFocusLock(entry.node, false);
}

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
export function registerGuideChannelNode(
  channelId: string,
  node: unknown,
  options?: { handOffLeftToPreview?: boolean },
): void {
  if (!channelId) return;
  if (node) {
    const entry: GuideChannelEntry = {
      node,
      handOffLeftToPreview: !!options?.handOffLeftToPreview,
    };
    guideChannelNodes.set(channelId, entry);
    wireChannelLeftFocus(entry);
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
  cancelPreviewFocusAttempts();
  focusedGuideChannelId = channelId;
  const existing = guideChannelNodes.get(channelId);
  if (!existing) {
    guideChannelNodes.set(channelId, { node, handOffLeftToPreview: false });
  } else if (existing.node !== node) {
    existing.node = node;
    wireChannelLeftFocus(existing);
  } else {
    // Re-assert Left → Play after recycle; preview may have mounted later.
    wireChannelLeftFocus(existing);
  }
}

export function focusGuideSurface(channelId?: string | null): boolean {
  return focusGuideSurfaceWhenMounted(channelId, [0, 40, 120, 240]);
}

/** Resolve the current recycled row on every attempt, not a stale native ref. */
export function focusGuideSurfaceWhenMounted(
  channelId?: string | null,
  delays: number[] = [0, 40, 120, 240],
): boolean {
  cancelPreviewFocusAttempts();
  cancelGuideFocusRestore();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  let found = false;
  const tryCurrentRow = () => {
    if (cancelled) return;
    const entry =
      (channelId ? guideChannelNodes.get(channelId) : undefined) ||
      (!channelId && focusedGuideChannelId
        ? guideChannelNodes.get(focusedGuideChannelId)
        : undefined);
    const target = entry?.node;
    if (!target) return;
    found = requestNativeFocus(target) || found;
  };
  for (const rawDelay of delays) {
    const delay = Math.max(0, rawDelay);
    if (delay === 0) tryCurrentRow();
    else timers.push(setTimeout(tryCurrentRow, delay));
  }
  cancelGuideRestoreTimers = () => {
    cancelled = true;
    for (const timer of timers) clearTimeout(timer);
  };
  return found || timers.length > 0;
}

/** Register the preview/actions panel's stable entry control. */
export function registerGuidePreviewEntry(node: unknown): void {
  guidePreviewEntryNode = node || null;
  const targetHandle = previewFocusHandle();
  if (!targetHandle) return;
  // Keep Android's native focus graph deterministic as FlashList recycles rows:
  // Left from opted-in left-edge channel targets goes directly to Play.
  for (const entry of guideChannelNodes.values()) {
    if (!entry.handOffLeftToPreview) continue;
    try {
      (entry.node as any)?.setNativeProps?.({ nextFocusLeft: targetHandle });
    } catch {
      // Native focus props are optional on web.
    }
  }
}

/** A real preview-button focus cancels any queued boundary retry. */
export function noteGuidePreviewFocus(): void {
  cancelGuideFocusRestore();
  cancelPreviewFocusAttempts();
}

/** Move focus from the guide's left boundary into the preview/actions panel. */
export function focusGuidePreviewSurface(): boolean {
  if (!guidePreviewEntryNode) return false;
  cancelGuideFocusRestore();
  cancelPreviewFocusAttempts();
  const attempt = previewFocusAttempt;
  const requestCurrentEntry = () => {
    if (attempt !== previewFocusAttempt || !guidePreviewEntryNode) return;
    requestNativeFocus(guidePreviewEntryNode);
  };
  requestCurrentEntry();
  // Android TV occasionally runs focus-search before the sibling Pressable is
  // ready. Resolve the current ref on every retry and cancel as soon as any
  // preview control receives real focus, preventing delayed focus yanks.
  previewFocusTimers = [16, 48, 96, 180, 320].map((delay) =>
    setTimeout(requestCurrentEntry, delay),
  );
  return true;
}

/** Pin Left on guide cells so D-pad Left never unexpectedly opens the drawer. */
export function applyLeftFocusLock(node: any, locked: boolean) {
  if (!node) return;
  const handle = findNodeHandle(node);
  if (!handle) return;
  const previewHandle = !locked ? previewFocusHandle() : null;
  try {
    node.setNativeProps?.({ nextFocusLeft: locked ? handle : previewHandle || -1 });
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
