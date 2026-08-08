import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const source = (path) => readFile(join(root, path), "utf8");
const repoSource = (path) => readFile(join(repo, path), "utf8");

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
  assert.match(mod, /resolveProgrammeStop/);
  assert.match(mod, /DEFAULT_PROGRAMME_DURATION_MS/);
  assert.match(mod, /channelIds: ReadableArray/);
  assert.match(bridge, /getWindow\(startMs, endMs, uniqueIds\)/);
});

test("favorites are never auto-pruned on playlist load", async () => {
  const store = await source("src/store.tsx");
  assert.match(store, /do NOT prune favorite\/recent IDs/);
  assert.doesNotMatch(store, /Drop orphan favorite\/recent IDs/);
  assert.doesNotMatch(store, /prev\.filter\(\(id\) => channelByIdMap\.has\(id\)\)/);
});

test("favorites backup offers SAF portable export", async () => {
  const backup = await source("src/utils/favoritesBackup.ts");
  assert.match(backup, /createFileAsync/);
  assert.match(backup, /portable: true/);
  assert.match(backup, /requestDirectoryPermissionsAsync/);
});

test("TvRemote checked-in Android matches plugin guide APIs", async () => {
  const [plugin, mod, activity] = await Promise.all([
    source("plugins/withTvRemote.js"),
    source("android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);
  for (const needle of ["guideNavigationActive", "setGuideNavigationActive", "moveFocus", "focusView"]) {
    assert.match(plugin, new RegExp(needle));
    assert.match(mod, new RegExp(needle));
  }
  assert.match(plugin, /KOTLIN_NAMESPACE/);
  assert.match(activity, /guideNavigationActive/);
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

test("release packaging bumps versionCode and supports upload keystore", async () => {
  const [appJson, gradle] = await Promise.all([
    source("app.json"),
    source("android/app/build.gradle"),
  ]);
  assert.match(appJson, /"versionCode": 4/);
  assert.match(appJson, /2\.1\.0-rc\.1/);
  assert.match(gradle, /versionCode 4/);
  assert.match(gradle, /CHARM_UPLOAD_STORE_FILE/);
  assert.match(gradle, /signingConfigs\.release/);
});

test("legacy backend proxy blocks private destinations", async () => {
  const server = await repoSource("backend/server.py");
  assert.match(server, /_assert_safe_proxy_url/);
  assert.match(server, /is_private/);
  assert.match(server, /allow_redirects=False/);
  assert.match(server, /try:\n\s+epg_text = _fetch\(epg_url\)/);
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
  assert.match(native, /parseM3UWithStats/);
  assert.match(native, /enforcePlaylistTextLimit/);
  assert.match(native, /Playlist contained no playable channels/);
  assert.match(web, /parseM3UWithStats/);
  assert.match(web, /MAX_PLAYLIST_BYTES/);
  assert.match(web, /previous\?\.channels\?\.length/);
  assert.match(web, /Playlist contained no playable channels/);
});
