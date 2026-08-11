# AGENTS.md

## Cursor Cloud specific instructions

### Product
CharmIPTV Phoenix — Expo/React Native Android TV guide + IPTV player (`frontend/`), with optional Cloudflare Worker (`cloudflare-backend/worker/`).

### Must-run services for local UI work
- `frontend/`: `npm ci` then `npx expo start --port 8081`
- API-backed runs: `cloudflare-backend/worker/` → `npx wrangler dev --port 8787 --local` (matches `EXPO_PUBLIC_CHARM_API_URL`)

### Non-obvious Guide / TV focus notes
- Drawer boots **closed**. Selecting **TV Guide** must hand focus into the Guide grid before drawer rows become `focusable={false}`; otherwise Android can strand focus on an invisible nav Pressable (chaotic D-pad, no visible focus ring).
- Preview rail **Drawer** button calls `openDrawer({ focusTop: true })` so focus lands on the first drawer row (Live TV), not the active route.
- Guide restore after drawer close is **nonce-only**: `guide.tsx` bumps `focusClaimNonce`; TimelineGrid/BoxGrid call `focusGuideSurfaceWhenMounted(restoreChannelId)`. Do **not** also call `focusGuideSurface` from `guide.tsx` or Shell on drawer close — they share one `cancelGuideRestoreTimers` and the last writer wins (wrong row / focus yank).
- Shell may claim Guide focus only when `navigate()` route is `/guide` (not when leaving Guide).
- The reclaim effect must **not** depend on `channels` identity (use `channelsRef`).
- D-pad page jump window is **300ms** rapid succession only. Second taps during brief FlashList focus flicker must still feed the detector (`recentlyOwned` grace).

### Guide cache / memory caveats
- Conveyor keep set is the expanded hysteresis band (`expandRunwayKeepSet` / `lastKeepIdsRef`), not the raw runway alone.
- Blur / memory-pressure release must use `pickKeepIdsAroundFocus` around `lastChannelId` — never `source.slice(0, keepLimit)` on an ascending keep list (drops the focused neighborhood).
- `loadGuide` must **soft**-trim the programme window cache so silent refresh cannot wipe hysteresis; strict retain belongs to `retainProgrammeWindowCache`.
- `clearGuideCache()` must also call `clearGuidePrograms()` or Settings “Clear guide cache” leaves stale JS programme rows.
- Power profile changes runway size: Compatibility (`weak`) uses 5 ahead / 1 behind; Normal 8/2; Max preview 10/2.
- Reuse `buildChannelIndexMap` across viewport buckets — do not rebuild the id→index Map on every half-page focus move.
- On Guide refocus, rewarm from `lastRunwayRef` before the first D-pad event.
- TimelineGrid `previousPreparedByKeyRef` must prune to current prepared keys + focused orphan key or it grows unbounded while surfing.
- Stable Media3 fullscreen buffer is capped at **48MB** (not 72MB) to reduce Fire TV OOM with guide preview + player.

### Settings locations
- **Appearance**: Instant Guide / reduce motion, density, group layout, preview mute/hide
- **Player**: buffer profiles (low latency / balanced / stable), preferred audio language, silent-audio fallback, Media3 + VLC knobs, subtitles
- **Health**: match/failure counts plus last audio diagnostics snapshot

### Standard commands
See `frontend/package.json` for `lint`, `test`, `typecheck`, and Expo scripts. Prefer those over inventing new ones.
