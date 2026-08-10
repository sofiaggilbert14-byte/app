export type DrawerBackDecision =
  | "open-drawer"
  | "close-drawer"
  | "pass-through"
  | "arm-reopen";

/** Second Back within this window opens the closed drawer; a single Back only arms. */
export const DRAWER_REOPEN_DOUBLE_BACK_MS = 1100;

/**
 * Closed-drawer Back must not open the sidebar on the same press that leaves a
 * player/modal — that feels like the drawer "stealing" Back. Require a second
 * Back within DRAWER_REOPEN_DOUBLE_BACK_MS to actually open.
 * Open-drawer Back closes the sidebar so focus can return to content.
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
  if (armedAt > 0 && now - armedAt <= DRAWER_REOPEN_DOUBLE_BACK_MS) {
    return "open-drawer";
  }
  return "arm-reopen";
}
