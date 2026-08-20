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
