import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = async (path) => (await readFile(join(root, path), "utf8")).replace(/\r\n/g, "\n");

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

  const onCreate = database.match(/override fun onCreate\(db: SQLiteDatabase\)[\s\S]*?\n  }\n\n  private fun createProgrammeTable/)?.[0] || "";
  assert.match(onCreate, /idx_playlist_active_position ON \$PLAYLIST_TABLE\(deleted_at, provider_position\)/);
});

test("cold-start Guide freshness follows active EPG ownership", async () => {
  const [custom, native] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
  ]);
  assert.match(custom, /val guideEpoch = if \(programmeSwapSucceeded\) previousGuideEpoch \+ 1L else previousGuideEpoch/);
  assert.match(custom, /targetDatabase\.setMeta\("guide_refreshed_at", guideRefreshedAt\.toString\(\)\)/);
  assert.match(native, /val extraSources = controlDao\.userSources\(\)[\s\S]*?val hasUserOwnership = \(userEnabled && userBindings\.isNotEmpty\(\)\) \|\| extraSources\.any/);
  assert.match(native, /val effectiveGuideEpoch =[\s\S]*?primaryGuideEpoch[\s\S]*?combinedUserGuideEpoch/);
  assert.match(native, /primaryEnabled && hasUserOwnership[\s\S]*?minOf\(primaryGuideRefreshedAt, combinedUserRefreshedAt\)/);
  assert.match(native, /hasUserOwnership -> combinedUserRefreshedAt/);
  assert.match(native, /putDouble\("guideRefreshedAt", effectiveGuideRefreshedAt\.toDouble\(\)\)/);
  assert.match(native, /putDouble\("epgProgramCount", effectiveProgramCount\.toDouble\(\)\)/);
});

test("zero source freshness remains due instead of falling back to playlist age", async () => {
  const native = await source("src/source.native.ts");
  assert.match(native, /const playlistLast = cached\.playlistRefreshedAt != null \? cached\.playlistRefreshedAt : cached\.ts/);
  assert.match(native, /const guideLast = cached\.guideRefreshedAt != null \? cached\.guideRefreshedAt : cached\.ts/);
  assert.doesNotMatch(native, /const guideLast = cached\.guideRefreshedAt \|\| cached\.ts/);
});

test("an unchanged provider response cannot fake a successful programme swap", async () => {
  const native = await source("src/source.native.ts");
  const unchanged = native.match(/if \(epg\.notModified\) \{[\s\S]*?return MEM;\n      \}/)?.[0] || "";
  assert.match(unchanged, /ts: checkedAt/);
  assert.match(unchanged, /guideRefreshedAt: cached\.guideRefreshedAt/);
  assert.doesNotMatch(unchanged, /guideRefreshedAt: checkedAt/);
});

test("disabling the primary guide uses active native ownership freshness", async () => {
  const native = await source("src/source.native.ts");
  const disabledBranches = [...native.matchAll(/if \(!ownership\.primaryEnabled\) \{[\s\S]*?return MEM;\n      \}/g)].map((match) => match[0]);
  assert.equal(disabledBranches.length, 2);
  for (const disabled of disabledBranches) {
    assert.match(disabled, /const effectiveGuide = await readNativeStoredPlaylist\(\)/);
    assert.match(disabled, /guideEpoch: effectiveGuide\?\.guideEpoch/);
    assert.match(disabled, /guideRefreshedAt: effectiveGuide\?\.guideRefreshedAt/);
    assert.doesNotMatch(disabled, /guideRefreshedAt: checkedAt/);
  }
});

test("native cold-start snapshot queries each EPG programme count once", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt");
  const stored = native.match(/fun getStoredPlaylist\(promise: Promise\)[\s\S]*?EPG_PLAYLIST_UPSERT_FAILED/)?.[0] || native;
  assert.match(stored, /val primaryProgramCount = database\.count\(\)/);
  assert.match(stored, /val userProgramCount = userDatabase\.count\(\)/);
  assert.match(stored, /putDouble\("primaryEpgProgramCount", primaryProgramCount\.toDouble\(\)\)/);
  assert.match(stored, /putDouble\("userEpgProgramCount", userProgramCount\.toDouble\(\)\)/);
});

test("source scheduler cannot bypass the 30-second cold-start refresh deferral", async () => {
  const [scheduler, nativeSource] = await Promise.all([
    source("src/components/SourceRefreshScheduler.tsx"),
    source("src/source.native.ts"),
  ]);
  assert.match(scheduler, /const initialTimer = setTimeout\(\(\) => void check\(\), 30_000\)/);
  assert.match(scheduler, /clearTimeout\(initialTimer\)/);
  assert.doesNotMatch(scheduler, /\n    void check\(\);\n    const timer/);
  assert.doesNotMatch(nativeSource, /scheduleStartupSourceRefresh|STARTUP_SOURCE_REFRESH_DELAY_MS/);
});

test("AppState resume cannot bypass the automatic cold-start source gate", async () => {
  const scheduler = await source("src/components/SourceRefreshScheduler.tsx");
  assert.match(scheduler, /const automaticRefreshEligibleAt = Date\.now\(\) \+ 30_000/);
  assert.match(scheduler, /const stillOwner = \(\) => !cancelled && generation === schedulerGeneration && active/);
  assert.match(scheduler, /if \(!screenIsSafe\(\) \|\| running \|\| Date\.now\(\) < automaticRefreshEligibleAt\) return/);
  assert.match(scheduler, /if \(active\) void check\(\)/);
});

test("legacy cleanup preserves the channel cache until native migration can promote it", async () => {
  const [cleanup, nativeSource] = await Promise.all([
    source("src/utils/legacyEpgCleanup.ts"),
    source("src/source.native.ts"),
  ]);
  assert.match(cleanup, /LEGACY_CHANNEL_CACHE = "charm_native_channels_v1\.json"/);
  assert.match(cleanup, /if \(name === LEGACY_CHANNEL_CACHE\) continue/);
  const coldStart = nativeSource.match(/async function ensureLoaded\(\)[\s\S]*?\n}\n\nasync function refreshInternal/)?.[0] || "";
  assert.match(coldStart, /const legacy = await readMetaFile\(LEGACY_CHANNEL_CACHE\)/);
  assert.match(coldStart, /await persistMeta\(MEM\)/);
});

test("Guide defaults to 12 hours while saved user choices remain supported", async () => {
  const [env, store] = await Promise.all([
    source(".env"),
    source("src/store.tsx"),
  ]);
  assert.match(env, /^EXPO_PUBLIC_GUIDE_WINDOW_HOURS=12$/m);
  assert.match(store, /type GuideWindowHours = 6 \| 8 \| 12 \| 24/);
  assert.match(store, /storage\.getItem<number>\(GUIDE_WINDOW_HOURS_KEY, DEFAULT_GUIDE_WINDOW_HOURS\)/);
  assert.match(store, /if \(n === 6 \|\| n === 8 \|\| n === 12 \|\| n === 24\) return n/);
});

test("group-tab customization is not part of Android source startup", async () => {
  const nativeSource = await source("src/source.native.ts");
  assert.doesNotMatch(nativeSource, /guideGroupTab|customGuideGroups|guideGroups|group-settings/);
  assert.match(nativeSource, /const nativeCached = await readNativeChannelCache\(\)/);
  assert.match(nativeSource, /const cached = nativeCached \|\| \(await readChannelCache\(\)\)/);
});

test("EPG cold-start logo lookup has an additive alias-kind/channel index", async () => {
  const db = await source("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt");
  assert.match(db, /DATABASE_VERSION = 10/);
  assert.match(db, /idx_epg_alias_kind_channel ON \$ALIAS_TABLE\(alias_kind, channel_id\)/);
  assert.match(db, /if \(oldVersion < 10\)/);
  assert.doesNotMatch(db, /DROP TABLE[\s\S]*oldVersion < 10/);
});

test("Android SQLite PRAGMA operations use query cursors instead of execSQL", async () => {
  const db = await source("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt");
  assert.match(db, /private fun runPragma\(db: SQLiteDatabase, sql: String\)/);
  assert.match(db, /db\.rawQuery\(sql, null\)\.use/);
  assert.doesNotMatch(db, /execSQL\("PRAGMA/);
  for (const pragma of ["journal_mode=WAL", "synchronous=NORMAL", "busy_timeout=3000", "temp_store=MEMORY", "wal_checkpoint(PASSIVE)", "incremental_vacuum(64)"]) {
    assert.match(db, new RegExp(`runPragma\\([^\\n]+PRAGMA ${pragma.replace(/[()]/g, "\\$&")}`));
  }
});

test("custom EPG last-good retention does not fake a successful programme refresh", async () => {
  const custom = await source("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt");
  assert.match(custom, /var programmeSwapSucceeded = false/);
  assert.match(custom, /targetDatabase\.replaceBatches\(batches\)[\s\S]{0,100}programmeSwapSucceeded = true/);
  assert.match(custom, /val guideEpoch = if \(programmeSwapSucceeded\) previousGuideEpoch \+ 1L else previousGuideEpoch/);
  assert.match(custom, /val guideRefreshedAt = if \(programmeSwapSucceeded\) now else previousGuideRefreshedAt/);
  assert.match(custom, /if \(programmeSwapSucceeded\) \{[\s\S]*?targetDatabase\.setMeta\("guide_refreshed_at"/);
  assert.match(custom, /putBoolean\("programmeSwapSucceeded", programmeSwapSucceeded\)/);
});

test("custom EPG retained-guide refresh result reaches the TV UI", async () => {
  const [bridge, screen] = await Promise.all([
    source("src/nativeEpg.ts"),
    source("app/epg-custom.tsx"),
  ]);
  assert.match(bridge, /programmeSwapSucceeded\?: boolean/);
  assert.match(screen, /result\.programmeSwapSucceeded === false/);
  assert.match(screen, /Keeping the previous guide/);
});

test("custom EPG channel assignment does not block remote focus on a full XMLTV refresh", async () => {
  const [bridge, screen] = await Promise.all([
    source("src/nativeEpg.ts"),
    source("app/epg-custom.tsx"),
  ]);
  assert.doesNotMatch(bridge, /if \(normalizedXmltvId && userGuideEnabled && userGuideUrl\) \{\s*await refreshNativeUserGuide/);
  assert.match(bridge, /void refreshNativeUserGuide\(userGuideUrl\)\.catch/);
  assert.match(bridge, /deferred custom EPG hydration failed/);
  assert.match(screen, /Guide data will update without blocking navigation/);
});

test("zero custom EPG bindings retain last-good programme data", async () => {
  const custom = await source("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt");
  const zeroBindings = custom.match(/if \(activeXmltvIds\.isEmpty\(\)\) \{[\s\S]*?\} else \{/);
  assert.ok(zeroBindings, "zero-binding branch missing");
  assert.doesNotMatch(zeroBindings[0], /(?:userDatabase|targetDatabase)\.clear\(\)/);
  assert.doesNotMatch(zeroBindings[0], /targetDatabase\.replaceBatches\(batches\)/);
  assert.match(zeroBindings[0], /for \(ignored in batches\) Unit/);
});
