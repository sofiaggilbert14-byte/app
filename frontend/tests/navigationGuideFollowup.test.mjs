import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGuideAlphabetTargets,
  GUIDE_ALPHABET,
  guideChannelLetter,
} from "../src/core/guideAlphabet.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Guide alphabet exposes all letters and builds bounded first-channel targets", () => {
  const targets = buildGuideAlphabetTargets([
    { id: "a1", name: "123 Álpha" },
    { id: "a2", name: "Another" },
    { id: "z1", name: "Zulu" },
  ]);
  assert.deepEqual(Object.keys(targets), [...GUIDE_ALPHABET]);
  assert.equal(targets.A, "a1");
  assert.equal(targets.Z, "z1");
  assert.equal(targets.Q, null);
  assert.equal(guideChannelLetter("  42 Éclair"), "E");
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

test("Guide A-Z jumps without filtering/remounting the group list", async () => {
  const [guide, focusLock] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "src/utils/tvGuideFocusLock.ts"), "utf8"),
  ]);
  assert.match(guide, /guide-alphabet-bar/);
  assert.match(guide, /GUIDE_ALPHABET\.map/);
  assert.match(guide, /buildGuideAlphabetTargets/);
  assert.match(guide, /onViewportChannelIds\(runway, priority, visibleRows\)/);
  assert.match(guide, /setFocusClaimNonce\(\(value\) => value \+ 1\)/);
  assert.doesNotMatch(guide, /Filter in group|guide-group-search|searchChannelsInList/);
  assert.match(focusLock, /registerGuideAlphabetEntry/);
  assert.match(focusLock, /focusGuideAlphabetSurface/);
  assert.match(focusLock, /nextFocusUp: topHandle/);
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
  assert.match(epgNative, /avoids retaining one extra NativeEpgProgram per channel/);
  assert.doesNotMatch(epgNative, /maybeIncrementalVacuum\(MIN_VACUUM_DELETED_ROWS, deleted\)\s+rebuildCurrentCache\(now\)/);
  assert.match(timeline, /verticalFocusAnchorRef/);
  assert.match(timeline, /current\.key === "pending"/);
  assert.match(timeline, /prepared\.left \+ prepared\.width \/ 2/);
  assert.match(timeline, /reportFocusedRow\(targetIndex\)/);
  assert.match(box, /reportFocusedRow\(targetIndex\)/);
});
