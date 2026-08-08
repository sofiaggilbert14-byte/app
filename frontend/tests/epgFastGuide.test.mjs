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
  assert.match(db, /DATABASE_VERSION = 4/);
  assert.match(db, /playlist_channels/);
  assert.match(db, /playlist_epg_matches/);
  assert.match(db, /fun queryGuideWindow/);
  assert.match(db, /fun replacePlaylistChannels/);
  assert.match(db, /fun replacePlaylistEpgMatches/);
  assert.match(db, /INNER JOIN \$LIVE_TABLE p ON p\.channel_id = m\.xmltv_id/);
  assert.match(mod, /fun queryGuideWindow/);
  assert.match(mod, /fun upsertPlaylistChannels/);
  assert.match(mod, /fun upsertPlaylistEpgMatches/);
  assert.match(mod, /replaceChannelAliases\(aliases\)/);
  assert.match(bridge, /queryNativeGuideWindow/);
  assert.match(bridge, /upsertNativePlaylistChannels/);
  assert.match(bridge, /upsertNativePlaylistEpgMatches/);
});

test("source loadGuide uses SQL join path and focus-ring programme patches", async () => {
  const native = await source("src/source.native.ts");
  assert.match(native, /queryNativeGuideWindow/);
  assert.match(native, /loadGuideProgramsForChannelIds/);
  assert.match(native, /buildFocusRing/);
  assert.match(native, /syncPlaylistToNative/);
  assert.match(native, /syncMatchesToNative/);
  assert.match(native, /programsByChannelId/);
  assert.doesNotMatch(
    native,
    /for \(const id of allGuideIds\) \{\s*if \(have\.has\(id\)\) continue;\s*ring\.push\(id\);/,
  );
});

test("store normalizes programmes and defers silent refresh while surfing", async () => {
  const [store, gate, guide] = await Promise.all([
    source("src/store.tsx"),
    source("src/utils/guideSurfGate.ts"),
    source("app/(tabs)/guide.tsx"),
  ]);
  assert.match(store, /programsByChannelId/);
  assert.match(store, /patchProgramsForChannelIds/);
  assert.match(store, /isGuideSurfing/);
  assert.match(store, /pendingSilentRefreshRef/);
  assert.match(store, /onGuideSurfSettled/);
  assert.match(gate, /export function markGuideSurfing/);
  assert.match(gate, /export function isGuideSurfing/);
  assert.match(guide, /markGuideSurfing/);
  assert.match(guide, /patchProgramsForChannelIds/);
  assert.match(guide, /void patchProgramsForChannelIds\(ids\)/);
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
  assert.match(ui, /no audio on Media3/);
});
