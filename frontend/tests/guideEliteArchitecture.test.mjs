import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVisibleGuideCellSlice } from "../src/core/guideCellCulling.ts";
import { buildGuidePatchTiers, keepUsefulGuidePatch } from "../src/core/guidePatchPolicy.ts";
import { getGuideRailMetrics } from "../src/core/guideLayoutPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("visible-cell culling keeps a bounded viewport slice and pins focused cell", () => {
  const cells = Array.from({ length: 100 }, (_, index) => ({
    key: `p${index}`,
    left: index * 100,
    width: 90,
  }));
  const slice = buildVisibleGuideCellSlice(cells, 2_000, 500, 100, "p90");
  assert.ok(slice.length < 15);
  assert.ok(slice.some(({ item }) => item.key === "p20"));
  assert.ok(slice.some(({ item }) => item.key === "p90"));
  assert.deepEqual(slice.map(({ sourceIndex }) => sourceIndex), [...slice.map(({ sourceIndex }) => sourceIndex)].sort((a, b) => a - b));
});

test("Guide patch policy prioritizes the visible edge and keeps useful in-flight rows", () => {
  const ids = Array.from({ length: 50 }, (_, index) => `c${index}`);
  const tiers = buildGuidePatchTiers(ids, ["c20", "c21", "c22"], 12, 24);
  assert.deepEqual(tiers[0].slice(0, 3), ["c20", "c21", "c22"]);
  assert.ok(tiers.every((tier) => tier.length <= 24));
  assert.deepEqual(keepUsefulGuidePatch({ c1: [], c20: [], c49: [] }, ["c20", "c49"]), {
    c20: [],
    c49: [],
  });
});

test("extra compact density fits thinner rows and one-line names", () => {
  const metrics = getGuideRailMetrics(1920, "extra_compact", true, true);
  assert.ok(metrics.rowHeight >= 46 && metrics.rowHeight <= 50);
  assert.ok(metrics.logoSize >= 24 && metrics.logoSize <= 28);
  assert.equal(metrics.channelNameMaxLines, 1);
});

test("native focus graph routes Guide left boundary to the groups drawer", async () => {
  const [activity, preview, guide, timeline, shell, focusLock] = await Promise.all([
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/MainActivity.kt"), "utf8"),
    readFile(join(root, "src/components/GuidePreviewRail.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/PurpleTvShell.tsx"), "utf8"),
    readFile(join(root, "src/utils/tvGuideFocusLock.ts"), "utf8"),
  ]);
  assert.doesNotMatch(activity, /TvDpadTap|activeDirectionalRepeated/);
  assert.match(preview, /registerGuidePreviewNode\(key, node, preferred\)/);
  assert.match(preview, />Favorite</);
  assert.match(preview, />Drawer</);
  assert.match(preview, /guide-preview-drawer/);
  assert.match(guide, /trapFocusLeft=\{false\}/);
  assert.match(guide, /lockLeftEdge=\{false\}/);
  assert.match(guide, /focusClaimNonce/);
  assert.match(guide, /openDrawer\(\{ focusTop: true \}\)/);
  assert.match(guide, /const onGuideLeftBoundary/);
  assert.match(guide, /if \(!drawerOpen && !activeProgram\) openDrawer\(\)/);
  assert.doesNotMatch(guide, /guide-more-groups-overlay/);
  assert.match(guide, /type PurpleGuideGroup/);
  assert.match(guide, /guide-pin-overlay/);
  assert.match(guide, /trapFocusUp trapFocusDown trapFocusLeft trapFocusRight/);
  assert.match(guide, /active=\{isFocused && !activeProgram && !drawerOpen\}/);
  assert.match(guide, /clearStreamFailure\(channel\.id\)/);
  // Drawer-close reclaim is nonce-only — no parallel focusGuideSurface race.
  assert.match(guide, /setFocusClaimNonce\(\(value\) => value \+ 1\)/);
  assert.doesNotMatch(
    guide,
    /setFocusClaimNonce\(\(value\) => value \+ 1\);\s*focusGuideSurface\(guideSessionChannelId\)/,
  );
  assert.match(focusLock, /nextFocusLeft: locked \? handle : previewHandle \|\| -1/);
  assert.match(timeline, /buildVisibleGuideCellSlice/);
  assert.match(timeline, /tvFocusable=\{near \|\| keepFocused\}/);
  assert.doesNotMatch(timeline, /pageJumpDetectorRef|subscribeVerticalDpadTaps/);
  assert.match(timeline, /styles\.rowPanTrack/);
  assert.match(timeline, /width: logoWidth \+ timelineWidth/);
  assert.match(timeline, /showChannelLogos && channelRailVisible/);
  assert.match(timeline, /const timelineOffset = Math\.max\(0, next - LOGO_W\)/);
  assert.match(shell, /sidebarOverlay/);
  assert.match(shell, /pointerEvents=\{drawerOpen \? "auto" : "none"\}/);
  // Shell never reaches behind the drawer to claim Guide focus.
  assert.doesNotMatch(shell, /focusGuideSurfaceWhenMounted/);
  assert.doesNotMatch(shell, /purple-icon-rail|ICON_RAIL/);
});

test("runway applies focused, immediate, visible, then retained tiers", async () => {
  const [store, timeline, box, guide] = await Promise.all([
    readFile(join(root, "src/store.tsx"), "utf8"),
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/BoxGrid.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
  ]);
  assert.match(store, /buildGuidePatchTiers\(ids, priorityOrder, 12, 24\)/);
  assert.match(store, /keepUsefulGuidePatch\(delta \|\| \{\}, keep\)/);
  assert.match(timeline, /visiblePageIds/);
  assert.match(box, /visiblePageIds/);
  assert.match(box, /cacheProfile === "weak"[\s\S]*?320/);
  assert.match(box, /drawDistance=\{renderDrawDistance\}/);
  assert.match(guide, /buildGuideRunwayIds\(filtered, 0, visibleRows, 1, powerProfile\)/);
});

test("memory cleanup preserves active logo accounting and cancels recycled focus work", async () => {
  const [logo, focusLock] = await Promise.all([
    readFile(join(root, "src/components/ChannelLogo.tsx"), "utf8"),
    readFile(join(root, "src/utils/tvGuideFocusLock.ts"), "utf8"),
  ]);
  const clearMemoryBody = logo.slice(
    logo.indexOf("export function clearChannelLogoMemory"),
    logo.indexOf("function remember"),
  );
  assert.doesNotMatch(clearMemoryBody, /activeLoads\s*=\s*0/);
  assert.match(focusLock, /leftFocusLockTimers = new WeakMap/);
  assert.match(focusLock, /cancelDelayedLeftFocusLock\(removed\?\.node\)/);
});

test("Guide focus stays continuous in every direction and restores modal origin", async () => {
  const [guide, timeline, box, preview, focusLock] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/BoxGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/GuidePreviewRail.tsx"), "utf8"),
    readFile(join(root, "src/utils/tvGuideFocusLock.ts"), "utf8"),
  ]);
  assert.doesNotMatch(timeline, /subscribeVerticalDpadTaps|pageJumpDetectorRef/);
  assert.doesNotMatch(box, /subscribeVerticalDpadTaps|pageJumpDetectorRef/);
  assert.match(timeline, /useNativeDriver: true/);
  assert.match(timeline, /commitViewport\(\)/);
  assert.match(timeline, /pendingViewportRef/);
  assert.match(focusLock, /registerGuideProgramNode/);
  assert.match(focusLock, /focusGuideProgramCell/);
  assert.match(guide, /modalOriginRef/);
  assert.match(guide, /focusGuideProgramCell\(origin\.channelId, origin\.programStart\)/);
  assert.match(preview, /ref=\{playFocus\.setRef\}/);
  assert.match(preview, /onPress=\{onOpenReminders\}/);
  assert.match(preview, /usePreviewFocusNode\("favorite"\)/);
  assert.match(focusLock, /wireAuxiliaryPanelsToGuide/);
  assert.match(focusLock, /registerGuideTopEntry/);
  assert.match(timeline, /wireFocusCandidate/);
  assert.match(timeline, /keepFocusedRowVisible/);
  assert.match(timeline, /preparedPrograms\.length > 0 && !focused/);
});

test("Guide page skip uses only dedicated Channel/Page remote keys", async () => {
  const [activity, remote, timeline, box, guide] = await Promise.all([
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/MainActivity.kt"), "utf8"),
    readFile(join(root, "src/utils/tvRemote.ts"), "utf8"),
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/BoxGrid.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
  ]);
  assert.match(activity, /KEYCODE_CHANNEL_UP/);
  assert.match(activity, /KEYCODE_PAGE_DOWN/);
  assert.match(activity, /emitRemoteEvent\("TvGuidePageKey", pageKey\)/);
  assert.match(activity, /event\.repeatCount == 0/);
  assert.match(remote, /addGuidePageKeyListener/);
  assert.match(timeline, /addGuidePageKeyListener/);
  assert.match(box, /addGuidePageKeyListener/);
  assert.doesNotMatch(guide, /GuidePageCharms|guide-page-charm|pageCharm/);
  assert.doesNotMatch(timeline, /pageRequest/);
  assert.doesNotMatch(box, /pageRequest/);
  assert.doesNotMatch(timeline, /subscribeVerticalDpadTaps|pageJumpDetectorRef/);
});

test("held Guide navigation uses bounded native cadence without a cross-thread paint gate", async () => {
  const [activity, module, remote, timeline, box, guide] = await Promise.all([
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/MainActivity.kt"), "utf8"),
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt"), "utf8"),
    readFile(join(root, "src/utils/tvRemote.ts"), "utf8"),
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/BoxGrid.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
  ]);
  assert.match(activity, /guideActive/);
  assert.match(activity, /repeatFloor = if \(guideActive\) TvRemoteModule\.guideRepeatIntervalMs/);
  assert.doesNotMatch(activity, /guideFocusSyncActive|guideFocusMoveReady|GUIDE_FOCUS_ACK_TIMEOUT_MS/);
  assert.match(activity, /event\.keyCode == lastAcceptedDirectionalKeyCode/);
  assert.doesNotMatch(module, /guideFocusSyncActive|guideFocusMoveReady|acknowledgeGuideFocusMove/);
  assert.match(module, /coerceIn\(60L, 120L\)/);
  assert.doesNotMatch(remote, /guideFocusSyncEnabled|acknowledgeGuideFocusAfterPaint/);
  assert.doesNotMatch(timeline, /acknowledgeGuideFocusAfterPaint|setGuideFocusSyncActive/);
  assert.match(timeline, /verticalTargetOrSelf/);
  assert.match(timeline, /scheduleFocusedCandidateRewire/);
  assert.doesNotMatch(box, /acknowledgeGuideFocusAfterPaint|setGuideFocusSyncActive/);
  assert.match(guide, /setGuideRepeatInterval\(powerTuning\.guideRepeatIntervalMs\)/);
});

test("hidden tabs stop Guide input, clocks, and decoded-logo work", async () => {
  const [guide, channels, reminders, collection, search] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/channels.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/reminders.tsx"), "utf8"),
    readFile(join(root, "src/components/PurpleChannelCollection.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/search.tsx"), "utf8"),
  ]);
  assert.match(guide, /active=\{isFocused && !activeProgram && !drawerOpen\}/);
  assert.match(guide, /if \(!isFocused\) return;[\s\S]*setInterval\(\(\) => setNow/);
  assert.match(guide, /showChannelLogos=\{isFocused && channelLogos/);
  assert.match(channels, /if \(!isFocused\) return;[\s\S]*setInterval\(\(\) => setNow/);
  assert.match(channels, /logos=\{isFocused && channelLogos\}/);
  assert.match(reminders, /logos=\{isFocused && channelLogos\}/);
  assert.match(collection, /logos=\{isFocused && channelLogos\}/);
  assert.match(search, /disabled=\{!isFocused \|\| !channelLogos\}/);
});

test("EPG staging and metadata promotion preserve last-good caches", async () => {
  const [database, nativeSource, webSource] = await Promise.all([
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt"), "utf8"),
    readFile(join(root, "src/source.native.ts"), "utf8"),
    readFile(join(root, "src/source.ts"), "utf8"),
  ]);
  assert.match(database, /STORAGE_RECHECK_BATCHES/);
  assert.match(database, /catch \(failure: Throwable\)/);
  assert.match(database, /db\.delete\(STAGING_TABLE/);
  assert.match(nativeSource, /CHANNEL_CACHE_BAK/);
  assert.match(webSource, /CACHE_BAK_FILE/);
  assert.match(webSource, /readValidCacheMeta\(CACHE_TMP_FILE\)/);
});
