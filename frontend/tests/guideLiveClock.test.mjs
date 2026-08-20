import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("native Guide advances its live runway even when the user is not pressing a key", async () => {
  const guide = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(guide, /LIVE_CLOCK_TICK_MS = 30_000L/);
  assert.match(guide, /private val liveClockRunnable = Runnable/);
  assert.match(guide, /postDelayed\(liveClockRunnable, LIVE_CLOCK_TICK_MS\)/);
  assert.doesNotMatch(guide, /postInvalidateDelayed\(30_000L\)/);
  assert.match(guide, /advanceLiveViewport\(wallClockNow\)/);
  assert.match(guide, /scheduleLiveClock\(\)\s*\n\s*applyPendingRestoreChannel\(\)/);
  assert.match(guide, /override fun onDetachedFromWindow\(\) \{\s*stopLiveClock\(\)/);
  assert.match(guide, /fun dispose\(\) \{\s*if \(disposed\) return\s*stopLiveClock\(\)/);
});

test("manual time browsing rejoins wall-clock follow when selection returns to the live programme", async () => {
  const guide = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(guide, /private fun updateLiveFollowFromSelection\(\)/);
  assert.match(guide, /now >= it\.startMs && now < it\.endMs/);
  assert.match(guide, /abs\(selectedTimeMs - now\) <= 60_000L/);
  assert.match(guide, /selectedTimeMs = nextTime\s*\n\s*ensureSelectedTimeVisible\(\)\s*\n\s*updateLiveFollowFromSelection\(\)/);
  assert.match(guide, /channelRailSelected = false\s*\n\s*updateLiveFollowFromSelection\(\)/);
});
