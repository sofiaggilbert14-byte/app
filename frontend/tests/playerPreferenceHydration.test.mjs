import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("player preference hydration cannot overwrite a newer Settings edit", async () => {
  const files = await Promise.all([
    source("src/playerEnginePreference.ts"),
    source("src/core/playbackBufferProfile.ts"),
    source("src/core/playerCompatibilityPreferences.ts"),
    source("src/core/subtitlePreferences.ts"),
    source("src/core/audioTrackPreferences.ts"),
    source("src/core/remoteShortcutPreferences.ts"),
  ]);
  for (const body of files) {
    assert.match(body, /let mutationEpoch = 0/);
    assert.match(body, /const loadEpoch = mutationEpoch/);
    assert.match(body, /if \(loaded \|\| loadEpoch !== mutationEpoch\) return/);
    assert.match(body, /mutationEpoch \+= 1/);
  }
});

test("audio and remote preference hydration is coalesced and patch ownership is authoritative", async () => {
  const [audio, remote] = await Promise.all([
    source("src/core/audioTrackPreferences.ts"),
    source("src/core/remoteShortcutPreferences.ts"),
  ]);
  assert.match(audio, /let loadPromise: Promise<Snapshot> \| null = null/);
  assert.match(audio, /async function load\(\): Promise<Snapshot>/);
  assert.match(audio, /void load\(\)\.then/);
  assert.match(audio, /Persist pruning only for the snapshot that actually won hydration/);
  assert.match(remote, /let loadPromise: Promise<RemoteShortcutPreferences> \| null = null/);
  assert.match(remote, /const next = normalize\(\{ \.\.\.cached, \.\.\.patch \}\)/);
  assert.doesNotMatch(remote, /const next = normalize\(\{ \.\.\.value, \.\.\.patch \}\)/);
});
