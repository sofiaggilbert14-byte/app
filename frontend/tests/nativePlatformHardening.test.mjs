import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = async (name) => (await readFile(path.join(root, name), "utf8")).replace(/\r\n/g, "\n");

test("native EPG control plane remains single-source per playlist and scheduled", async () => {
  const [control, scheduler, native] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgUpdateScheduler.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
  ]);
  assert.match(control, /primaryKeys?\s*=\s*\[?"playlistId"/);
  assert.match(control, /Migration\(1, 2\)/);
  assert.match(scheduler, /PeriodicWorkRequestBuilder<EpgUpdateWorker>/);
  assert.match(scheduler, /NetworkType\.CONNECTED/);
  assert.match(native, /serverOffsetMinutes/);
  assert.match(native, /playlistOffsetMinutes/);
  assert.match(native, /channelOffsets/);
});

test("programme persistence uses epoch seconds, FTS, and a guarded last-good database", async () => {
  const database = await source("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt");
  assert.match(database, /epg_programmes_fts/);
  assert.match(database, /CREATE VIRTUAL TABLE/);
  assert.match(database, /toEpochSeconds/);
  assert.match(database, /PRAGMA quick_check/);
  assert.doesNotMatch(database, /deleteDatabase\(/);
  const bridge = await source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt");
  const search = await source("app/(tabs)/search.tsx");
  assert.match(bridge, /fun searchProgrammes/);
  assert.doesNotMatch(bridge, /fun getCurrent/);
  assert.doesNotMatch(database, /fun queryCurrent/);
  assert.match(search, /searchNativeEpg/);
});

test("manual EPG assignments persist through the authoritative native binding store", async () => {
  const [module, bridge, preferences, database] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgBindingNativeModule.kt"),
    source("src/nativeEpgBindings.ts"),
    source("src/core/epgSourcePreferences.ts"),
    source("android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt"),
  ]);
  assert.match(module, /fun setBinding\(channelId: String, xmltvId: String, promise: Promise\)/);
  assert.match(module, /dao\.setChannelBinding\(USER_SOURCE_ID, cleanChannelId, cleanXmltvId\)/);
  assert.match(bridge, /await nativeModule\.setBinding\(id, sourceId\)/);
  assert.match(preferences, /setNativeEpgBinding\(id, sourceId \|\| null\)\.catch/);
  assert.match(database, /fun setChannelBinding\(playlistId: String, channelId: String, xmltvId: String\)/);
});

test("EPG low-storage refusal closes already-open provider connections", async () => {
  const modules = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt"),
  ]);
  for (const native of modules) {
    const storageCheck = native.indexOf("assertRefreshStorageAvailable(declaredLength)");
    assert.notEqual(storageCheck, -1, "declared-length storage guard missing");
    const guarded = native.slice(Math.max(0, storageCheck - 700), storageCheck + 1800);
    assert.match(guarded, /try \{[\s\S]*assertRefreshStorageAvailable\(declaredLength\)/);
    assert.match(guarded, /catch \(t: Throwable\) \{\s*connection\.disconnect\(\);?\s*throw t/);
    assert.match(guarded, /FilterInputStream\(connection\.inputStream\)[\s\S]*finally \{\s*connection\.disconnect\(\)/);
  }
});

test("native provider transports close resources and bound provider waits", async () => {
  const [epg, custom, playlist] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt"),
  ]);
  for (const native of [epg, custom]) {
    assert.match(native, /val status = try \{[\s\S]{0,180}connection\.connect\(\)[\s\S]{0,120}connection\.responseCode[\s\S]{0,180}catch \(t: Throwable\) \{[\s\S]{0,100}connection\.disconnect\(\)/);
  }
  assert.match(playlist, /OkHttpClientProvider\.getOkHttpClient\(\)\.newBuilder\(\)/);
  assert.match(playlist, /\.callTimeout\(CALL_TIMEOUT_SECONDS, TimeUnit\.SECONDS\)/);
  assert.match(playlist, /ResponseClosingInputStream\(body\.byteStream\(\), response\)/);
  assert.match(playlist, /finally \{\s*response\.close\(\)/);
  assert.match(playlist, /private const val CALL_TIMEOUT_SECONDS = 90L/);
});

test("memory and logo work is bounded and releases native listeners", async () => {
  const [memory, ram, logo, local, glide, application] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/CharmMemoryCoordinator.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgRamEngine.kt"),
    source("src/components/ChannelLogo.tsx"),
    source("src/core/localLogoFolder.ts"),
    source("android/app/src/main/java/com/charmiptv/app/CharmGlideModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"),
  ]);
  assert.match(memory, /isLowRamDevice/);
  assert.match(memory, /BACKGROUND, MODERATE, CRITICAL/);
  assert.match(memory, /playbackStartingUntilMs/);
  assert.match(ram, /unregisterMemoryListener\(\)/);
  assert.match(logo, /MAX_URI_HISTORY = 192/);
  assert.match(logo, /maxLoadQueue = 48/);
  assert.match(logo, /inFlightWaiters/);
  assert.match(logo, /beginInFlight\(currentUri\)[\s\S]*requestLoadSlot/);
  assert.doesNotMatch(logo.match(/function joinInFlight[\s\S]*?\n}/)?.[0] || "", /inFlightWaiters\.delete/);
  assert.match(local, /MAX_FILES = 5000/);
  assert.match(local, /loadPromise/);
  assert.match(local, /cancelled/);
  assert.match(local, /resolvedCache\.clear\(\)/);
  assert.match(local, /resolvedCache\.size > 512/);
  assert.match(glide, /LOGO_DISK_CACHE_BYTES = 250L \* 1024L \* 1024L/);
  assert.match(glide, /Glide\.init/);
  assert.doesNotMatch(glide, /@GlideModule|AppGlideModule/);
  assert.match(application, /CharmGlideConfig\.initialize/);
  const remote = await source("android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt");
  assert.match(remote, /fun getDeviceMemoryProfile/);
  assert.match(remote, /playerCacheBytes/);
});

test("player recovery is bounded and history waits for stable playback", async () => {
  const [player, stream, patch, nativeSource] = await Promise.all([
    source("app/player.tsx"),
    source("src/components/StreamPlayer.tsx"),
    source("patches/expo-video+3.0.16.patch"),
    source("src/source.native.ts"),
  ]);
  assert.match(player, /STREAM_RETRY_DELAYS_MS = \[1000, 2000, 4000\]/);
  assert.match(player, /STABLE_HISTORY_DELAY_MS = 5000/);
  assert.doesNotMatch(player, /MAX_TOKEN_REFRESH_CHANNELS/);
  assert.match(stream, /BUFFERING_RESYNC_MS = 5000/);
  assert.match(stream, /BUFFERING_FAIL_MS = 22000/);
  assert.match(stream, /MAX_SILENT_BUFFERING_RESYNCS = 2/);
  assert.match(patch, /ConnectionPool\(15, 5, TimeUnit\.MINUTES\)/);
  assert.doesNotMatch(player, /refreshPlaylistOnly\(\)/);
  assert.match(nativeSource, /export async function refreshPlaylistOnly/);
  assert.doesNotMatch(nativeSource.match(/export async function refreshPlaylistOnly[\s\S]*?\n}\n/)?.[0] || "", /refreshNativeEpg/);
});
