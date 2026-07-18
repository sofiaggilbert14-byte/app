# Charm IPTV — Product Requirements Document

## Original Problem Statement
Build an Android app with a built-in video player for IPTV that also shows an EPG guide.
Each channel structured like a TV guide, clickable to launch the channel, with the channel's
logo shown as in the guide. Channel list + URL sources and the EPG must be updatable WITHOUT
rebuilding the app.

## User Choices
- Sources auto-import from a fixed developer-specified m3u4u.com M3U + XMLTV URL at load.
- Stream formats mixed (HLS .m3u8 + MPEG-TS .ts).
- EPG has two toggleable views: (1) classic horizontal timeline grid, (2) 4-across box grid.
- App always loads channels/EPG from the developer-specified source (stored on backend).
- Features: Favorites, Recently Watched, Search (channels + programs), look-ahead Reminders
  with alert + switch-to-channel action.
- Player upgraded to a libVLC engine (VLC-like all-format support), built into the app.

## Architecture
- Frontend: Expo (SDK 54) + expo-router, React Native 0.81, TypeScript.
  - Player: `react-native-vlc-media-player` (libVLC) on native builds, `expo-video` fallback
    on Expo Go / web (platform-split via StreamPlayer.tsx / StreamPlayer.web.tsx).
  - Fonts: Fraunces (display) + Geist (UI), bundled TTFs. Icons: @expo/vector-icons.
  - Notifications: expo-notifications (local scheduled reminders).
  - Local storage: `@/src/utils/storage` (favorites, recent, reminders).
- Backend: FastAPI + Motor/MongoDB. Parses M3U + XMLTV, in-memory cache, source URLs in
  backend/.env (SOURCE_M3U_URL / SOURCE_EPG_URL), overridable via /api/settings (Mongo).
  - Logos merged from XMLTV <icon> by tvg-id when M3U logo missing; all logos forced https.
  - Channel IDs deduped for repeated tvg-ids.

## Data Source
- M3U: http://m3u4u.com/m3u/jwmzn1grpmu99585n721
- XMLTV: http://m3u4u.com/xml/jwmzn1grpmu99585n721
- ~688 channels, ~665 with EPG.

## Backend API
- GET /api/status/source, POST /api/refresh, GET/POST /api/settings
- GET /api/channels, GET /api/guide?start=&hours=, GET /api/search?q=

## Implemented (2026-07-18)
- M3U + XMLTV parsing, in-memory cache, runtime refresh (no rebuild needed for source changes).
- TV Guide: timeline grid (sticky logo column, time header, red now-line, duration-sized blocks)
  + 4-across/2-col box grid; group filter chips; view toggle.
- Live player screen: fullscreen video, glass overlay, back, Now/Next, channel-surf rail.
- Favorites, Recently Watched, Search (channels + upcoming programs), Program modal.
- Reminders: schedule local notification before a future program; tap -> switch channel;
  managed under Favorites tab.
- Charm IPTV branding (app icon/splash from user logo).
- libVLC player integration with expo-video fallback.
- Auto-refresh of playlist + EPG on every app launch (cached instant paint + background
  force-refresh so added/removed channels reflect automatically).
- Per-day EPG date picker (Today + next 6 days) on the TV Guide.
- Pull-to-refresh on the guide (timeline + box) and Settings; "Refresh Playlist Now" button.
- Password-protected Admin section in Settings to edit the M3U + EPG source URLs live
  (case-sensitive username `CharmCity` / password `CharmCityExotics`, JWT via passlib+pyjwt;
  ADMIN_USERNAME/ADMIN_PASSWORD in backend/.env are the source of truth). POST /api/settings
  is Bearer-protected; token stored in secure storage on device.
- Verified via testing_agent (iterations 1-4): backend 17/17, all frontend flows passing.

## Known Limitations
- Live video playback requires an installed Android/iOS build (libVLC + cleartext). It does
  NOT play in Expo Go / web preview.
- Scheduled notifications only fire on an installed build, not in Expo Go preview.

## Backlog / Next
- P1: Pull-to-refresh on guide; "On Now" quick row; per-day EPG date picker.
- P1: Server-side EPG pagination for very large guides.
- P2: Parental PIN for adult groups; multi-source support; Chromecast.
- P2: Landscape 4-across box grid tuning for tablets.
