import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyManualEpgRemaps } from "../src/core/epgUserOverrides.ts";
import {
  getPowerProfileTuning,
  setDeviceLowRamCacheCap,
} from "../src/core/devicePowerProfile.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("manual EPG remap no-op preserves the original channel array", () => {
  const channels = [
    { id: "one", tvg_id: "epg.one", name: "One" },
    { id: "two", tvg_id: "epg.two", name: "Two" },
  ];
  const same = applyManualEpgRemaps(channels, {
    one: "epg.one",
    two: "epg.two",
  });
  assert.equal(same, channels);

  const changed = applyManualEpgRemaps(channels, { two: "epg.changed" });
  assert.notEqual(changed, channels);
  assert.equal(changed[0], channels[0]);
  assert.notEqual(changed[1], channels[1]);
  assert.equal(changed[1].tvg_id, "epg.changed");
});

test("low-RAM device cap wins over larger user performance profiles", () => {
  setDeviceLowRamCacheCap(false);
  assert.equal(getPowerProfileTuning("normal").programmeRowCacheLimit, 720);
  assert.equal(getPowerProfileTuning("max_preview").programmeRowCacheLimit, 960);

  setDeviceLowRamCacheCap(true);
  assert.equal(getPowerProfileTuning("normal").programmeRowCacheLimit, 320);
  assert.equal(getPowerProfileTuning("max_preview").programmeRowCacheLimit, 320);
  assert.equal(getPowerProfileTuning("weak").programmeRowCacheLimit, 320);

  setDeviceLowRamCacheCap(false);
});

test("channel customization writes only the state blob that changed", async () => {
  const customize = await readFile(join(root, "src/core/channelCustomize.ts"), "utf8");
  assert.match(customize, /function persist\(previous: Snapshot, next: Snapshot\): void/);
  assert.match(customize, /previous\.hiddenIds !== next\.hiddenIds/);
  assert.match(customize, /previous\.customOrder !== next\.customOrder/);
  assert.match(customize, /previous\.customNumbers !== next\.customNumbers/);
  assert.match(customize, /pendingDirty\.hiddenIds = true/);
  assert.match(customize, /pendingDirty\.customOrder = true/);
  assert.match(customize, /pendingDirty\.customNumbers = true/);
  assert.match(customize, /void flushPersistence\(\)/);
  assert.doesNotMatch(
    customize,
    /Promise\.all\(\[\s*storage\.setItem\(HIDDEN_KEY[\s\S]*storage\.setItem\(ORDER_KEY[\s\S]*storage\.setItem\(NUMBERS_KEY/,
  );
});

test("playlist-only refresh reuses native parser rows instead of cloning the full playlist", async () => {
  const source = await readFile(join(root, "src/source.native.ts"), "utf8");
  const refreshOnly = source.match(/export async function refreshPlaylistOnly[\s\S]*?\n}\n\n\/\*\* Check persisted/)?.[0] || "";
  assert.match(refreshOnly, /const oldById = new Map<string, Channel>\(\)/);
  assert.match(refreshOnly, /for \(const channel of fresh\)/);
  assert.match(refreshOnly, /channel\.tvg_id = previous\.tvg_id \|\| channel\.tvg_id/);
  assert.match(refreshOnly, /const channels = fresh/);
  assert.doesNotMatch(refreshOnly, /new Map\(\(cached\?\.channels \|\| \[\]\)\.map/);
  assert.doesNotMatch(refreshOnly, /const channels = fresh\.map/);
});


test("direct IPTV sources preserve HTTP and cache writes avoid reparsing the old full channel graph", async () => {
  const source = await readFile(join(root, "src/source.native.ts"), "utf8");
  assert.match(source, /function sourceUrl\(url: string\)/);
  assert.doesNotMatch(source, /startsWith\("http:\/\/"\).*https:/s);
  assert.match(source, /fetchNativePlaylist\(sourceUrl\(SOURCE_M3U\)\)/);
  assert.match(source, /refreshNativeEpg\([\s\S]*?sourceUrl\(SOURCE_EPG\)/);
  assert.doesNotMatch(source, /const validCurrent = await readMetaFile\(CHANNEL_CACHE\)/);
  assert.match(source, /channelCacheKnownGood/);
  assert.match(source, /channelCacheKnownGood = restored/);
  assert.match(source, /priorityMatchChannelIds = \[\]/);
});

test("large-list UI paths skip redundant whole-list sorting and Android legacy programme scans", async () => {
  const [guide, home, player, search, logo] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/index.tsx"), "utf8"),
    readFile(join(root, "app/player.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/search.tsx"), "utf8"),
    readFile(join(root, "src/components/ChannelLogo.tsx"), "utf8"),
  ]);
  assert.match(guide, /if \(!channelNumbers\) return result/);
  assert.doesNotMatch(guide, /\[\.\.\.channels\]\.sort\(/);
  assert.match(home, /if \(!channelNumbers\) return result/);
  assert.doesNotMatch(home, /channels\.slice\(\)[\s\S]{0,100}\.sort\(/);
  assert.doesNotMatch(player, /\[\.\.\.channels\]\.sort\(/);
  assert.doesNotMatch(player, /\[\.\.\.recent, \.\.\.streamChannels\]/);
  assert.match(search, /if \(Platform\.OS === "web"\)/);
  assert.match(logo, /useLocalLogo\(!disabled && visible \? name : ""\)/);
});

test("custom ordering uses one coalescing storage writer", async () => {
  const customize = await readFile(join(root, "src/core/channelCustomize.ts"), "utf8");
  assert.match(customize, /let persistRunning = false/);
  assert.match(customize, /async function flushPersistence\(\)/);
  assert.match(customize, /const snapshot = cached/);
  assert.match(customize, /void flushPersistence\(\)/);
});

test("Guide fixed start preference is entry-scoped and explicit jumps override it", async () => {
  const guide = await readFile(join(root, "app/(tabs)/guide.tsx"), "utf8");
  assert.match(guide, /peekGuideJump/);
  assert.match(guide, /startPreferenceAppliedRef/);
  assert.doesNotMatch(guide, /let guideStartPreferenceApplied = false/);
  assert.match(guide, /startPreferenceAppliedRef\.current = true;[\s\S]{0,120}const nextGroup = jump\.group/);
});

test("EPG-only refresh coalesces with active source work and avoids cold-start promise cycles", async () => {
  const source = await readFile(join(root, "src/source.native.ts"), "utf8");
  const epgOnly = source.match(/export async function refreshEpgOnly\(\)[\s\S]*?\n}\n\nexport function sourceStatus/)?.[0] || "";
  assert.match(epgOnly, /if \(refreshPromise\) \{[\s\S]{0,160}await refreshPromise;[\s\S]{0,120}return sourceStatus\(\)/);
  assert.match(epgOnly, /const cached = MEM \|\| \(await readChannelCache\(\)\)/);
  assert.match(epgOnly, /if \(!cached\?\.channels\?\.length\) \{[\s\S]{0,160}await refreshInternal\(true\);[\s\S]{0,100}return sourceStatus\(\)/);
  assert.ok(
    epgOnly.indexOf('const cached = MEM || (await readChannelCache())') < epgOnly.indexOf('refreshPromise = (async () => {'),
    "cold source fallback must resolve before EPG-only owns refreshPromise",
  );
  assert.doesNotMatch(epgOnly, /refreshPromise = \(async \(\) => \{[\s\S]{0,240}return refreshInternal\(true\)/);
});

test("native custom channel order is indexed with a non-destructive Room migration", async () => {
  const db = await readFile(join(root, "android/app/src/main/java/com/charmiptv/app/CharmCustomizationDatabase.kt"), "utf8");
  assert.match(db, /indices = \[Index\("customPosition"\)\]/);
  assert.match(db, /version = 2/);
  assert.match(db, /Migration\(1, 2\)/);
  assert.match(db, /CREATE INDEX IF NOT EXISTS index_user_channel_customization_customPosition/);
  assert.match(db, /\.addMigrations\(MIGRATION_1_2\)/);
  assert.doesNotMatch(db, /fallbackToDestructiveMigration/);
});

test("customization snapshot uses SQLite indexed order instead of Kotlin resort", async () => {
  const mod = await readFile(join(root, "android/app/src/main/java/com/charmiptv/app/CustomizationNativeModule.kt"), "utf8");
  const snapshot = mod.match(/fun getSnapshot\(promise: Promise\)[\s\S]*?promise\.resolve/)?.[0] || "";
  assert.match(snapshot, /val orderPairs = dao\.orderedChannels\(\)/);
  assert.doesNotMatch(snapshot, /filter \{ it\.customPosition != null \}[\s\S]*?sortedBy/);
});

test("custom group snapshot avoids all-mapping groupBy duplication", async () => {
  const mod = await readFile(join(root, "android/app/src/main/java/com/charmiptv/app/CustomizationNativeModule.kt"), "utf8");
  const snapshot = mod.match(/fun getSnapshot\(promise: Promise\)[\s\S]*?promise\.resolve/)?.[0] || "";
  assert.match(snapshot, /val groupMappings = dao\.mappings\(group\.id\)/);
  assert.doesNotMatch(snapshot, /dao\.allMappings\(\)\.groupBy/);
});

test("moving one custom channel swaps only indexed adjacent rows", async () => {
  const db = await readFile(join(root, "android/app/src/main/java/com/charmiptv/app/CharmCustomizationDatabase.kt"), "utf8");
  const move = db.match(/fun moveChannel\(channelId: String, direction: Int\)[\s\S]*?\n  }/)?.[0] || "";
  assert.match(db, /fun positionedChannel\(channelId: String\)/);
  assert.match(db, /fun previousPositionedChannel\(position: Int\)/);
  assert.match(db, /fun nextPositionedChannel\(position: Int\)/);
  assert.match(move, /val current = positionedChannel\(channelId\) \?: return/);
  assert.match(move, /previousPositionedChannel\(position\)/);
  assert.match(move, /nextPositionedChannel\(position\)/);
  assert.doesNotMatch(move, /orderedChannels\(\)|indexOfFirst/);
});

test("native playlist fingerprint tracks provider playback fields without changing user identity", async () => {
  const source = await readFile(join(root, "src/source.native.ts"), "utf8");
  const fp = source.match(/function playlistNativeContentFingerprint[\s\S]*?\n}/)?.[0] || "";
  assert.match(fp, /channel\.url \|\| ""/);
  assert.match(fp, /channel\.stream_type \|\| "unknown"/);
  assert.match(fp, /\$\{position\}/);
  assert.match(fp, /playlist-v2:/);
  const identity = source.match(/function playlistIdentityFingerprint[\s\S]*?\n}/)?.[0] || "";
  assert.doesNotMatch(identity, /channel\.url/);
});
