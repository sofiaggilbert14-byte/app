import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("guide preview and ProgramModal share one reminder toggle source of truth", async () => {
  const [store, guide, modal, preview] = await Promise.all([
    source("src/store.tsx"),
    source("app/(tabs)/guide.tsx"),
    source("src/components/ProgramModal.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
  ]);
  assert.match(store, /toggleReminder: \(program: Program, channel: Channel\)/);
  assert.match(store, /reminderDesiredStateRef/);
  assert.match(store, /reminderMutationRef/);
  assert.match(guide, /toggleReminder\(displayedProgram, previewChannel\)/);
  assert.match(guide, /reminderKeys\.has\(reminderKey/);
  assert.match(modal, /const \{ activeProgram, closeProgram, toggleReminder, reminders \} = useStore\(\)/);
  assert.doesNotMatch(modal, /addReminder|removeReminder/);
  assert.match(preview, /isReminded \? "Cancel" : "Remind"/);
  assert.doesNotMatch(preview, /clock24h|onInfo|onRemind/);
});

test("guide is a fixed left details panel plus right grid without drawer extras", async () => {
  const [guide, shell] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/PurpleTvShell.tsx"),
  ]);
  const railPosition = guide.indexOf("<GuidePreviewRail");
  const gridPosition = guide.indexOf("<TimelineGrid");
  assert.ok(railPosition >= 0 && gridPosition > railPosition);
  assert.match(guide, /const detailsRailWidth = useMemo/);
  assert.match(guide, /flex: 1/);
  assert.doesNotMatch(guide, /NowPlayingBar|guide-now-playing/);
  assert.doesNotMatch(shell, /contextActions|recentChannels|onRecentPress|recentStrip/);
});

test("focus metadata is immediate while decoder tune stays delayed and restores by channel id", async () => {
  const [guide, timeline, box, focusLock] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/TimelineGrid.tsx"),
    source("src/components/BoxGrid.tsx"),
    source("src/utils/tvGuideFocusLock.ts"),
  ]);
  assert.match(guide, /setFocusedProgramSelection\(\{ channelId: channel\.id, program \}\)/);
  assert.match(guide, /schedulePreview\(/);
  assert.match(guide, /previewId === requestedId && previewStatus !== "error"/);
  assert.match(guide, /focusGuideSurface\(guideSessionChannelId\)/);
  assert.match(timeline, /noteGuideChannelFocus\(item\.id/);
  assert.match(box, /noteGuideChannelFocus\(item\.id/);
  assert.match(focusLock, /registerGuideChannelNode/);
  assert.match(focusLock, /focusedGuideChannelId/);
  assert.match(focusLock, /cancelGuideFocusRestore/);
  assert.match(focusLock, /cancelGuideRestoreTimers/);
  assert.match(focusLock, /guideChannelNodes\.delete\(channelId\)/);
  assert.doesNotMatch(focusLock, /\|\|\s*guideEntryNode/);
  assert.match(timeline, /preservePendingFocus/);
  assert.match(timeline, /lastViewportBucketRef/);
  assert.match(timeline, /viewport \* 0\.3/);
  assert.match(box, /lastViewportBucketRef/);
  assert.doesNotMatch(timeline, /reclaimToken|mountedBandRef|disableProgramCull/);
  assert.doesNotMatch(box, /mountedRowBandRef/);
});

test("EPG screen delivery uses a five-page runway with retained bounded caches", async () => {
  const [native, programStore, store, runway] = await Promise.all([
    source("src/source.native.ts"),
    source("src/core/guideProgramsStore.ts"),
    source("src/store.tsx"),
    source("src/core/guideRunwayPolicy.ts"),
  ]);
  assert.match(runway, /GUIDE_PREFETCH_PAGES_AHEAD = 5/);
  assert.match(runway, /GUIDE_PREFETCH_PAGES_BEHIND = 2/);
  assert.match(native, /programmeWindowInFlight/);
  assert.match(native, /programmeWindowAccessOrder/);
  assert.match(native, /programmeWindowCacheKey === requestCacheKey/);
  assert.match(native, /for \(const id of unique\)/);
  assert.match(native, /queriedPlaylistIds\.has\(channel\.id\)/);
  assert.match(store, /pendingPatchIdsRef\.current\.clear\(\)/);
  assert.match(native, /hours = 6/);
  assert.match(programStore, /MAX_PROGRAMME_ROWS = 2400/);
  assert.match(store, /EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 6/);
});

test("EPG finalization reports truthful late phases and skips identical match writes", async () => {
  const [native, bar, database] = await Promise.all([
    source("src/source.native.ts"),
    source("src/components/EpgProgressBar.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt"),
  ]);
  assert.match(native, /phase: "indexing", ratio: 0\.91/);
  assert.match(native, /phase: "matching", ratio: 0\.94/);
  assert.match(native, /phase: "caching", ratio: 0\.975/);
  assert.match(native, /phase: "finalizing", ratio: 0\.99/);
  assert.match(native, /writeFingerprint === lastNativeMatchWriteFingerprint/);
  assert.match(database, /MATCH_CONTENT_FINGERPRINT_KEY/);
  assert.match(database, /fingerprintPlaylistEpgMatches/);
  assert.match(database, /== fingerprint\) return false/);
  assert.match(database, /db\.delete\(META_TABLE, null, null\)/);
  assert.match(native, /policyUnchanged && epgUnchanged/);
  assert.match(bar, /phase === "matching"/);
  assert.match(bar, /phase === "finalizing"/);
});
