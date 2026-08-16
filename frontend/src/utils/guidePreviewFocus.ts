import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";

const nodes = new Map<string, unknown>();
let preferredKey = "play";

export function registerGuidePreviewNode(key: string, node: unknown, preferred = false): void {
  if (node) nodes.set(key, node); else nodes.delete(key);
  if (preferred) preferredKey = key;
}

export function noteGuidePreviewFocus(_node?: unknown): void {
  // Native Guide selection is independent of the preview's Android focus.
}

export function focusGuidePreviewSurface(): boolean {
  const node = nodes.get(preferredKey) || nodes.values().next().value;
  if (!node) return false;
  requestNativeFocusWithRetry(node, [0, 60, 140]);
  return true;
}
