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

test("source loadGuide uses SQL join path and exact-runway programme patches", async () => {
  const native = await source("src/source.native.ts");
  assert.match(native, /queryNativeGuideWindow/);
  assert.match(native, /loadGuideProgramsForChannelIds/);
  assert.doesNotMatch(native, /buildFocusRing/);
  assert.match(native, /syncPlaylistToNative/);
  assert.match(native, /playlistNativeContentFingerprint/);
  assert.match(native, /nativePlaylistIsCurrent/);
  assert.match(native, /syncMatchesToNative/);
  assert.match(native, /programsByChannelId/);
  assert.match(native, /now\.startOf\("minute"\)\.subtract\(1, "hour"\)/);
  assert.match(native, /programmeWindowEmptyKeys/);
  assert.match(native, /loadProgrammeCacheMisses/);
  assert.doesNotMatch(
    native,
    /for \(const id of allGuideIds\) \{\s*if \(have\.has\(id\)\) continue;\s*ring\.push\(id\);/,
  );
});

test("store patches per-row programmes and defers silent refresh while surfing", async () => {
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
  assert.match(store, /pendingPatchIdsRef/);
  assert.match(store, /patchInFlightRef/);
  assert.match(store, /isGuideSurfing/);
  assert.match(store, /pendingSilentRefreshRef/);
  assert.match(store, /onGuideSurfSettled/);
  assert.match(programStore, /useSyncExternalStore/);
  assert.match(programStore, /maxProgrammeRows = 1800/);
  assert.match(programStore, /setGuideProgramRowLimit/);
  assert.match(gate, /export function markGuideSurfing/);
  assert.match(gate, /export function isGuideSurfing/);
  assert.match(guide, /markGuideSurfing/);
  assert.match(guide, /patchProgramsForChannelIds/);
  assert.match(guide, /void patchProgramsForChannelIds\(ids, priorityIds\)/);
  assert.match(timeline, /useGuidePrograms/);
  assert.match(timeline, /data=\{channels\}/);
  assert.doesNotMatch(timeline, /preparedRows/);
  assert.doesNotMatch(timeline, /reclaimToken/);
  assert.doesNotMatch(timeline, /mountedBandRef/);
  assert.doesNotMatch(timeline, /disableProgramCull/);
  assert.match(timeline, /drawDistance=\{renderDrawDistance\}/);
});

test("programme deltas keep explicit empty rows and use the exact screen runway", async () => {
  const [native, bridge, box, policy] = await Promise.all([
    source("src/source.native.ts"),
    source("src/nativeEpg.ts"),
    source("src/components/BoxGrid.tsx"),
    source("src/core/guideRunwayPolicy.ts"),
  ]);
  assert.match(bridge, /: EMPTY_NATIVE_PROGRAMS/);
  assert.match(native, /delta\[id\] = cached\?\.length \? cached : EMPTY_PROGRAMS/);
  assert.match(native, /Object\.fromEntries\(unique\.map\(\(id\) => \[id, EMPTY_PROGRAMS\]\)\)/);
  assert.match(native, /loadProgrammeCacheMisses\(remapped, unique, startMs, endMs\)/);
  assert.doesNotMatch(native, /buildFocusRing|PROGRAMME_WARM_RING_ROWS/);
  assert.match(policy, /GUIDE_PREFETCH_PAGES_AHEAD = 8/);
  assert.match(native, /allPlaylistIds\.slice\(0, 96\)/);
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
  assert.match(native, /refreshNativeEpg\(https\(SOURCE_EPG\), false\)/);
  assert.match(native, /refreshNativeEpg\(https\(SOURCE_EPG\), true\)/);
  assert.match(native, /if \(epg\.notModified\)/);
  assert.match(native, /return MEM;/);
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
