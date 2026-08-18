import test from "node:test";
import assert from "node:assert/strict";
import { applyManualEpgRemaps } from "../src/core/epgUserOverrides.ts";
import {
  getPowerProfileTuning,
  setDeviceLowRamCacheCap,
} from "../src/core/devicePowerProfile.ts";

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
