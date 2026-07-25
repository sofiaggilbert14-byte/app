# CharmIPTV Phoenix phase roadmap

Last updated: July 25, 2026

## Phase 1 — Cloudflare backend and first APK

Goal: get a real backend online and prove the app can install.

Status: complete.

- Cloudflare Worker deployed.
- GitHub Actions deployment repaired.
- Worker secrets and KV setup confirmed.
- `/config`, guide, and channel endpoints verified.
- APK builds from GitHub Actions.
- App installs on Android phone, Onn box, and TV-style devices.

## Phase 2 — EPG reliability and playable beta

Goal: make guide loading work reliably enough for testers.

Status: complete.

- M3U and EPG parsing flow stabilized.
- M3U4U guide data loads through the backend/app flow.
- Guide crash fixed.
- Safe guide mode added.
- Channels and guide are usable by beta testers.

## Phase 3 — TV / Fire Stick / Onn polish

Goal: make the app feel good on real living-room devices.

Status: mostly complete, still needs hands-on testing.

- D-pad/focus behavior improved.
- Player overlay burn-in protection added.
- Stop, previous, last, next, guide, search, refresh controls added to player.
- Player overlay fades away and returns on remote/touch interaction.
- 32-bit compatible APK workflow used for Fire/Android TV style devices.
- Onn box and Android phone installs confirmed.
- Fire Stick testing remains an active device-test item.

## Phase 4 — Professional layout and user preferences

Goal: make Phoenix feel like a premium IPTV player while keeping the guide practical.

Status: bundled for tester build.

- Black/gold Command Center layout added.
- Live preview and now-playing details added to home guide.
- Home quick controls removed to give the guide more space.
- Header menu added for TV Guide, Favorites, Search, and Settings.
- Settings now includes:
  - Guide layout: Cinematic / Compact.
  - Guide density: Large / Normal / Compact.
  - Player controls timeout: 8 / 15 / 30 / 60 seconds.
  - Auto retry streams: on/off.
- Empty home guide categories are hidden automatically.
- Recently Watched appears as a guide category when there is history.
- Favorite/unfavorite is available from the home preview/details panel.
- Android phones now use a mobile-safe card guide instead of the TV live-preview timeline.

Next Phase 4 items:

- Test compact guide mode on TV.
- Tune the dropdown menu if D-pad behavior feels awkward.
- Decide whether the dropdown should become a slide-out drawer.
- Compare Cinematic vs Compact layout with testers.
- Confirm mobile rotation no longer crashes or returns half-screen.

## Phase 5 — Favorites, search, and release polish

Goal: make daily use smoother before RC1.

Status: bundled for tester build.

- Favorite/unfavorite directly from guide and player overlay.
- Recently watched / last channel polish.
- Smarter category cleanup and empty-category hiding.
- Mobile card guide for phone testers.
- Search improvements for channels and programs.

Still planned:

- Better tester feedback flow.
- App icon and splash polish.
- RC1 bug checklist.

## Phase 6 — Optional backend and account features

Goal: only add cloud/account features if the stable client needs them.

Planned later:

- Optional backend dashboard.
- Optional user/account management.
- Remote config and announcements.
- Beta tester update channel.
