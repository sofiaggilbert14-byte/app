export type DrawerBackDecision =
  | "open-drawer"
  | "close-drawer"
  | "pass-through"
  | "arm-reopen";

/** A single Back is harmless; a deliberate second press opens navigation. */
export const DRAWER_REOPEN_DOUBLE_BACK_MS = 1100;

/**
 * TiviMate-style TV navigation rule:
 * - Back closes an already-open drawer.
 * - Back never opens a closed drawer; drawer entry belongs to an explicit
 *   left-boundary/context action so Back cannot steal navigation from content.
 * - Active overlays keep ownership and receive Back first.
 */
export function evaluateDrawerBack(input: {
  drawerOpen: boolean;
  blockingOverlayOpen: boolean;
  reopenArmedAt?: number;
  now?: number;
}): DrawerBackDecision {
  if (input.blockingOverlayOpen) return "pass-through";
  if (input.drawerOpen) return "close-drawer";
  const now = input.now ?? Date.now();
  const armedAt = input.reopenArmedAt ?? 0;
  if (armedAt > 0 && now - armedAt <= DRAWER_REOPEN_DOUBLE_BACK_MS) return "open-drawer";
  return "arm-reopen";
}
