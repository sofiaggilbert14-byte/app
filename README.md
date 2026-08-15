# CharmIPTV: Phoenix

CharmIPTV is an Expo/React Native television guide and IPTV player designed for Android TV and Fire TV. Phoenix is the performance, stability, and remote-experience milestone.

## Repository layout

- `frontend/` — Expo Router app and Android TV configuration plugins
- `cloudflare-backend/` — scheduled feed builder and lightweight Worker API
- `backend/` — legacy FastAPI service retained during migration
- `docs/` — roadmap, release notes, known issues, and test checklist

## Local setup

1. Copy `frontend/.env.example` to `frontend/.env` and set the deployed Worker URL.
2. From `frontend/`, install dependencies with `npm ci`.
3. Run `npm run typecheck` and `npm run lint`.
4. Run `npm run android:prebuild` to generate the Android Studio project.
5. Open `frontend/android` in Android Studio.

The native VLC player is unavailable in Expo Go and the browser preview.

## Release safety

Never commit playlist URLs, administrator passwords, Cloudflare tokens, keystores, or signing passwords. Configure feed URLs through GitHub repository secrets named `M3U_URL` and `EPG_URL`.

The RAM experiment Guide keeps live preview, six remote actions, and programme description in a compact strip above the Guide grid.

See [the Phoenix roadmap](docs/ROADMAP.md) and [testing checklist](docs/TESTING_CHECKLIST.md).

Cloud APK builds and downloads are documented in
[docs/GITHUB_ACTIONS.md](docs/GITHUB_ACTIONS.md).
