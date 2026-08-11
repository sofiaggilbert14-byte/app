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
  // Settings remount must reset silent-audio / start-timeout fallback gates.
  assert.match(source, /appliedCompatKeyRef/);
  assert.match(source, /\$\{role\}:\$\{uri\}:\$\{initialEngine\}:\$\{appliedCompatKeyRef\.current\}/);
  // Preview freezes compat keys while Guide is unfocused (Tabs keep-alive).
  assert.match(source, /role !== "preview" \|\| isFocused/);
  assert.match(source, /maxBufferBytes: 48 \* 1024 \* 1024/);
  assert.match(source, /if \(media3Audio === "ffmpeg"\) return selectedAudio != null/);
  assert.match(source, /export function isFullscreenCircuitOpen/);
  assert.match(source, /hardStop\(\);\s*setBlocked\(true\)/);
});
