import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("ProgramModal owns reminder toggling and Guide preview opens My Reminders", async () => {
  const [store, guide, modal, preview] = await Promise.all([
    source("src/store.tsx"),
    source("app/(tabs)/guide.tsx"),
    source("src/components/ProgramModal.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
  ]);
  assert.match(store, /toggleReminder: \(program: Program, channel: Channel\)/);
  assert.match(store, /reminderDesiredStateRef/);
  assert.match(store, /reminderMutationRef/);
  assert.match(guide, /onOpenReminders/);
  assert.match(guide, /router\.replace\("\/reminders"/);
  assert.match(modal, /const \{ activeProgram, closeProgram, toggleReminder, reminders \} = useStore\(\)/);
  assert.doesNotMatch(modal, /addReminder|removeReminder/);
  assert.match(preview, /onPress=\{onOpenReminders\}/);
  assert.match(preview, />Reminders</);
  assert.doesNotMatch(preview, /clock24h|onInfo|onRemind/);
});

test("guide puts its enlarged preview, 3-by-2 actions, and details above the channel tabs", async () => {
  const [guide, shell] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/PurpleTvShell.tsx"),
  ]);
  const railPosition = guide.indexOf("<GuidePreviewRail");
  const gridPosition = guide.indexOf("<TimelineGrid");
  assert.ok(railPosition >= 0 && gridPosition > railPosition);
  assert.match(guide, /const previewHeaderWidth = useMemo/);
  assert.match(guide, /Math\.min\(324, Math\.max\(234, screenWidth \* 0\.216\)\)/);
  assert.ok(guide.indexOf("<GuideSelectionPreview") < guide.indexOf("styles.header"));
  assert.match(guide, /flex: 1/);
  assert.doesNotMatch(guide, /NowPlayingBar|guide-now-playing/);
  assert.doesNotMatch(guide, /footerAction|purple-guide-reset/);
  assert.match(shell, /recentChannels|recentStrip|focusable=\{drawerOpen\}/);
});

test("focus metadata is immediate while decoder tune stays delayed and restores by channel id", async () => {
  const [guide, timeline, box, focusLock] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/TimelineGrid.tsx"),
    source("src/components/BoxGrid.tsx"),
    source("src/utils/tvGuideFocusLock.ts"),
  ]);
  assert.match(guide, /setGuideFocusedProgram\(channel\.id, program\)/);
  assert.match(guide, /useGuideSelection\(\)/);
  assert.match(guide, /schedulePreview\(/);
  assert.match(guide, /previewId === requestedId && previewStatus !== "error"/);
  assert.match(guide, /focusGuideProgramCell\(origin\.channelId, origin\.programStart\)/);
  assert.match(timeline, /noteGuideChannelFocus\(item\.id/);
  assert.match(box, /noteGuideChannelFocus\(item\.id/);
  assert.match(focusLock, /registerGuideChannelNode/);
  assert.match(focusLock, /focusedGuideChannelId/);
  assert.match(focusLock, /cancelGuideFocusRestore/);
  assert.match(focusLock, /cancelGuideRestoreTimers/);
  assert.match(focusLock, /guideChannelNodes\.delete\(channelId\)/);
  assert.doesNotMatch(focusLock, /\|\|\s*guideEntryNode/);
  assert.match(timeline, /preservePendingFocus/);
  assert.match(timeline, /pendingProgramCellHidden/);
  assert.match(timeline, /lastViewportBucketRef/);
  assert.match(timeline, /viewport \* 0\.3/);
  assert.match(box, /lastViewportBucketRef/);
  assert.doesNotMatch(timeline, /reclaimToken|mountedBandRef|disableProgramCull/);
  assert.doesNotMatch(box, /mountedRowBandRef/);
  assert.match(timeline, /key: `\$\{item\.id\}:slot:\$\{logicalSlot\}`/);
  assert.doesNotMatch(timeline, /key: `\$\{item\.id\}:\$\{program\.start\}/);
});

test("Home no longer mounts a NowPlayingBar; guide owns live preview", async () => {
  const home = await source("app/(tabs)/index.tsx");
  assert.doesNotMatch(home, /NowPlayingBar|home-now-playing/);
});

test("EPG screen delivery uses a symmetric eight-page conveyor runway with retained bounded caches", async () => {
  const [native, programStore, store, runway, sliding, guide] = await Promise.all([
    source("src/source.native.ts"),
    source("src/core/guideProgramsStore.ts"),
    source("src/store.tsx"),
    source("src/core/guideRunwayPolicy.ts"),
    source("src/core/guideSlidingCache.ts"),
    source("app/(tabs)/guide.tsx"),
  ]);
  assert.match(runway, /GUIDE_PREFETCH_PAGES_AHEAD = 8/);
  assert.match(runway, /GUIDE_PREFETCH_PAGES_BEHIND = 8/);
  assert.match(sliding, /expandRunwayKeepSet/);
  assert.match(sliding, /hysteresis/);
  assert.match(programStore, /export function retainGuidePrograms/);
  assert.match(native, /retainProgrammeWindowCache/);
  assert.match(native, /mode === "strict"/);
  assert.match(store, /retainGuideSlidingCache/);
  assert.match(guide, /expandRunwayKeepSet/);
  assert.match(guide, /retainGuideSlidingCache/);
  assert.match(native, /programmeWindowInFlight/);
  assert.match(native, /programmeWindowAccessOrder/);
  assert.match(native, /programmeWindowCacheKey === requestCacheKey/);
  assert.match(native, /for \(const id of unique\)/);
  assert.match(native, /queriedPlaylistIds\.has\(channel\.id\)/);
  assert.match(store, /pendingPatchIdsRef\.current\.clear\(\)/);
  assert.doesNotMatch(store, /runwayGenerationRef|pendingPatchGenerationRef/);
  assert.match(native, /programmeWindowCacheKey !== cacheKey\) return \{\}/);
  assert.match(store, /guideEpoch !== guideEpochRef\.current/);
  assert.match(store, /releaseGuideSlidingCache/);
  assert.match(guide, /releaseGuideSlidingCache\(\)/);
  assert.match(store, /resolveStoredGuideLayout/);
  assert.match(store, /keepUsefulGuidePatch\(delta \|\| \{\}, keep\)/);
  assert.match(store, /buildGuidePatchTiers\(ids, priorityOrder, 12, 24\)/);
  assert.match(store, /lastKeepIdsRef/);
  assert.match(store, /retainProgrammeWindowCache\(keep\)/);
  assert.match(native, /hours = 6/);
  assert.match(programStore, /maxProgrammeRows = 1800/);
  assert.match(programStore, /setGuideProgramRowLimit/);
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

test("release hardening rejects stale epochs, trims on Guide blur, and derives APK identity", async () => {
  const [native, store, guide, workflow, workerPackage] = await Promise.all([
    source("src/source.native.ts"),
    source("src/store.tsx"),
    source("app/(tabs)/guide.tsx"),
    source("../.github/workflows/purple-tv-ui.yml"),
    source("../cloudflare-backend/worker/package.json"),
  ]);
  assert.match(native, /programmeWindowCacheKey !== cacheKey\) return \{\}/);
  assert.match(store, /guideEpoch !== guideEpochRef\.current/);
  assert.match(store, /lastPatchRunwayIdsRef\.current = keep;[\s\S]*lastKeepIdsRef\.current = keep;/);
  assert.match(store, /trimGuideProgramRows\(keep, true\)/);
  assert.match(guide, /releaseGuideSlidingCache\(\)/);
  assert.match(workflow, /require\("\.\/app\.json"\)\.expo\.version/);
  assert.match(workflow, /TESTER_RELEASE_NOTES_\$\{APP_VERSION\}\.md/);
  assert.match(workerPackage, /--config \.\.\/\.\.\/wrangler\.toml/);
});
