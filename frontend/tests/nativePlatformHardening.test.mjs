import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (name) => readFile(path.join(root, name), "utf8");

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
  assert.match(search, /searchNativeEpg/);
});

test("memory and logo work is bounded and releases native listeners", async () => {
  const [memory, ram, logo, local] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/CharmMemoryCoordinator.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgRamEngine.kt"),
    source("src/components/ChannelLogo.tsx"),
    source("src/core/localLogoFolder.ts"),
  ]);
  assert.match(memory, /isLowRamDevice/);
  assert.match(memory, /BACKGROUND, MODERATE, CRITICAL/);
  assert.match(memory, /playbackStartingUntilMs/);
  assert.match(ram, /unregisterMemoryListener\(\)/);
  assert.match(logo, /MAX_URI_HISTORY = 192/);
  assert.match(logo, /maxLoadQueue = 48/);
  assert.match(logo, /inFlightWaiters/);
  assert.match(local, /MAX_FILES = 5000/);
  assert.match(local, /resolvedCache\.size > 512/);
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
  assert.match(stream, /FROZEN_VIDEO_WATCHDOG_MS = 5000/);
  assert.match(patch, /ConnectionPool\(8, 5, TimeUnit\.MINUTES\)/);
  assert.match(player, /refreshPlaylistOnly\(\)/);
  assert.match(nativeSource, /export async function refreshPlaylistOnly/);
  assert.doesNotMatch(nativeSource.match(/export async function refreshPlaylistOnly[\s\S]*?\n}\n/)?.[0] || "", /refreshNativeEpg/);
});
