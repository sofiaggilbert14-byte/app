import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (path) => readFile(join(root, path), "utf8");

test("Guide tab customization keeps provider identity separate from display metadata", async () => {
  const prefs = await text("src/core/guideGroupTabPreferences.ts");
  const groups = await text("src/core/guideGroups.ts");
  assert.match(prefs, /aliases: Record<string, string>/);
  assert.match(prefs, /hidden: string\[\]/);
  assert.match(prefs, /order: string\[\]/);
  assert.match(prefs, /reverseAliases\[displayName\] \|\| displayName/);
  assert.match(prefs, /id === RESERVED_ID/);
  assert.match(groups, /resolveGuideGroupIdentity\(group\)/);
  assert.match(groups, /channel\.group === sourceGroup/);
});

test("Group settings expose provider and custom visibility rename and ordering", async () => {
  const screen = await text("app/group-settings.tsx");
  assert.match(screen, /Provider group tabs/);
  assert.match(screen, /tabPrefs\.move\(groupId, -1, providerGroups\)/);
  assert.match(screen, /tabPrefs\.setVisible\(groupId, !visible\)/);
  assert.match(screen, /commitProviderRename/);
  assert.match(screen, /toggleCustomVisible/);
  assert.match(screen, /custom\.moveGroup\(group\.id, -1\)/);
  assert.match(screen, /guideUi\.hiddenGroups\.map\(\(name\) => name === oldName \? nextName : name\)/);
  assert.match(screen, /groupNameCollides/);
  assert.match(screen, /providerGroups\.some\(\(id\) => id !== options\?\.providerId/);
  assert.match(screen, /custom\.groups\.some\(\(group\) => group\.id !== options\?\.customId/);
  assert.match(screen, /Object\.entries\(tabPrefs\.aliases\)\.some/);
  assert.match(screen, /if \(!name \|\| groupNameCollides\(name\)\) return/);
});

test("customization persistence cannot let stale initial reads overwrite newer edits", async () => {
  const [tabs, custom, channels, guideUi] = await Promise.all([
    text("src/core/guideGroupTabPersistence.ts"),
    text("src/core/customGuideGroups.ts"),
    text("src/core/channelCustomize.ts"),
    text("src/core/guideUiPreferences.ts"),
  ]);
  for (const persistence of [tabs, custom, channels, guideUi]) {
    assert.match(persistence, /let mutationEpoch = 0/);
    assert.match(persistence, /const loadEpoch = mutationEpoch/);
    assert.match(persistence, /function commit[\s\S]*?mutationEpoch \+= 1/);
  }
  assert.match(tabs, /if \(loaded \|\| loadEpoch !== mutationEpoch\) return getGuideGroupTabPreferencesSnapshot\(\)/);
  assert.match(custom, /if \(loaded \|\| loadEpoch !== mutationEpoch\) return cached/);
  assert.match(channels, /if \(loaded \|\| loadEpoch !== mutationEpoch\) return cached/);
  assert.match(guideUi, /if \(loaded \|\| loadEpoch !== mutationEpoch\) return cached/);
});

test("automatic TV layout starts full viewport and calibration owns real overscan", async () => {
  const layout = await text("src/utils/tvLayout.ts");
  const calibration = await text("src/tvCalibration.tsx");
  assert.match(layout, /return \{ top: 0, right: 0, bottom: 0, left: 0 \}/);
  assert.doesNotMatch(layout, /shortSide \* 0\.012/);
  assert.match(calibration, /pathname === "\/player" \|\| pathname\.startsWith\("\/player\/"\)/);
  assert.match(calibration, /combineTvEdgeInsets/);
});

test("player aspect fit remains view-layer and decoder independent", async () => {
  const player = await text("src/components/StreamPlayer.tsx");
  assert.match(player, /scaleMode = "fit"/);
  assert.match(player, /contentFit=\{scaleMode === "zoom" \? "cover" : scaleMode === "stretch" \? "fill" : "contain"\}/);
  assert.match(player, /resizeMode=\{scaleMode === "zoom" \? "cover" : scaleMode === "stretch" \? "stretch" : "contain"\}/);
});
