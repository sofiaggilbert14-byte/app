import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clampGuideScrollOffset } from "../src/core/guideNavigationPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Guide scroll offsets cannot enter blank space beyond real content", () => {
  assert.equal(clampGuideScrollOffset(-50, 1_000, 400), 0);
  assert.equal(clampGuideScrollOffset(250, 1_000, 400), 250);
  assert.equal(clampGuideScrollOffset(900, 1_000, 400), 600);
  assert.equal(clampGuideScrollOffset(200, 300, 400), 0);
});

test("requested full-bleed pages expose the shared Drawer button", async () => {
  const component = await readFile(join(root, "src/components/PurpleDrawerButton.tsx"), "utf8");
  assert.match(component, /openDrawer\(\{ focusTop: true \}\)/);
  assert.match(component, />Drawer</);

  const directRoutes = ["settings", "search", "catchup", "channels", "favorites"];
  for (const route of directRoutes) {
    const source = await readFile(join(root, `app/(tabs)/${route}.tsx`), "utf8");
    assert.match(source, /PurpleDrawerButton/);
    assert.match(source, new RegExp(`${route}-open-drawer`));
  }
  const collection = await readFile(join(root, "src/components/PurpleChannelCollection.tsx"), "utf8");
  assert.match(collection, /PurpleDrawerButton/);
  assert.match(collection, /active\.slice\(1\)/);
});

test("removed Guide alphabet leaves a direct group-to-grid focus edge", async () => {
  const [guide, focusLock] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "src/utils/tvGuideFocusLock.ts"), "utf8"),
  ]);
  assert.doesNotMatch(guide, /guide-alphabet-bar|GUIDE_ALPHABET|buildGuideAlphabetTargets/);
  assert.doesNotMatch(guide, /Filter in group|guide-group-search|searchChannelsInList/);
  assert.doesNotMatch(focusLock, /registerGuideAlphabetEntry|focusGuideAlphabetSurface|guideAlphabetEntryNode/);
  assert.match(focusLock, /guideTopEntryNode/);
  assert.match(focusLock, /nextFocusDown: targetHandle/);
});

test("preview default, ONN page keys, and cold-row focus anchor are hardened", async () => {
  const [store, guide, activity, epgNative, plugin, timeline, box] = await Promise.all([
    readFile(join(root, "src/store.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/MainActivity.kt"), "utf8"),
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"), "utf8"),
    readFile(join(root, "plugins/withTvRemote.js"), "utf8"),
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/BoxGrid.tsx"), "utf8"),
  ]);
  assert.match(store, /useState<SafePreviewMode>\("surf"\)/);
  assert.match(store, /SAFE_PREVIEW_MODE_KEY, "surf"/);
  assert.match(guide, /if \(surfReleaseTimer\.current\) clearTimeout\(surfReleaseTimer\.current\)/);
  assert.match(guide, /if \(previewRecoverTimer\.current\) clearTimeout\(previewRecoverTimer\.current\)/);
  assert.match(
    guide,
    /const schedulePreview[\s\S]*?if \(previewTimer\.current\)[\s\S]*?previewTimer\.current = null;[\s\S]*?if \(safePreviewMode === "off" \|\| !hasUrl\)/,
  );
  for (const source of [activity, plugin]) {
    assert.match(source, /KEYCODE_MEDIA_PREVIOUS/);
    assert.match(source, /KEYCODE_MEDIA_NEXT/);
    assert.match(source, /0x192, 0x1b8/);
    assert.match(source, /0x193, 0x1b9/);
  }
  assert.match(activity, /hasSafeGuideVerticalTarget/);
  assert.match(activity, /source\.focusSearch\(direction\)/);
  assert.match(activity, /horizontalJump <= max\(240f, screenWidth \* 0\.42f\)/);
  assert.match(activity, /event\.repeatCount/);
  assert.match(epgNative, /currentCache\.clear\(\)/);
  assert.match(epgNative, /currentCacheValidUntilMs = 0L/);
  assert.doesNotMatch(epgNative, /maybeIncrementalVacuum\(MIN_VACUUM_DELETED_ROWS, deleted\)\s+rebuildCurrentCache\(now\)/);
  assert.match(timeline, /verticalFocusAnchorRef/);
  assert.match(timeline, /current\.key === "pending"/);
  assert.match(timeline, /prepared\.left \+ prepared\.width \/ 2/);
  assert.match(timeline, /const movedVertically = gridOwnsFocusRef\.current && rowIndex !== focusedRowRef\.current/);
  assert.match(timeline, /if \(!movedVertically\) keepProgramVisible/);
  assert.match(timeline, /const pendingLeft = Math\.max\(0, Math\.min\(panBucket/);
  assert.match(timeline, /left: pendingLeft,[\s\S]*width: pendingWidth/);
  assert.doesNotMatch(timeline, /Math\.max\(24, timelineWidth - 6\)/);
  assert.match(timeline, /overScrollMode="never"/);
  assert.doesNotMatch(timeline, /paddingBottom: 120/);
  assert.match(timeline, /reportFocusedRow\(targetIndex\)/);
  assert.match(box, /overScrollMode="never"/);
  assert.doesNotMatch(box, /paddingBottom: 130/);
  assert.match(box, /reportFocusedRow\(targetIndex\)/);
});

test("Program modal takes real TV focus and Guide remote ownership pauses under overlays", async () => {
  const [modal, rootLayout] = await Promise.all([
    readFile(join(root, "src/components/ProgramModal.tsx"), "utf8"),
    readFile(join(root, "app/_layout.tsx"), "utf8"),
  ]);

  assert.match(modal, /requestNativeFocusWithRetry/);
  assert.match(modal, /watchButtonRef/);
  assert.match(modal, /ref=\{watchButtonRef\}/);
  assert.match(modal, /program-modal-backdrop[^>]*focusable=\{false\}/);
  assert.match(modal, /program-watch-btn/);
  assert.match(modal, /program-reminder-btn/);

  assert.match(rootLayout, /TvFocusOwnershipCoordinator/);
  assert.match(rootLayout, /!activeProgram && !drawerOpen/);
  assert.match(rootLayout, /setGuideNavigationActive\(!!guideOwnsRemote\)/);
  assert.match(rootLayout, /COMPACT_DENSITY_DEFAULT_MIGRATION_KEY/);
  assert.match(rootLayout, /storedDensity === "extra_compact"/);
  assert.match(rootLayout, /setGuideDensity\("compact"\)/);
});