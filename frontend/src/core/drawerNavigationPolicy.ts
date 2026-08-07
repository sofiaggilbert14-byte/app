export type DrawerBackDecision = "open-drawer" | "keep-drawer-open" | "pass-through";

export function evaluateDrawerBack(input: {
  drawerOpen: boolean;
  blockingOverlayOpen: boolean;
}): DrawerBackDecision {
  if (input.blockingOverlayOpen) return "pass-through";
  if (input.drawerOpen) return "keep-drawer-open";
  return "open-drawer";
}
