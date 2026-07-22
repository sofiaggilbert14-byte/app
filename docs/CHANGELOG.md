# Changelog

## Phoenix Closed Beta

### Security

- Moved playlist and EPG source configuration to GitHub repository secrets.
- Removed committed administrator credentials and feed URLs from project documentation.

### Stability and performance

- Preserved the Expo SDK 54 New Architecture required by the current Reanimated/worklets stack.
- Added Cloudflare-first channel/guide loading with direct-feed fallback configuration.
- Added validated, size-limited last-good guide caching and corrupt-cache recovery.
- Prevented overlapping source refreshes and reduced the rendered guide to a moving four-hour window.
- Clamped program cards to the visible timeline and rejected invalid time ranges.

### TV experience

- Player controls now remain visible for 15 seconds and reappear on remote activity.
- Added Jump to Now, Resume, and delayed live preview while browsing the player rail.
- Added Phoenix guide/cache diagnostics and a focused cache-clear control.
- Updated the SDK 54 TV-remote plugin registration and generated an Android Studio-ready native project.
