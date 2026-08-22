import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("Media3 publishes stable playback only after the native first frame", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  const ready = player.match(/else if \(status === "readyToPlay"\) \{[\s\S]*?\n\s*\} else if/)?.[0] || "";
  assert.match(ready, /publishTracks\(\)/);
  assert.doesNotMatch(ready, /setSessionPhase\([^\n]*"playing"/);
  assert.doesNotMatch(ready, /emit\("playing"\)/);

  const firstFrame = player.match(/onFirstFrameRender=\{\(\) => \{[\s\S]*?\n\s*\}\}/)?.[0] || "";
  assert.match(firstFrame, /isSessionCurrent\(role, generation\)/);
  assert.match(firstFrame, /stableRef\.current = true/);
  assert.match(firstFrame, /setSessionPhase\(role, generation, "playing"\)/);
  assert.match(firstFrame, /setNativePlaybackStarting\(false\)/);
  assert.match(firstFrame, /emit\("playing"\)/);
});

test("Media3 keeps bounded startup and one-shot post-playback recovery", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /FULLSCREEN_START_TIMEOUT_MS = 12_000/);
  assert.match(player, /PREVIEW_START_TIMEOUT_MS = 8_000/);
  assert.match(player, /REBUFFER_REPREPARE_MS = 5_000/);
  assert.match(player, /REBUFFER_FAIL_MS = 12_000/);
  assert.match(player, /MAX_SILENT_BUFFERING_RESYNCS = 1/);
  assert.match(player, /RESYNC_REARM_STABLE_MS = 30_000/);
  assert.match(player, /silentResyncCountRef\.current < MAX_SILENT_BUFFERING_RESYNCS/);
  assert.match(player, /silentResyncCountRef\.current \+= 1/);
  assert.match(player, /void load\(true\)/);
  assert.match(player, /elapsed >= REBUFFER_FAIL_MS/);
  assert.doesNotMatch(player, /MEDIA3_FROZEN_CLOCK_MS|const frozenReadyClock =/);
});
