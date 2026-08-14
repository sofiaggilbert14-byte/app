import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("native EPG v4 adds playlist/match tables and joined queryGuideWindow", async () => {
  const [db, mod, bridge] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("src/nativeEpg.ts"),
  ]);
  assert.match(db, /DATABASE_VERSION = 6/);
  assert.match(db, /playlist_channels/);
  assert.match(db, /playlist_epg_matches/);
  assert.match(db, /fun queryGuideWindow/);
  assert.match(db, /fun replacePlaylistChannels/);
  assert.match(db, /fun replacePlaylistEpgMatches/);
  assert.match(db, /idx_epg_staging_order/);
  assert.match(db, /INNER JOIN \$LIVE_TABLE p ON p\.channel_id = m\.xmltv_id/);
  assert.match(mod, /fun queryGuideWindow/);
  assert.match(mod, /fun upsertPlaylistChannels/);
  assert.match(mod, /fun upsertPlaylistEpgMatches/);
  assert.match(mod, /replaceChannelAliases\(aliases\)/);
  assert.match(bridge, /queryNativeGuideWindow/);
  assert.match(bridge, /upsertNativePlaylistChannels/);
  assert.match(bridge, /upsertNativePlaylistEpgMatches/);
  assert.match(mod, /fun isPlaylistCurrent/);
  assert.match(bridge, /nativePlaylistIsCurrent/);
});

test("source loadGuide uses one complete all-channel SQL join response", async () => {
  const native = await source("src/source.native.ts");
  assert.match(native, /queryNativeGuideWindow/);
  assert.doesNotMatch(native, /loadGuideProgramsForChannelIds/);
  assert.doesNotMatch(native, /buildFocusRing/);
  assert.match(native, /syncPlaylistToNative/);
  assert.match(native, /playlistNativeContentFingerprint/);
  assert.match(native, /nativePlaylistIsCurrent/);
  assert.match(native, /syncMatchesToNative/);
  assert.match(native, /programsByChannelId/);
  assert.match(native, /now\.startOf\("minute"\)\.subtract\(1, "hour"\)/);
  assert.match(native, /programmeWindowEmptyKeys/);
  assert.match(native, /loadProgrammeCacheMisses/);
  assert.match(native, /const playlistIds = Array\.from\(new Set\(allPlaylistIds\)\)/);
  assert.doesNotMatch(native, /allPlaylistIds\.slice\(0, 96\)/);
  assert.doesNotMatch(
    native,
    /for \(const id of allGuideIds\) \{\s*if \(have\.has\(id\)\) continue;\s*ring\.push\(id\);/,
  );
});

test("store publishes a complete snapshot and schedules no viewport patch work", async () => {
  const [store, gate, guide, timeline, programStore] = await Promise.all([
    source("src/store.tsx"),
    source("src/utils/guideSurfGate.ts"),
    source("app/(tabs)/guide.tsx"),
    source("src/components/TimelineGrid.tsx"),
    source("src/core/guideProgramsStore.ts"),
  ]);
  assert.match(store, /applyGuidePrograms/);
  assert.doesNotMatch(store, /const \[programsByChannelId, setProgramsByChannelId\]/);
  assert.match(store, /patchProgramsForChannelIds/);
  assert.doesNotMatch(store, /pendingPatchIdsRef|patchInFlightRef|flushProgramPatchQueue/);
  assert.match(store, /isGuideSurfing/);
  assert.match(store, /pendingSilentRefreshRef/);
  assert.match(store, /onGuideSurfSettled/);
  assert.match(programStore, /useSyncExternalStore/);
  assert.match(programStore, /maxProgrammeRows = 20_000/);
  assert.match(programStore, /setGuideProgramRowLimit/);
  assert.match(gate, /export function markGuideSurfing/);
  assert.match(gate, /export function isGuideSurfing/);
  assert.match(guide, /markGuideSurfing/);
  assert.doesNotMatch(guide, /patchProgramsForChannelIds|onViewportChannelIds=|lastRunwayRef/);
  assert.match(timeline, /useGuidePrograms/);
  assert.match(timeline, /data=\{channels\}/);
  assert.doesNotMatch(timeline, /preparedRows/);
  assert.doesNotMatch(timeline, /reclaimToken/);
  assert.doesNotMatch(timeline, /mountedBandRef/);
  assert.doesNotMatch(timeline, /disableProgramCull/);
  assert.match(timeline, /drawDistance=\{renderDrawDistance\}/);
});

test("complete guide keeps explicit empty rows and has no viewport slice", async () => {
  const [native, bridge, box, policy] = await Promise.all([
    source("src/source.native.ts"),
    source("src/nativeEpg.ts"),
    source("src/components/BoxGrid.tsx"),
    source("src/core/guideRunwayPolicy.ts"),
  ]);
  assert.match(bridge, /: EMPTY_NATIVE_PROGRAMS/);
  assert.match(native, /programsByChannelId\[channel\.id\] = emptyPrograms/);
  assert.match(native, /loadProgrammeCacheMisses\(remapped, playlistIds, startMs, endMs\)/);
  assert.doesNotMatch(native, /buildFocusRing|PROGRAMME_WARM_RING_ROWS/);
  assert.match(policy, /GUIDE_PREFETCH_PAGES_AHEAD = 8/);
  assert.match(native, /const playlistIds = Array\.from\(new Set\(allPlaylistIds\)\)/);
  assert.doesNotMatch(native, /allPlaylistIds\.slice\(0, 96\)/);
  assert.doesNotMatch(box, /mountedRowBandRef/);
  assert.match(box, /drawDistance=\{renderDrawDistance\}/);
});

test("native EPG uses HTTP validators and skips all rematch work on 304", async () => {
  const [mod, bridge, native] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("src/nativeEpg.ts"),
    source("src/source.native.ts"),
  ]);
  assert.match(mod, /If-None-Match/);
  assert.match(mod, /If-Modified-Since/);
  assert.match(mod, /HTTP_NOT_MODIFIED/);
  assert.match(mod, /putBoolean\("notModified", true\)/);
  assert.match(bridge, /notModified\?: boolean/);
  assert.equal(native.match(/refreshConfiguredNativeEpg\(true\)/g)?.length, 2);
  assert.equal(native.match(/if \(epg\.notModified/g)?.length, 2);
  assert.match(native, /if \(epg\.notModified\)/);
  assert.match(native, /return MEM;/);
});

test("native provider configuration preserves PR23 HTTPS-first behavior with HTTP fallback", async () => {
  const native = await source("src/source.native.ts");
  assert.match(native, /function providerHttpUrls/);
  assert.match(native, /\^https\?:\\\/\\\//i);
  assert.match(native, /return \[`https:\/\/\$\{value\.slice\(7\)\}`, value\]/);
  assert.match(native, /refreshNativeEpg\(candidate, allowNotModified\)/);
  assert.match(native, /const candidates = providerHttpUrls\(SOURCE_M3U, "playlist"\)/);
  assert.match(native, /if \(!isProviderTransportFailure\(error\)\) throw error/);
});

test("experimental EPG downloads first, parses locally, and hands finalized data directly to RAM", async () => {
  const [mod, db, ram, ramModule, bridge] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgRamEngine.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgRamModule.kt"),
    source("src/nativeEpg.ts"),
  ]);
  assert.match(mod, /downloadEpg\(url, httpValidators, allowNotModified\)/);
  assert.match(mod, /parseRetainedPrograms\(\s*downloaded\.file/);
  assert.match(mod, /database\.replacePrograms\(retainedPrograms\)/);
  assert.doesNotMatch(mod, /BATCH_SIZE|yield\(ArrayList\(batch\)\)/);
  assert.match(mod, /database\.readChannelIdsWithPrograms\(\)/);
  assert.match(mod, /finalizeRetainedPrograms\(parsedPrograms, minStop\)/);
  assert.match(mod, /runtime\.engine\.replacePrograms\(finalRetainedPrograms, minStop, maxStart\)/);
  assert.match(mod, /runtime\.warmGuideEpoch = -1L/);
  assert.match(db, /SELECT DISTINCT channel_id FROM \$LIVE_TABLE/);
  assert.match(mod, /File\.createTempFile\("xmltv-", "\.download"/);
  assert.match(mod, /downloaded\?\.file\?\.delete\(\)/);
  assert.match(mod, /GZIPInputStream\(buffered, FILE_BUFFER_SIZE\)/);
  assert.doesNotMatch(mod, /openPossiblyGzipped/);
  assert.match(db, /fun forEachProgramInWindow/);
  assert.match(db, /fun readPlaylistEpgMatches/);
  assert.match(ram, /database\.forEachProgramInWindow/);
  assert.match(ram, /database\.readPlaylistEpgMatches/);
  assert.match(ram, /generation\.incrementAndGet\(\)/);
  assert.match(ram, /fun replacePrograms\(programs: List<NativeEpgProgram>/);
  assert.match(ram, /EMPTY\.copy\(playlistToXmltv = current\.playlistToXmltv\)/);
  assert.match(ramModule, /scheduleWarmForCurrentEpoch\(\)/);
  assert.match(ramModule, /promise\.resolve\(null\)\s*return@execute/);
  assert.match(ramModule, /groupProgramsByOutput/);
  assert.match(ramModule, /sqliteFallbackCount/);
  assert.match(ramModule, /guideQueryDurationMs/);
  assert.match(ramModule, /if \(engine\.isWarm\(\)\) runtime\.warmGuideEpoch = currentGuideEpoch\(\)/);
  assert.doesNotMatch(bridge, /void ramModule\.warm\(result\.windowStartMs/);
});

test("Media3 silent audio soft-fails into VLC engine swap", async () => {
  const [player, session, ui] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("src/core/playbackSession.ts"),
    source("app/player.tsx"),
  ]);
  assert.match(session, /"silent-audio"/);
  assert.match(player, /SILENT_AUDIO_GRACE_MS/);
  assert.match(player, /availableAudioTracks/);
  assert.match(player, /silent-audio/);
  assert.match(player, /reason === "silent-audio"/);
  assert.match(ui, /no supported Media3 audio track/);
});

