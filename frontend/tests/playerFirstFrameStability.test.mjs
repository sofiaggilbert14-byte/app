import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("Media3 publishes stable playback only after native onRenderedFirstFrame", async () => {
  const [native, adapter] = await Promise.all([source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("src/components/StreamPlayer.tsx")]);
  const firstFrame = native.match(/override fun onRenderedFirstFrame\(\)[\s\S]*?\n\s*}/)?.[0] || "";
  assert.match(firstFrame, /firstFrameRendered = true/);
  assert.match(firstFrame, /listener\?\.onState\("playing", null\)/);
  assert.match(adapter, /event\.state === "playing"/);
  assert.match(adapter, /setSessionPhase\(role, generation, "playing"\)/);
  assert.doesNotMatch(adapter, /onFirstFrameRender|readyToPlay|player\.currentTime/);
});

test("Media3 keeps one bounded native startup and post-playback watchdog", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /FULLSCREEN_START_TIMEOUT_MS = 12_000L/);
  assert.match(native, /PREVIEW_START_TIMEOUT_MS = 8_000L/);
  assert.match(native, /HUNG_BUFFER_REPREPARE_MS = 5_000L/);
  assert.match(native, /if \(recoveryUsed\)/);
  assert.match(native, /recoveryUsed = true/);
  assert.match(native, /instance\.prepare\(\)/);
  assert.match(native, /STABLE_REARM_MS = 30_000L/);
});
