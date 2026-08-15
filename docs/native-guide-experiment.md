# Native Guide architecture experiment

This branch is a clean-room CharmIPTV experiment derived from the stable `main`
commit. It does not contain TiViMate source code and does not modify the
`experiment/full-ram-epg-engine` comparison branch.

The Guide is one focusable Android canvas. A native logical cursor consumes
D-pad input synchronously, draws only visible channels/programmes, expands the
SQLite runway with repeat velocity, and reports preview selection to React only
after key-up settlement. React remains responsible for Charm's preview/player,
dialogs, drawer, settings, M3U/XMLTV lifecycle, and branding.

The tester build uses `com.charmiptv.app.nativeguide.sideload` and the display
name `Charm IPTV Native Guide`, so it installs beside the RAM tester.
