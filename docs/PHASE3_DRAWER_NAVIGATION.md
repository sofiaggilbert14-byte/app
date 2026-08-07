# Purple Next drawer navigation

Baseline: Phase 2 commit `3d2556f7127a84c313863c9de332a0187b25a044`.

## Behavior

- The drawer starts open, then closes after every navigation choice, including the already-active route.
- Closed content receives the reclaimed drawer width while the guide preview/details rail remains on the right.
- Back opens a closed drawer and restores focus to the active route item.
- Back is consumed while the drawer is open, so focus stays there until a destination or Exit is selected.
- Program details and other blocking overlays keep first priority for Back.
- Hidden drawer controls are removed from TV focus, and an open drawer traps focus within its controls.
- The guide's group tabs move to the left edge when the drawer closes.
- Up from the first guide row restores focus to the active group tab with bounded retries.

## Performance and state boundaries

The drawer owns one boolean and one short-lived native transform animation. Content width changes once per open/close action; guide rows are not resized on every animation frame. Drawer state is not persisted and does not touch source, EPG, database, cache, favorites, backup, or player lifecycle state.

## APK packaging

CI now publishes two artifacts: an APK-only install artifact and a separate evidence artifact containing the APK checksum and validation JSON. The install ZIP therefore contains only `CharmIPTV-Purple-Next.apk` at its root.
