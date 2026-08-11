import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVisibleGuideCellSlice } from "../src/core/guideCellCulling.ts";
import { createDpadDoubleTapDetector } from "../src/core/dpadDoubleTap.ts";
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

test("page jump requires two short same-direction taps inside the window", () => {
  const detector = createDpadDoubleTapDetector(300);
  assert.equal(detector.push("DOWN", 1_000), null);
  assert.equal(detector.push("DOWN", 1_280), "DOWN");
  assert.equal(detector.push("UP", 2_000), null);
  assert.equal(detector.push("UP", 2_301), null);
  assert.equal(detector.push("DOWN", 2_400), null);
  assert.equal(detector.push("UP", 2_500), null);
});

test("ultra-fast same-ms double taps still page-jump", () => {
  const detector = createDpadDoubleTapDetector(300);
  assert.equal(detector.push("DOWN", 5_000), null);
  assert.equal(detector.push("DOWN", 5_000), "DOWN");
});

test("extra compact density fits thinner rows and one-line names", () => {
  const metrics = getGuideRailMetrics(1920, "extra_compact", true, true);
  assert.ok(metrics.rowHeight >= 46 && metrics.rowHeight <= 50);
  assert.ok(metrics.logoSize >= 24 && metrics.logoSize <= 28);
  assert.equal(metrics.channelNameMaxLines, 1);
});

test("native tap event excludes repeats and preview buttons own left handoff", async () => {
  const [activity, preview, guide, timeline, shell, focusLock] = await Promise.all([
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/MainActivity.kt"), "utf8"),
    readFile(join(root, "src/components/GuidePreviewRail.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/PurpleTvShell.tsx"), "utf8"),
    readFile(join(root, "src/utils/tvGuideFocusLock.ts"), "utf8"),
  ]);
  assert.match(activity, /!activeDirectionalRepeated/);
  assert.match(activity, /TvDpadTap/);
  assert.match(preview, /registerGuidePreviewEntry\(node\)/);
  assert.match(preview, />Favorite</);
  assert.match(preview, />Drawer</);
  assert.match(preview, /guide-preview-drawer/);
  assert.match(guide, /trapFocusLeft=\{false\}/);
  assert.match(guide, /lockLeftEdge=\{false\}/);
  assert.match(guide, /focusClaimNonce/);
  assert.match(guide, /openDrawer\(\{ focusTop: true \}\)/);
  assert.match(guide, /guide-more-groups-overlay/);
  assert.match(guide, /guide-pin-overlay/);
  assert.match(guide, /trapFocusUp trapFocusDown trapFocusLeft trapFocusRight/);
  assert.match(guide, /pointerEvents="none"/);
  assert.doesNotMatch(guide, /pointerEvents=\{drawerOpen \? "auto" : "none"\}/);
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
  assert.match(timeline, /recentlyOwned/);
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
  assert.match(store, /\[focusedIds, immediateIds, visibleIds, remainingIds\]/);
  assert.match(timeline, /visiblePageIds/);
  assert.match(box, /visiblePageIds/);
  assert.match(box, /cacheProfile === "weak"[\s\S]*?900/);
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
