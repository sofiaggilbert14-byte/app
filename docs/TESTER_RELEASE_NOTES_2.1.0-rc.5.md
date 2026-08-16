# CharmIPTV Purple Next 2.1.0-rc.5 — Tester Notes

This sideload build includes the complete rc.4 stability and navigation work,
plus focused corrections for EPG Settings scrolling and the Guide action strip.

## New in rc.5

- EPG Settings always opens at the top of the page.
- The top Back control receives one-time entry focus so the page never opens
  without a visible focus owner.
- Pressing Down enters the EPG controls, and the full page scrolls with focus.
- The EPG focus region now explicitly contains all vertical and horizontal
  movement while the page is open.
- Pressing Up from the first Guide row now requests focus on Play using both
  direct native focus and a short TV-preferred-focus handoff.
- The shared focus helper no longer reports success when no focus method ran.
- Play, Favorite, Reminders, Drawer, Mute, and Hide remain connected to their
  existing full actions.

## Priority testing

1. Open Settings > EPG. Confirm the page starts at the top with All Settings
   focused.
2. Press Down through every EPG option and action. Confirm the page scrolls
   smoothly and no item is cut off or unreachable.
3. Leave the EPG page while scrolled to the bottom, reopen it, and confirm it
   returns to the top.
4. In the Guide, focus the first channel row and press Up. Confirm focus enters
   Play in the six-button action strip.
5. Navigate through and activate Play, Favorite, Reminders, Drawer, Mute, and
   Hide. Confirm each action completes and focus remains visible.
6. Return from the action strip to the Guide and continue rapid vertical and
   horizontal navigation.

Please include device model, OS version, screen, focused item, remote key, and
reproduction steps with every report.
