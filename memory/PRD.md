# Charm IPTV — Product Requirements Document

## Original Problem Statement
Build an Android app with a built-in video player for IPTV that also shows the EPG guide.
Channels structured like a TV guide, clickable to launch, with each channel's logo shown as in
the guide. Channel list, stream URLs, and EPG must be updatable without rebuilding the app.

## User Choices
- Sources auto-import from a fixed developer-specified m3u4u.com M3U + XMLTV URL (stored on backend).
- Stream formats mixed (HLS .m3u8 + MPEG-TS .ts).
- EPG guide with TWO toggleable views: (1) classic horizontal timeline grid, (2) 4-across box grid.
- Always load from the developer's URL (no per-user playlist manager).
- Features: Favorites, Recently watched, Search (channels + programs), look-ahead Reminders.
- App icon: "Charm IPTV" crown logo (user supplied).

## Architecture
- Frontend: Expo Router (React Native, SDK 54), expo-video player, expo-notifications, expo-image,
  reanimated/gesture-handler, dark "Glass/Luxe" theme (Fraunces + Geist fonts).
- Backend: FastAPI. Fetches + parses M3U (regex) and XMLTV (ElementTree) into an in-memory cache
  that auto-refreshes every 30 min (and on demand). Merges EPG `<icon>` logos into channels by
  tvg-id; forces https on logos; dedupes duplicate tvg-ids into unique channel ids.
- MongoDB: stores overridable source URLs in `settings` (defaults from backend/.env).
- Local device storage (@/src/utils/storage): favorites, recently watched, reminders.

## Backend API (all under /api)
- GET /status/source, POST /refresh, GET/POST /settings
- GET /channels, GET /guide?start=&hours=, GET /search?q=

## Implemented (2026-07-18)
- Auto-import + parse of 688 channels (~665 with EPG); logos merged & https-normalized; unique ids.
- TV Guide: timeline grid (sticky logo column, scrolling time header, red now-line, duration-sized
  program blocks, LIVE highlight) + 2/4-col box grid; group filter chip row.
- Live player: fullscreen expo-video, glass overlay (channel + now/next), channel surfing rail,
  loading/error states with Retry.
- Favorites, Recently Watched, Reminders (local scheduled notifications w/ tap-to-switch), Search.
- Settings: source status + manual Refresh.
- Cleartext HTTP enabled for Android builds (expo-build-properties) so HTTP streams play in the APK.

## Known Constraints
- HTTP streams do NOT play in the web preview (Chromium lacks native HLS + mixed-content block) or
  reliably in Expo Go. Playback works in the installed Android/iOS build (cleartext enabled, ExoPlayer
  handles HLS + TS).
- Scheduled reminder notifications only fire on an installed build, not in Expo Go/web preview.

## Backlog / Next
- P1: Landscape/fullscreen lock & PiP; resume-last-channel on launch.
- P1: EPG day navigation (jump to tomorrow) & "jump to now" button on timeline.
- P2: Per-channel full-day schedule sheet; category filters in search.
- P2: Multiple playlist support / admin editor screen for source URLs.
