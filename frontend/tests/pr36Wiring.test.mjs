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
  assert.match(guide, /requestNativeFocusWithRetry\(lastGuideFocusNodeRef\.current/);
  assert.match(guide, /onGuideFocusNode=/);
});

test("PR #36 rapid-surf and player focus protections remain present", async () => {
  const [grid, player] = await Promise.all([
    source("src/components/TimelineGrid.tsx"), source("app/player.tsx"),
  ]);
  assert.match(grid, /disableProgramCull/);
  assert.match(grid, /armGuideBottomFocusLock/);
  assert.match(player, /preferControlRef/);
  assert.match(player, /which === "next" \? nextButtonRef\.current : prevButtonRef\.current/);
  assert.match(player, /requestNativeFocus\(node\)/);
  assert.match(player, /forceStopAllStreams/);
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

test("program cull disable is edge-triggered during vertical surf", async () => {
  const grid = await source("src/components/TimelineGrid.tsx");
  assert.match(grid, /cullDisabledRef/);
  assert.match(grid, /if \(!cullDisabledRef\.current\)/);
});

test("guide preview uses lighter stream buffers", async () => {
  const [player, guide] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/(tabs)/guide.tsx"),
  ]);
  assert.match(player, /mode === "preview"/);
  assert.match(guide, /mode="preview"/);
});
