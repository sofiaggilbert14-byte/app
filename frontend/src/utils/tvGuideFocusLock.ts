import { findNodeHandle } from "react-native";
import { requestNativeFocus } from "@/src/utils/tvFocus";

/**
 * Brief arm while the guide is on its last row and Down is held.
 * Sidebar Exit/Reset can reclaim into the guide if TV focus search leaks.
 */
let armedUntil = 0;
let armedNode: unknown = null;
let focusedGuideChannelId: string | null = null;
let activeGuideFocusNode: unknown = null;

type GuideChannelEntry = {
  node: unknown;
  /** Left from this node should land on Play in the preview/actions rail. */
  handOffLeftToPreview: boolean;
};

const guideChannelNodes = new Map<string, GuideChannelEntry>();
const guideProgramNodes = new Map<string, unknown>();
/** Stable auxiliary-panel target used when leaving the guide to the left. */
let guidePreviewEntryNode: unknown = null;
let guidePreviewPreferredNode: unknown = null;
const guidePreviewNodes = new Map<string, unknown>();
let guideTopEntryNode: unknown = null;
let cancelGuideRestoreTimers: (() => void) | null = null;
let previewFocusAttempt = 0;
let previewFocusTimers: ReturnType<typeof setTimeout>[] = [];
const leftFocusLockTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

function cancelDelayedLeftFocusLock(node: unknown): void {
  if ((typeof node !== "object" && typeof node !== "function") || node === null) return;
  const key = node as object;
  const timer = leftFocusLockTimers.get(key);
  if (timer) clearTimeout(timer);
  leftFocusLockTimers.delete(key);
}

function cancelPreviewFocusAttempts(): void {
  previewFocusAttempt += 1;
  for (const timer of previewFocusTimers) clearTimeout(timer);
  previewFocusTimers = [];
}

function previewFocusHandle(): number | null {
  return findNodeHandle((guidePreviewEntryNode || guidePreviewPreferredNode) as any) || null;
}

function activeGuideFocusHandle(): number | null {
  const active = findNodeHandle(activeGuideFocusNode as any);
  if (active) return active;
  const focused = focusedGuideChannelId
    ? findNodeHandle(guideChannelNodes.get(focusedGuideChannelId)?.node as any)
    : null;
  if (focused) return focused;
  for (const entry of guideChannelNodes.values()) {
    const handle = findNodeHandle(entry.node as any);
    if (handle) return handle;
  }
  return null;
}

function wireAuxiliaryPanelsToGuide(): void {
  const targetHandle = activeGuideFocusHandle();
  if (!targetHandle) return;
  for (const node of guidePreviewNodes.values()) {
    try {
      (node as any)?.setNativeProps?.({ nextFocusRight: targetHandle });
    } catch {}
  }
  try {
    (guideTopEntryNode as any)?.setNativeProps?.({ nextFocusDown: targetHandle });
  } catch {}
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
    const previous = guideChannelNodes.get(channelId);
    if (previous?.node !== node) cancelDelayedLeftFocusLock(previous?.node);
    const entry: GuideChannelEntry = {
      node,
      handOffLeftToPreview: !!options?.handOffLeftToPreview,
    };
    guideChannelNodes.set(channelId, entry);
    wireChannelLeftFocus(entry);
    return;
  }
  const removed = guideChannelNodes.get(channelId);
  cancelDelayedLeftFocusLock(removed?.node);
  guideChannelNodes.delete(channelId);
  // FlashList recycled the row that owned focus. Never retain its program/logo
  // host as a successful restoration target.
  if (activeGuideFocusNode === removed?.node) activeGuideFocusNode = null;
  if (focusedGuideChannelId === channelId && !activeGuideFocusNode) {
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
  activeGuideFocusNode = node;
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
  wireAuxiliaryPanelsToGuide();
}

/** Record an exact programme/card focus without replacing its channel-rail ref. */
export function noteGuideProgramFocus(channelId: string, node: unknown): void {
  if (!channelId || !node) return;
  cancelGuideFocusRestore();
  cancelPreviewFocusAttempts();
  focusedGuideChannelId = channelId;
  activeGuideFocusNode = node;
  wireAuxiliaryPanelsToGuide();
}

export function focusGuideSurface(channelId?: string | null): boolean {
  // Include post-drawer-animation retries so selecting TV Guide never leaves
  // Android stranded on a now-unfocusable drawer row.
  return focusGuideSurfaceWhenMounted(channelId, [0, 32, 80, 160, 280, 420, 650, 900]);
}

/** First registered guide channel node — used when session id is unknown. */
export function anyRegisteredGuideChannelId(): string | null {
  for (const channelId of guideChannelNodes.keys()) return channelId;
  return focusedGuideChannelId;
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
    const preferredId = channelId || focusedGuideChannelId;
    const entry =
      (preferredId ? guideChannelNodes.get(preferredId) : undefined) ||
      (guideChannelNodes.size ? guideChannelNodes.values().next().value : undefined);
    const target =
      (!channelId || channelId === focusedGuideChannelId ? activeGuideFocusNode : null) ||
      entry?.node;
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
  registerGuidePreviewNode("play", node, true);
}

/** Register every preview action so Right returns directly to the active Guide cell. */
export function registerGuidePreviewNode(
  key: string,
  node: unknown,
  preferred = false,
): void {
  if (!key) return;
  const previous = guidePreviewNodes.get(key);
  if (node) guidePreviewNodes.set(key, node);
  else guidePreviewNodes.delete(key);
  if (preferred) guidePreviewPreferredNode = node || null;
  if (!node && guidePreviewEntryNode === previous) {
    guidePreviewEntryNode = null;
  }
  wireAuxiliaryPanelsToGuide();
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
export function noteGuidePreviewFocus(node?: unknown): void {
  cancelGuideFocusRestore();
  cancelPreviewFocusAttempts();
  if (node) guidePreviewEntryNode = node;
  wireAuxiliaryPanelsToGuide();
}

/** The selected group chip and Guide top row form a direct native Up/Down edge. */
export function registerGuideTopEntry(node: unknown): void {
  guideTopEntryNode = node || null;
  wireAuxiliaryPanelsToGuide();
}

export function wireGuideTopBoundary(node: unknown): void {
  if (!node) return;
  const handle = findNodeHandle(guideTopEntryNode as any) || -1;
  try {
    (node as any)?.setNativeProps?.({ nextFocusUp: handle });
  } catch {}
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
  cancelDelayedLeftFocusLock(node);
  applyLeftFocusLock(node, true);
  if (node) requestNativeFocus(node);
  if (ms > 0 && (typeof node === "object" || typeof node === "function") && node !== null) {
    const key = node as object;
    const timer = setTimeout(() => {
      if (leftFocusLockTimers.get(key) !== timer) return;
      leftFocusLockTimers.delete(key);
      applyLeftFocusLock(node, true);
    }, ms);
    leftFocusLockTimers.set(key, timer);
  }
}

/** Remove a recycled explicit Left edge so Android can use the adjacent card. */
export function clearGuideLeftFocusOverride(node: any): void {
  if (!node) return;
  try {
    node.setNativeProps?.({ nextFocusLeft: -1 });
  } catch {}
}

function guideProgramNodeKey(channelId: string, programStart: string): string {
  return `${channelId}\u0000${programStart}`;
}

/** Track the exact programme cell so modal Back/X can restore its origin. */
export function registerGuideProgramNode(
  channelId: string,
  programStart: string,
  node: unknown,
): void {
  if (!channelId || !programStart) return;
  const key = guideProgramNodeKey(channelId, programStart);
  if (node) guideProgramNodes.set(key, node);
  else guideProgramNodes.delete(key);
}

/** Restore the exact programme cell, resolving its current recycled ref per retry. */
export function focusGuideProgramCell(
  channelId: string,
  programStart: string,
  delays: number[] = [0, 16, 48, 96, 180],
): boolean {
  if (!channelId || !programStart) return false;
  cancelPreviewFocusAttempts();
  cancelGuideFocusRestore();
  const key = guideProgramNodeKey(channelId, programStart);
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  let found = false;
  const tryCurrentCell = () => {
    if (cancelled) return;
    const target = guideProgramNodes.get(key);
    if (!target) return;
    found = requestNativeFocus(target) || found;
  };
  for (const rawDelay of delays) {
    const delay = Math.max(0, rawDelay);
    if (delay === 0) tryCurrentCell();
    else timers.push(setTimeout(tryCurrentCell, delay));
  }
  cancelGuideRestoreTimers = () => {
    cancelled = true;
    for (const timer of timers) clearTimeout(timer);
  };
  return found || timers.length > 0;
}
