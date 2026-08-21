import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("Media3 publishes stable playback only after the native clock really advances", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  const ready = player.match(/if \(status === "readyToPlay"\) \{[\s\S]*?\n\s*\} else if \(status === "loading"\)/)?.[0] || "";
  assert.match(ready, /setMediaReady\(true\)/);
  assert.doesNotMatch(ready, /hasPlayedRef\.current = true/);
  assert.doesNotMatch(ready, /recordStablePlayback/);
  assert.doesNotMatch(ready, /emit\("playing"\)/);

  const progress = player.match(/const progressSub = player\.addListener\("timeUpdate"[\s\S]*?\n\s*\}\);/)?.[0] || "";
  assert.match(progress, /if \(!mediaReady\) return/);
  assert.match(progress, /const firstProgress = !hasPlayedRef\.current/);
  assert.match(progress, /hasPlayedRef\.current = true/);
  assert.match(progress, /recordStablePlayback\(sessionRole, engine, uri\)/);
  assert.match(progress, /emit\("playing"\)/);
});

test("Media3 keeps bounded startup and explicit post-playback buffering recovery", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /FULLSCREEN_START_TIMEOUT_MS = 12_000/);
  assert.match(player, /BUFFERING_RESYNC_MS = 5000/);
  assert.match(player, /BUFFERING_FAIL_MS = 12_000/);
  assert.match(player, /MAX_SILENT_BUFFERING_RESYNCS = 1/);
  assert.match(player, /RESYNC_REARM_STABLE_MS = 30_000/);
  assert.match(player, /if \(bufferingSince == null\) return/);
  assert.match(player, /const bufferingFor = now - bufferingSince/);
  assert.doesNotMatch(player, /MEDIA3_FROZEN_CLOCK_MS|const frozenReadyClock =/);
});
