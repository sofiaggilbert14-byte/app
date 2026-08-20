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
  assert.match(guide, /advanceLiveViewport\(wallClockNow\)/);
  assert.match(guide, /scheduleLiveClock\(\)\s*\n\s*applyPendingRestoreChannel\(\)/);
  assert.match(guide, /override fun onDetachedFromWindow\(\) \{\s*stopLiveClock\(\)/);
  assert.match(guide, /fun dispose\(\) \{\s*if \(disposed\) return\s*stopLiveClock\(\)/);
});
