import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function text(path) {
  return readFile(join(root, path), "utf8");
}

test("long OK is owned by contextual quick actions, not the legacy Favorite shortcut", async () => {
  const activity = await text("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
  const remote = await text("src/utils/tvRemote.ts");
  const prefs = await text("src/core/remoteShortcutPreferences.ts");
  assert.match(activity, /TvRemoteQuickActions/);
  assert.match(activity, /context == "guide" \|\| context == "player"/);
  assert.match(activity, /return true\s*\n\s*}\s*\n\s*\/\/ Phase 9 remote ownership/);
  assert.match(remote, /addTvQuickActionsListener/);
  assert.match(prefs, /longSelect: "controls"/);
  assert.doesNotMatch(prefs, /longSelect: "favorite",/);
});

test("quick actions expose Favorite and per-channel custom EPG assignment", async () => {
  const overlay = await text("src/components/TvQuickActionsOverlay.tsx");
  assert.match(overlay, /Assign custom EPG/);
  assert.match(overlay, /Use automatic EPG/);
  assert.match(overlay, /Add Favorite/);
  assert.match(overlay, /setNativeGuideChannelBinding/);
  assert.match(overlay, /setNativeSourceGuideBinding/);
  assert.match(overlay, /invalidateGuideOwnershipCaches/);
  assert.match(overlay, /setRemoteContext\("modal"\)/);
  assert.match(overlay, /trapFocusUp trapFocusDown trapFocusLeft trapFocusRight/);
});

test("custom EPG sources have one native owner and matching capacity", async () => {
  const registry = await text("src/core/multiEpgSources.ts");
  const controlDb = await text("android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt");
  const customNative = await text("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt");
  assert.match(registry, /const MAX_SOURCES = 7/);
  assert.match(controlDb, /playlistId = 'user' OR playlistId LIKE 'user:%'/);
  assert.match(controlDb, /setExclusiveUserChannelBinding/);
  assert.match(customNative, /setExclusiveUserChannelBinding\(USER_SOURCE_ID/);
});

test("custom EPG retention and refresh policy are wired to native source records", async () => {
  const customNative = await text("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt");
  const policy = await text("src/core/customEpgPolicy.ts");
  const prefs = await text("src/core/sourceRefreshPreferences.ts");
  assert.match(customNative, /setRetentionDays/);
  assert.match(customNative, /retentionDays\(\)\.toLong\(\) \* DAY_MS/);
  assert.doesNotMatch(customNative, /GUIDE_HISTORY_MS/);
  assert.match(policy, /refreshHours: epgHours/);
  assert.match(prefs, /syncNativeCustomEpgPolicy/);
});

test("automatic scheduler and custom parser yield to interactive TV ownership", async () => {
  const scheduler = await text("src/components/SourceRefreshScheduler.tsx");
  const customNative = await text("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt");
  assert.match(scheduler, /schedulerGeneration/);
  assert.match(scheduler, /screenIsSafe/);
  assert.match(scheduler, /cancelled = true/);
  assert.match(customNative, /owner == "guide" \|\| owner == "player" \|\| owner == "modal"/);
});

test("additional custom source storage checks use the source-specific database", async () => {
  const customNative = await text("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt");
  assert.match(customNative, /openPossiblyGzipped\(sourceUrl, targetDatabase\)/);
  assert.match(customNative, /targetDatabase\.assertRefreshStorageAvailable\(declaredLength\)/);
});
