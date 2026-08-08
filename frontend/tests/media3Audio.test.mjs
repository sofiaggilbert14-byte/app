import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("Media3 path exposes selectable audio tracks and deterministic audio focus", async () => {
  const [player, screen] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/player.tsx"),
  ]);
  assert.match(player, /reportAndSelectMedia3Tracks/);
  assert.match(player, /availableAudioTracksChange/);
  assert.match(player, /player\.audioTrack = selectedAudio/);
  assert.match(player, /player\.audioMixingMode = mode === "preview" \? "mixWithOthers" : "doNotMix"/);
  assert.match(player, /mediaReady/);
  assert.match(screen, /unsupported on this decoder/);
});

test("Expo Video patch disables chunkless HLS prep and exposes renderer track capability", async () => {
  const patch = await source("patches/expo-video+3.0.16.patch");
  assert.match(patch, /HlsMediaSource/);
  assert.match(patch, /setAllowChunklessPreparation\(false\)/);
  assert.match(patch, /EXTENSION_RENDERER_MODE_PREFER/);
  assert.match(patch, /mimeType/);
  assert.match(patch, /isSupported/);
});
