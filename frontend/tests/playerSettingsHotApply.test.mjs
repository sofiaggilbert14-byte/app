import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("player remounts Media3/VLC engines when compatibility settings change", async () => {
  const source = await readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8");
  assert.match(source, /vlcEngineKey/);
  assert.match(source, /media3EngineKey/);
  assert.match(source, /playerCompat\.vlcAudioOutput/);
  assert.match(source, /playerCompat\.media3AudioMode/);
  assert.match(source, /--stereo-mode=1/);
  assert.doesNotMatch(source, /--audio-filter=stereo_widen/);
  assert.match(source, /reportAndSelectMedia3Tracks\(\)/);
});
