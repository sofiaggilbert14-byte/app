# Phoenix cloud APK builds

The `Build Phoenix APK` workflow produces one standalone release APK containing
both `armeabi-v7a` (32-bit TV devices) and `arm64-v8a` (64-bit TV devices).
The JavaScript bundle is packaged in the APK, so Metro is not required.

## One-time configuration

1. Deploy the Cloudflare Worker described in `cloudflare-backend/README.md`.
2. In GitHub, open **Settings > Secrets and variables > Actions > Variables**.
3. Create the repository variable `EXPO_PUBLIC_CHARM_API_URL` containing the
   Worker URL without a trailing slash.
4. For **direct-fetch** Purple TV / Purple Next APKs, set repository **secrets**
   (preferred, same as charm-refresh):
   - `M3U_URL` — playlist URL
   - `EPG_URL` — XMLTV / EPG URL

   Optional fallbacks (Actions **variables**): `EXPO_PUBLIC_M3U_URL`,
   `EXPO_PUBLIC_EPG_URL`, and `EXPO_PUBLIC_GUIDE_WINDOW_HOURS` (default `8`).

   These are compiled into the APK at build time. The Purple TV and Purple Next
   workflows fail fast if neither secrets nor variables are present.

Do not commit raw M3U or EPG URLs into the repository. Keep them in Actions
secrets (or variables) and inject them only during CI builds.

## Build and download

1. Open the repository's **Actions** tab.
2. Select **Build Phoenix APK**.
3. Select **Run workflow**, choose `main`, and confirm.
4. Open the completed run after it receives a green check mark.
5. Download the `CharmIPTV-Phoenix-Universal-Beta` artifact.
6. Extract the ZIP and install `CharmIPTV-Phoenix-Universal-Beta.apk`.

Artifacts expire after seven days to conserve the GitHub Free storage quota.

## Signing

Release builds use `signingConfigs.release`. When the upload keystore env vars
are present (`CHARM_UPLOAD_STORE_FILE`, `CHARM_UPLOAD_STORE_PASSWORD`,
`CHARM_UPLOAD_KEY_ALIAS`, `CHARM_UPLOAD_KEY_PASSWORD`), Gradle signs with that
keystore. Otherwise CI falls back to the debug keystore for sideloadable
artifacts only — replace it with a permanent release keystore before public
distribution.

Purple Next keeps applicationId `com.charmiptv.app.purple.next` so it can
install beside stable builds without clobbering app data.

