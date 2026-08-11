import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("clearGuideCache also clears in-memory guide programme rows", async () => {
  const [nativeSource, webSource] = await Promise.all([
    readFile(join(root, "src/source.native.ts"), "utf8"),
    readFile(join(root, "src/source.ts"), "utf8"),
  ]);
  assert.match(nativeSource, /clearGuidePrograms\(\)/);
  assert.match(webSource, /clearGuidePrograms/);
});

test("loadGuide soft-trims so conveyor hysteresis survives refresh", async () => {
  const nativeSource = await readFile(join(root, "src/source.native.ts"), "utf8");
  assert.match(nativeSource, /trimProgrammeWindowCache\(playlistIds, "soft"\)/);
  assert.doesNotMatch(
    nativeSource,
    /trimProgrammeWindowCache\(playlistIds, viewportGuideChannelIds\?\.length \? "strict" : "soft"\)/,
  );
});

test("sliding cache retains expanded keep set and strict-releases on blur", async () => {
  const store = await readFile(join(root, "src/store.tsx"), "utf8");
  assert.match(store, /lastKeepIdsRef/);
  assert.match(store, /retainGuidePrograms\(keep\)/);
  assert.match(store, /retainProgrammeWindowCache\(keep\)/);
  assert.match(store, /const keep = lastKeepIdsRef\.current\.length/);
});

test("focusClaimNonce reclaim ignores channels identity churn", async () => {
  const [timeline, box] = await Promise.all([
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/BoxGrid.tsx"), "utf8"),
  ]);
  assert.match(timeline, /\[focusClaimNonce, restoreChannelId\]/);
  assert.match(box, /\[focusClaimNonce, restoreChannelId\]/);
  assert.doesNotMatch(timeline, /\[channels, focusClaimNonce, restoreChannelId\]/);
  assert.doesNotMatch(box, /\[channels, focusClaimNonce, restoreChannelId\]/);
});
