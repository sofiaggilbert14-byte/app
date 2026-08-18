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
  assert.match(customize, /async function persist\(previous: Snapshot, next: Snapshot\)/);
  assert.match(customize, /previous\.hiddenIds !== next\.hiddenIds/);
  assert.match(customize, /previous\.customOrder !== next\.customOrder/);
  assert.match(customize, /previous\.customNumbers !== next\.customNumbers/);
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
