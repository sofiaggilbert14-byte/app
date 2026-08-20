import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = async (path) => (await readFile(join(root, path), "utf8")).replace(/\r\n/g, "\n");

test("Guide long Select routes channel rail and programme cells contextually", async () => {
  const [overlay, modal, selection] = await Promise.all([
    source("src/components/TvQuickActionsOverlay.tsx"),
    source("src/components/ProgramModal.tsx"),
    source("src/core/guideSelectionStore.ts"),
  ]);

  assert.match(selection, /surface: "channel" \| "program"/);
  assert.match(overlay, /const guideSelection = nextContext === "guide" \? getGuideSelection\(\) : null/);
  assert.match(overlay, /guideSelection\?\.surface === "program" && guideSelection\.program/);
  assert.match(overlay, /openProgram\(guideSelection\.program, selectedChannel\)/);
  assert.match(overlay, /setChannelId\(id\)[\s\S]{0,180}setOpen\(true\)[\s\S]{0,180}setRemoteContext\("modal"\)/);
  assert.match(modal, /setRemoteContext\("modal"\)/);
  assert.match(modal, /resetRemoteContextIfOwned\("modal", restore\)/);
});

test("Player Quick Actions dispatch into the mounted player instead of duplicating decoder state", async () => {
  const [overlay, player, remote] = await Promise.all([
    source("src/components/TvQuickActionsOverlay.tsx"),
    source("app/player.tsx"),
    source("src/utils/tvRemote.ts"),
  ]);

  assert.match(remote, /export type PlayerQuickCommand = "OPEN_TRACKS" \| "CYCLE_ASPECT"/);
  assert.match(remote, /DeviceEventEmitter\.emit\("CharmPlayerQuickCommand", command\)/);
  assert.match(remote, /addPlayerQuickCommandListener/);

  assert.match(overlay, /label="Aspect ratio"[\s\S]{0,180}runPlayerCommand\("CYCLE_ASPECT"\)/);
  assert.match(overlay, /label="Audio \/ subtitles"[\s\S]{0,180}runPlayerCommand\("OPEN_TRACKS"\)/);
  assert.match(overlay, /close\(\);[\s\S]{0,120}emitPlayerQuickCommand\(command\)/);

  assert.match(player, /addPlayerQuickCommandListener\(\(command\) =>/);
  assert.match(player, /command === "CYCLE_ASPECT"[\s\S]{0,100}cycleScaleMode\(\)/);
  assert.match(player, /command === "OPEN_TRACKS"[\s\S]{0,240}setTracksOpen\(true\)/);
  assert.doesNotMatch(player, /if \(key === "SELECT"\)/);
});
