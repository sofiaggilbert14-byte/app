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

test("loadGuide retains only a bounded runway for a configurable forward window", async () => {
  const nativeSource = await readFile(join(root, "src/source.native.ts"), "utf8");
  assert.match(nativeSource, /allPlaylistIds\.slice\(0, INITIAL_GUIDE_RUNWAY_ROWS\)/);
  assert.match(nativeSource, /resolveGuideWindowHours\(hours, DEFAULT_GUIDE_WINDOW_HOURS\)/);
  assert.match(nativeSource, /maxProgrammeWindowKeys = 1800/);
  assert.match(nativeSource, /trimProgrammeWindowCache\(playlistIds, "soft"\)/);
});

test("sliding store supersedes pending runways and strictly retains the newest one", async () => {
  const store = await readFile(join(root, "src/store.tsx"), "utf8");
  assert.match(store, /lastKeepIdsRef|pendingPatchIdsRef|patchTimerRef|flushProgramPatchQueue/);
  assert.match(store, /retainGuidePrograms\(keep\)/);
});

test("critical pressure strictly trims both JS programme owners without deleting SQLite", async () => {
  const [store, nativeSource] = await Promise.all([
    readFile(join(root, "src/store.tsx"), "utf8"),
    readFile(join(root, "src/source.native.ts"), "utf8"),
  ]);
  assert.match(store, /pressure === "critical"[\s\S]*retainGuidePrograms\(keep, \{ force: true \}\)/);
  assert.match(store, /trimProgrammeWindowCacheForMemoryPressure\(keep, critical\)/);
  assert.doesNotMatch(nativeSource, /database\.clear\(\)[\s\S]*trimProgrammeWindowCacheForMemoryPressure/);
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

test("guide focus rewarms only its last bounded runway", async () => {
  const [guide, sliding] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "src/core/guideSlidingCache.ts"), "utf8"),
  ]);
  assert.match(guide, /lastRunwayRef|buildChannelIndexMap/);
  assert.match(guide, /onViewportChannelIds=\{onViewportChannelIds\}/);
  assert.match(guide, /cacheProfile=\{powerProfile\}/);
  assert.match(sliding, /export function buildChannelIndexMap/);
  assert.match(sliding, /indexById\?: ReadonlyMap/);
});

test("all-channel data does not mount the entire playlist as native views", async () => {
  const [timeline, box] = await Promise.all([
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/BoxGrid.tsx"), "utf8"),
  ]);
  assert.match(timeline, /renderViewport \* renderScreens/);
  assert.match(box, /renderViewport \* renderScreens/);
  assert.doesNotMatch(timeline, /renderDrawDistance = Math\.max\(1, channels\.length \* ROW_H\)/);
  assert.doesNotMatch(box, /renderDrawDistance = Math\.max\(148, Math\.ceil\(channels\.length \/ numColumns\) \* 148\)/);
});
