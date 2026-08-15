import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const source = (path) => readFile(join(root, path), "utf8");

test("Guide is a single native logical canvas with predictive prefetch", async () => {
  const [guide, bridge, view, app] = await Promise.all([
    source("app/(tabs)/guide.tsx"), source("src/components/NativeGuideCanvas.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
    source("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"),
  ]);
  assert.match(guide, /<NativeGuideCanvas/);
  assert.doesNotMatch(guide, /TimelineGrid|BoxGrid|focusClaimNonce/);
  assert.match(bridge, /requireNativeComponent<any>\("CharmNativeGuide"\)/);
  assert.match(view, /override fun onDraw\(canvas: Canvas\)/);
  assert.match(view, /override fun onKeyDown/);
  assert.match(view, /moveVelocity/);
  assert.match(view, /database\.queryGuideWindow/);
  assert.match(app, /add\(NativeGuidePackage\(\)\)/);
});

test("preview tuning only follows settled native selection", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /if \(settled\) armPreviewForChannel\(channel\)/);
});

test("Startup V4 uses source milestones and permits progressive EPG entry", async () => {
  const startup = await source("src/components/StartupVersion4.tsx");
  assert.match(startup, /subscribeProgress/);
  assert.match(startup, /epgStarted \|\| freshCacheReady/);
  assert.doesNotMatch(startup, /setTimeout|setInterval/);
});

test("settings recovery and drawer transition guard are wired", async () => {
  const [settings, epg, shell] = await Promise.all([
    source("app/(tabs)/settings.tsx"), source("app/(tabs)/epg-sources.tsx"), source("src/components/PurpleTvShell.tsx"),
  ]);
  assert.match(settings, /testID="settings-all-settings"/);
  assert.match(settings, /CharmShowAllSettings/);
  assert.match(epg, />All Settings</);
  assert.match(shell, /openedAtRef/);
  assert.match(shell, /PURPLE_DRAWER_ANIMATION_MS \+ 70/);
});

test("retired Catch Up feature cannot return through navigation or routing", async () => {
  const [tabs, shell, playback] = await Promise.all([
    source("app/(tabs)/_layout.tsx"),
    source("src/components/PurpleTvShell.tsx"),
    source("tests/playbackSession.test.mjs"),
  ]);
  for (const body of [tabs, shell, playback]) {
    assert.doesNotMatch(body, /catch[ -]?up|\/catchup/i);
  }
  await assert.rejects(source("app/(tabs)/catchup.tsx"), { code: "ENOENT" });
});
