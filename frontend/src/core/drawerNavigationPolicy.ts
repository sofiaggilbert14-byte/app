export type DrawerBackDecision =
  | "close-drawer"
  | "pass-through";

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
}): DrawerBackDecision {
  if (input.blockingOverlayOpen) return "pass-through";
  if (input.drawerOpen) return "close-drawer";
  return "pass-through";
}
