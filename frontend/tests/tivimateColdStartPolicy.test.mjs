import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("TiviMate-style native cold start is read-only while successful provider refresh advances its own clock", async () => {
  const [appSource, bridge, nativeModule, database] = await Promise.all([
    source("src/source.native.ts"),
    source("src/nativeEpg.ts"),
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt"),
  ]);

  const coldStart = appSource.match(/async function ensureLoaded\(\)[\s\S]*?\n}\n\nasync function refreshInternal/)?.[0] || "";
  assert.match(coldStart, /const nativeCached = await readNativeChannelCache\(\)/);
  assert.match(coldStart, /if \(!nativeCached\) \{[\s\S]*?syncPlaylistToNative\(cached\.channels/);
  assert.doesNotMatch(coldStart, /if \(nativeCached\)[\s\S]*?syncPlaylistToNative/);
  assert.doesNotMatch(coldStart, /touchNativePlaylistRefresh/);

  const fullRefresh = appSource.match(/async function refreshInternal\(force: boolean\)[\s\S]*?export async function refreshSource/)?.[0] || "";
  assert.match(fullRefresh, /channels = await fetchPlaylist\(\)/);
  assert.match(fullRefresh, /await syncPlaylistToNative\(channels, playlistEpoch\);[\s\S]*?await touchNativePlaylistRefresh\(playlistEpoch\);/);

  const playlistOnly = appSource.match(/export async function refreshPlaylistOnly\(\)[\s\S]*?\/\*\* Check persisted/)?.[0] || "";
  assert.match(playlistOnly, /const fresh = await fetchPlaylist\(\)/);
  assert.match(playlistOnly, /await syncPlaylistToNative\(channels, playlistEpoch\);[\s\S]*?await touchNativePlaylistRefresh\(playlistEpoch\);/);

  assert.match(bridge, /touchPlaylistRefresh\?\(playlistEpoch: number\): Promise<boolean>/);
  assert.match(bridge, /export async function touchNativePlaylistRefresh\(playlistEpoch: number\): Promise<void>/);
  assert.match(nativeModule, /fun touchPlaylistRefresh\(playlistEpoch: Double, promise: Promise\)/);
  assert.match(nativeModule, /database\.setMeta\("playlist_refreshed_at", now\.toString\(\)\)/);

  // Fresh installs and upgraded installs must both support provider-order reads efficiently.
  const onCreate = database.match(/override fun onCreate\(db: SQLiteDatabase\)[\s\S]*?\n  }\n\n  private fun createProgrammeTable/)?.[0] || "";
  assert.match(onCreate, /idx_playlist_active_position ON \$PLAYLIST_TABLE\(deleted_at, provider_position\)/);
});
