import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("PR #36 guide recovery wiring remains present", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /previewEpoch/);
  assert.match(guide, /focusGuideSurface\(guideSessionChannelId\)/);
  assert.doesNotMatch(guide, /lastGuideFocusNodeRef|onGuideFocusNode=/);
});

test("PR #36 rapid-surf and player focus protections remain present", async () => {
  const [grid, player] = await Promise.all([
    source("src/components/TimelineGrid.tsx"), source("app/player.tsx"),
  ]);
  assert.doesNotMatch(grid, /disableProgramCull/);
  assert.match(grid, /viewport \* 0\.3/);
  assert.match(grid, /preservePendingFocus/);
  assert.match(grid, /lastViewportBucketRef/);
  assert.match(grid, /armGuideBottomFocusLock/);
  assert.match(player, /preferControlRef/);
  assert.match(player, /which === "next" \? nextButtonRef\.current : prevButtonRef\.current/);
  assert.match(player, /requestNativeFocus\(node\)/);
  assert.match(player, /stopFullscreenSession/);
});

test("favorite storage remains ID-only and bounded", async () => {
  const store = await source("src/store.tsx");
  assert.match(store, /sanitizeFavoriteIds/);
  assert.match(store, /favoritesPersistTimer/);
  assert.match(store, /sanitizeRecentIds/);
  assert.match(store, /recentPersistTimer/);
  assert.doesNotMatch(store, /setFavorites\([^\n]*Channel/);
  assert.doesNotMatch(store, /storage\.setItem\(RECENT_KEY, next\)/);
});

test("program runway stays wide without focus-time React state churn", async () => {
  const grid = await source("src/components/TimelineGrid.tsx");
  assert.doesNotMatch(grid, /cullDisabledRef|setDisableProgramCull/);
  assert.match(grid, /drawDistance=\{Math\.max\(2200, ROW_H \* 36\)\}/);
});

test("guide preview uses lighter stream buffers", async () => {
  const [player, guide, previewRail] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/(tabs)/guide.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
  ]);
  assert.match(player, /mode === "preview"/);
  assert.match(guide, /GuidePreviewRail/);
  assert.match(previewRail, /mode="preview"/);
});
