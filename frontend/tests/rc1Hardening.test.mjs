import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const source = (path) => readFile(join(root, path), "utf8");
const repoSource = (path) => readFile(join(repo, path), "utf8");

test("CI pins third-party actions and separates native compile from APK packaging", async () => {
  const workflowDir = join(repo, ".github", "workflows");
  const workflowFiles = (await readdir(workflowDir)).filter((name) => name.endsWith(".yml"));
  const workflows = await Promise.all(
    workflowFiles.map(async (name) => [name, await readFile(join(workflowDir, name), "utf8")]),
  );
  for (const [name, workflow] of workflows) {
    assert.doesNotMatch(workflow, /uses:\s+[^\s#]+@v\d+/i, `${name} contains a floating action tag`);
  }

  const nativeCompile = await repoSource(".github/workflows/android-native-ci.yml");
  assert.match(nativeCompile, /java-version: "17"/);
  assert.match(nativeCompile, /platforms;android-36/);
  assert.match(nativeCompile, /:app:compileDebugKotlin/);
  assert.match(nativeCompile, /:app:compileDebugJavaWithJavac/);
  assert.doesNotMatch(nativeCompile, /assemble|upload-artifact/i);

  const testerBuild = await repoSource(".github/workflows/purple-tv-ui.yml");
  assert.match(testerBuild, /assembleSideload/);
  assert.match(testerBuild, /TESTER_RELEASE_NOTES/);
  assert.match(testerBuild, /SHA256SUMS/);
});

test("Expo dependency validation is an explicit release gate", async () => {
  const [packageJson, frontendCi, apkCi] = await Promise.all([
    source("package.json"),
    repoSource(".github/workflows/frontend-ci.yml"),
    repoSource(".github/workflows/purple-next-ci.yml"),
  ]);
  assert.match(packageJson, /"doctor": "expo-doctor"/);
  assert.match(packageJson, /"appConfigFieldsNotSyncedCheck"/);
  assert.match(packageJson, /"reactNativeDirectoryCheck"/);
  assert.match(frontendCi, /npm run doctor/);
  assert.match(apkCi, /npm run doctor/);
});

test("source modules never hardcode provider playlist/EPG URLs", async () => {
  const [native, web] = await Promise.all([
    source("src/source.native.ts"),
    source("src/source.ts"),
  ]);
  for (const body of [native, web]) {
    assert.doesNotMatch(body, /m3u4u\.com/i);
    assert.match(body, /EXPO_PUBLIC_M3U_URL/);
    assert.match(body, /EXPO_PUBLIC_EPG_URL/);
    assert.match(body, /SOURCE_M3U = \(process\.env\.EXPO_PUBLIC_M3U_URL \|\| ""\)\.trim\(\)/);
  }
  assert.match(native, /not configured for this build/);
});

test("Purple TV APK workflow injects playlist/EPG from secrets", async () => {
  const workflow = await repoSource(".github/workflows/purple-tv-ui.yml");
  assert.match(workflow, /secrets\.M3U_URL/);
  assert.match(workflow, /secrets\.EPG_URL/);
  assert.match(workflow, /Require playlist and EPG build configuration/);
});

test("native EPG refuses empty live swaps and filters getWindow by channel ids", async () => {
  const [db, mod, bridge] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("src/nativeEpg.ts"),
  ]);
  assert.match(db, /Refusing to replace live EPG with an empty feed/);
  assert.match(db, /channelIds\.chunked\(IN_CLAUSE_CHUNK\)/);
  assert.match(db, /fun deleteExpired/);
  assert.match(db, /wal_checkpoint\(PASSIVE\)/);
  assert.match(mod, /resolveProgrammeStop/);
  assert.match(mod, /DEFAULT_PROGRAMME_DURATION_MS/);
  assert.match(mod, /channelIds: ReadableArray/);
  assert.match(mod, /deleteExpired\(/);
  assert.match(bridge, /getWindow\(startMs, endMs, uniqueIds\)/);
  assert.match(db, /queryGuideWindow/);
  assert.match(mod, /queryGuideWindow/);
});

test("favorites are never auto-pruned on playlist load", async () => {
  const store = await source("src/store.tsx");
  assert.match(store, /do NOT prune favorite\/recent IDs/);
  assert.doesNotMatch(store, /Drop orphan favorite\/recent IDs/);
  assert.doesNotMatch(store, /prev\.filter\(\(id\) => channelByIdMap\.has\(id\)\)/);
  assert.match(store, /Coalesce them so one refresh/);
  assert.match(store, /\}, 500\)/);
});

test("favorites backup offers SAF portable export", async () => {
  const backup = await source("src/utils/favoritesBackup.ts");
  assert.match(backup, /createFileAsync/);
  assert.match(backup, /portable: true/);
  assert.match(backup, /requestDirectoryPermissionsAsync/);
});

test("TvRemote suppresses duplicate Guide bridge events without consuming native focus", async () => {
  const [plugin, mod, activity] = await Promise.all([
    source("plugins/withTvRemote.js"),
    source("android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);
  for (const needle of ["moveFocus", "focusView"]) {
    assert.doesNotMatch(mod, new RegExp(needle));
  }
  assert.match(mod, /fun setGuideNavigationActive/);
  assert.match(plugin, /fun setGuideNavigationActive/);
  assert.match(plugin, /KOTLIN_NAMESPACE/);
  assert.match(plugin, /hardenMainActivity/);
  assert.match(plugin, /minDpadRepeatMs = 48L/);
  assert.match(activity, /MIN_DPAD_REPEAT_MS = 48L/);
  assert.match(activity, /Static remote flags must never survive/);
  assert.match(activity, /TvRemoteModule\.pointerActive = false/);
  assert.match(activity, /!TvRemoteModule\.guideNavigationActive \|\| TvRemoteModule\.pointerActive/);
  // Guide surfing must use Android focus — never consume Up/Down when "active".
  assert.doesNotMatch(activity, /guideNavigationActive && \(key == "UP"/);
  assert.doesNotMatch(plugin, /guideNavigationActive && \(key == "UP"/);
});

test("Cloudflare worker does not default CORS to wildcard", async () => {
  const worker = await repoSource("cloudflare-backend/worker/src/index.js");
  assert.doesNotMatch(
    worker,
    /const CORS = \{[\s\S]*access-control-allow-origin": "\*"/,
  );
  assert.match(worker, /CORS_ALLOW_ORIGINS/);
  assert.match(worker, /function corsHeaders/);
});

test("release packaging requires upload signing and keeps tester sideload separate", async () => {
  const [appJson, gradle, manifest] = await Promise.all([
    source("app.json"),
    source("android/app/build.gradle"),
    source("android/app/src/main/AndroidManifest.xml"),
  ]);
  assert.match(appJson, /"versionCode": 6/);
  assert.match(appJson, /2\.1\.0-rc\.3/);
  assert.match(gradle, /versionCode 6/);
  assert.match(gradle, /CHARM_UPLOAD_STORE_FILE/);
  assert.match(gradle, /signingConfigs\.release/);
  assert.match(gradle, /releaseTaskRequested && !releaseSigningConfigured/);
  assert.match(gradle, /assembleSideload/);
  assert.match(gradle, /applicationIdSuffix '\.sideload'/);
  assert.match(gradle, /manifestPlaceholders\.allowCleartextStreams = "true"/);
  assert.doesNotMatch(gradle, /Falls back to the debug keystore/);
  assert.match(appJson, /"allowBackup": false/);
  assert.match(appJson, /"blockedPermissions"/);
  assert.match(appJson, /"usesCleartextTraffic": false/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="\$\{allowCleartextStreams\}"/);
  assert.match(manifest, /android:scheme="charmiptv-purple"/);
  for (const permission of ["READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "SYSTEM_ALERT_WINDOW"]) {
    assert.match(manifest, new RegExp(`${permission}\\" tools:node=\\"remove`));
  }
});

test("legacy backend proxy blocks private destinations", async () => {
  const server = await repoSource("backend/server.py");
  assert.match(server, /_assert_safe_proxy_url/);
  assert.match(server, /is_private/);
  assert.match(server, /allow_redirects=False/);
  assert.match(server, /PROXY_ALLOW_HOSTS/);
  assert.match(server, /if not allowlist_raw/);
  assert.match(server, /_fetch_spooled/);
  assert.match(server, /ET\.iterparse/);
  assert.match(server, /MAX_EPG_DECOMPRESSED_BYTES/);
  assert.doesNotMatch(server, /ET\.fromstring/);
  assert.doesNotMatch(server, /content=r\.content/);
  assert.doesNotMatch(server, /detail=f"Proxy fetch failed/);
  assert.match(server, /async def force_refresh\(_:\s*str = Depends\(require_admin\)\)/);
  assert.match(server, /async def get_settings\(_:\s*str = Depends\(require_admin\)\)/);
  assert.doesNotMatch(server, /allow_origins=\["\*"\]/);
});

test("release build verifies native drift and pins the JSC fallback", async () => {
  const [pkg, gradle, verify, frontendCi, apkCi] = await Promise.all([
    source("package.json"),
    source("android/app/build.gradle"),
    source("scripts/verify-native-config.mjs"),
    repoSource(".github/workflows/frontend-ci.yml"),
    repoSource(".github/workflows/purple-next-ci.yml"),
  ]);
  assert.match(pkg, /"verify:native-config"/);
  assert.match(pkg, /"overrides"/);
  assert.doesNotMatch(pkg, /"packageManager"|"resolutions"/);
  assert.match(gradle, /jsc-android:2026004\.0\.0/);
  assert.doesNotMatch(gradle, /jsc-android:[^'"\r\n]*\+/);
  assert.match(verify, /Native config verified/);
  assert.match(frontendCi, /npm run verify:native-config/);
  assert.match(apkCi, /npm run verify:native-config/);
});

test("Cloudflare builder and worker bound provider data and hide internal failures", async () => {
  const [builder, worker] = await Promise.all([
    repoSource("cloudflare-backend/scripts/build-and-upload.mjs"),
    repoSource("cloudflare-backend/worker/src/index.js"),
  ]);
  assert.match(builder, /MAX_PLAYLIST_DOWNLOAD_BYTES/);
  assert.match(builder, /MAX_EPG_DECOMPRESSED_BYTES/);
  assert.match(builder, /readGuideWindowHours\(process\.env\.GUIDE_WINDOW_HOURS, 6\)/);
  assert.match(builder, /getReader\(\)/);
  assert.doesNotMatch(worker, /detail:\s*String\(e\)/);
  assert.match(worker, /Request could not be completed/);
  assert.doesNotMatch(worker, /allowed\.includes\("\*"\)/);
});

test("playlist ingest keeps last-good and enforces protocol/size guards", async () => {
  const [parsing, native, web] = await Promise.all([
    source("src/core/sourceParsing.ts"),
    source("src/source.native.ts"),
    source("src/source.ts"),
  ]);
  assert.match(parsing, /MAX_PLAYLIST_BYTES/);
  assert.match(parsing, /MAX_PLAYLIST_CHANNELS/);
  assert.match(parsing, /isAllowedPlaylistUrl/);
  assert.match(parsing, /allocateChannelId/);
  assert.match(parsing, /parseM3UWithStats/);
  assert.match(native, /parseM3ULinesWithStats/);
  assert.match(native, /enforcePlaylistByteLimit/);
  assert.match(native, /File\.downloadFileAsync/);
  assert.match(native, /readLocalPlaylistLines/);
  assert.match(native, /Playlist contained no playable channels/);
  assert.match(native, /EMPTY_PROGRAMS/);
  assert.match(native, /matchQuality/);
  assert.match(native, /applyLogoOnlyUpdates/);
  assert.match(native, /guideEpoch/);
  assert.match(web, /parseM3UWithStats/);
  assert.match(web, /MAX_PLAYLIST_BYTES/);
  assert.match(web, /EMPTY_GUIDE_PROGRAMS/);
  assert.match(web, /phase: "channels"/);
  assert.match(native, /phase: "channels"/);
  assert.match(web, /previous\?\.channels\?\.length/);
  assert.match(web, /Playlist contained no playable channels/);
});
