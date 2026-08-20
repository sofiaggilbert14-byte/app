import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (path) => readFile(join(root, path), "utf8");

test("Guide tab customization keeps provider identity separate from display metadata", async () => {
  const [model, groups] = await Promise.all([
    text("src/core/guideGroupTabModel.ts"),
    text("src/core/guideGroups.ts"),
  ]);
  assert.match(model, /aliases: Record<string, string>/);
  assert.match(model, /hidden: string\[\]/);
  assert.match(model, /order: string\[\]/);
  assert.match(model, /reverseAliases\[displayName\] \|\| displayName/);
  assert.match(model, /GUIDE_GROUP_RESERVED_ID/);
  assert.match(groups, /resolveGuideGroupIdentity\(group\)/);
  assert.match(groups, /channel\.group === sourceGroup/);
  assert.match(groups, /opts\.customGroups\?\.get\(sourceGroup\) \|\| opts\.customGroups\?\.get\(displayGroup\(sourceGroup\)\)/);
});

test("Group settings keep custom visibility on stable ids and provider order on raw ids", async () => {
  const [screen, persistence] = await Promise.all([
    text("app/group-settings.tsx"),
    text("src/core/guideGroupTabPersistence.ts"),
  ]);
  assert.match(screen, /Provider group tabs/);
  assert.match(screen, /orderedProviderGroups/);
  assert.match(screen, /tabPrefs\.move\(groupId, -1, providerGroups\)/);
  assert.match(screen, /tabPrefs\.setVisible\(groupId, !visible\)/);
  assert.match(screen, /tabPrefs\.rename\(group\.id, group\.name\)/);
  assert.match(screen, /toggleCustomVisible\(group\.id\)/);
  assert.match(screen, /tabPrefs\.remove\(groupId\)/);
  assert.match(screen, /custom\.moveGroup\(group\.id, -1\)/);
  assert.match(screen, /groupNameCollides/);
  assert.match(screen, /providerGroups\.some\(\(id\) => id !== options\?\.providerId/);
  assert.match(screen, /custom\.groups\.some\(\(group\) => group\.id !== options\?\.customId/);
  assert.match(screen, /Object\.entries\(tabPrefs\.aliases\)\.some/);
  assert.match(persistence, /const setVisible = useCallback/);
  assert.match(persistence, /const remove = useCallback/);
  assert.match(persistence, /if \(wasHidden === hidden\.has\(id\)\) return/);
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

test("player exposes distinct Fit Fill Zoom Stretch without decoder restart", async () => {
  const [engine, screen] = await Promise.all([
    text("src/components/StreamPlayer.tsx"),
    text("app/player.tsx"),
  ]);
  assert.match(engine, /scaleMode = "fit"/);
  assert.match(engine, /contentFit=\{scaleMode === "zoom" \? "cover" : scaleMode === "stretch" \? "fill" : "contain"\}/);
  assert.match(engine, /resizeMode=\{scaleMode === "zoom" \? "cover" : scaleMode === "stretch" \? "stretch" : "contain"\}/);
  assert.match(screen, /type PlayerViewMode = "fit" \| "fill" \| "zoom" \| "stretch"/);
  assert.match(screen, /current === "fit" \? "fill" : current === "fill" \? "zoom" : current === "zoom" \? "stretch" : "fit"/);
  assert.match(screen, /scaleMode === "fill" \? "zoom" : scaleMode === "stretch" \? "stretch" : "fit"/);
  assert.match(screen, /zoomedVideo: \{ transform: \[\{ scale: 1\.2 \}\] \}/);
  assert.match(screen, /root: \{ flex: 1, backgroundColor: "#000", overflow: "hidden" \}/);
});
