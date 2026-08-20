# CharmIPTV Purple Next 2.1.0-rc.4 — Tester Notes

This sideload test build focuses on TV-remote navigation, Guide stability,
Search reliability, and clearer EPG configuration.

## Changes

- Removed Catch-Up from the drawer, navigation, screens, and associated code.
- Added deterministic initial focus to Live TV, Movies, Series, Channels,
  Favorites, and Reminders.
- Added a shared Left-edge handoff that opens the drawer without losing focus.
- Corrected drawer focus restoration and limited Guide surfing safeguards to
  the Guide screen.
- Fixed the first Search result and Search-to-Guide focus handoff.
- Improved Guide stability during rapid vertical navigation, long horizontal
  browsing, repeated group changes, and rapid channel switching.
- Bounded Guide memory, cached rows, group history, player history, and stale
  decoder callbacks.
- Prevented automatic source refresh from interrupting active Guide navigation
  or playback.
- Added manual playlist/EPG refresh controls and a protected cache rebuild.
- Consolidated matching, refresh, source health, logo-source, and Guide-data
  controls under Settings > EPG.

## Priority test directions

1. Open every drawer destination and immediately navigate with all four D-pad
   directions. Focus must remain visible.
2. On every page, move to the leftmost control and press Left. The drawer must
   open with a visible focused item.
3. Open and close the drawer repeatedly, then continue navigating the page.
4. Search several terms and test the first suggestion, first result, and Open
   in Guide.
5. Browse the Guide several hours left and right, rapidly reverse direction,
   and switch groups at least 50 times.
6. Switch channels rapidly, enter fullscreen, return to the Guide, and repeat.
7. Open Settings > EPG, navigate the complete page, test EPG-only refresh and
   combined refresh, and verify repeat OK presses do not overlap operations.
8. Record favorites, rebuild the Guide cache, restart the app, and verify the
   favorites remain.

Please include device model, OS version, screen, focused item, remote key, and
reproduction steps with every report.
