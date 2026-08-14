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

test("loadGuide retains the complete bounded playlist snapshot", async () => {
  const nativeSource = await readFile(join(root, "src/source.native.ts"), "utf8");
  assert.match(nativeSource, /const playlistIds = Array\.from\(new Set\(allPlaylistIds\)\)/);
  assert.match(nativeSource, /maxProgrammeWindowKeys = 20_000/);
  assert.doesNotMatch(nativeSource, /trimProgrammeWindowCache\(playlistIds/);
});

test("full-guide store has no sliding queues or background patch timer", async () => {
  const store = await readFile(join(root, "src/store.tsx"), "utf8");
  assert.doesNotMatch(store, /lastKeepIdsRef|pendingPatchIdsRef|patchTimerRef|flushProgramPatchQueue/);
  assert.match(store, /Full-guide delivery keeps all rows resident/);
});

test("prepared program orphan map stays bounded to current + focused keys", async () => {
  const timeline = await readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8");
  assert.match(timeline, /previousPreparedByKeyRef/);
  assert.match(timeline, /keepKeys\.add\(focusedProgramKey\)/);
  assert.match(timeline, /previousPreparedByKeyRef\.current\.delete\(key\)/);
  assert.match(timeline, /pendingProgramCellHidden/);
  assert.doesNotMatch(timeline, /setPreferFirstRow\(true\);\s*const clearPreferred = setTimeout\(\(\) => setPreferFirstRow\(false\), 700\)/);
});

test("critical trim can force-evict subscribed off-keep programme rows", async () => {
  const programStore = await readFile(join(root, "src/core/guideProgramsStore.ts"), "utf8");
  assert.match(programStore, /force\?: boolean/);
  assert.match(programStore, /trim\(keep, critical\)/);
  assert.match(programStore, /if \(!force && \(listenersByChannelId\.get/);
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

test("guide focus does not rewarm or schedule guide data work", async () => {
  const [guide, sliding] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "src/core/guideSlidingCache.ts"), "utf8"),
  ]);
  assert.doesNotMatch(guide, /lastRunwayRef|buildChannelIndexMap|onViewportChannelIds=/);
  assert.match(guide, /cacheProfile=\{powerProfile\}/);
  assert.match(sliding, /export function buildChannelIndexMap/);
  assert.match(sliding, /indexById\?: ReadonlyMap/);
});

