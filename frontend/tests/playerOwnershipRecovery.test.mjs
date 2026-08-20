import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("player cleanup cannot clobber a newer TV remote owner", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /resetRemoteContextIfOwned/);
  assert.match(player, /return \(\) => resetRemoteContextIfOwned\("player", "default"\)/);
  assert.doesNotMatch(player, /return \(\) => setRemoteContext\("default"\)/);
});

test("Guide blur cleanup cannot clobber a newer TV remote owner", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /resetRemoteContextIfOwned/);
  assert.match(guide, /resetRemoteContextIfOwned\("guide", "default"\)/);
  const focusEffect = guide.match(/useFocusEffect\([\s\S]*?\n\s*\);/)?.[0] || "";
  assert.doesNotMatch(focusEffect, /setRemoteContext\("default"\)/);
});

test("ErrorBoundary crash recovery waits for native decoder release before remount", async () => {
  const player = await source("app/player.tsx");
  const reset = player.match(/onReset=\{\(\) => \{[\s\S]*?\n\s*\}\}/)?.[0] || "";
  assert.match(reset, /stopAllPlaybackSessions\("crashed"\)/);
  assert.match(reset, /setDecoderArmed\(false\)/);
  assert.match(reset, /setTimeout\(\(\) => \{/);
  assert.match(reset, /DECODER_RESTART_SETTLE_MS/);
  assert.doesNotMatch(reset, /setDecoderArmed\(true\);\s*setRetryToken/);
});
