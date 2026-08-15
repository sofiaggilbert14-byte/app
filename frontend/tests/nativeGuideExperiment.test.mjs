import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("native Guide is one canvas with logical focus, runway prefetch, and settled preview", async () => {
  const [view, manager, guide] = await Promise.all([
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"), "utf8"),
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/NativeGuideManager.kt"), "utf8"),
    readFile(join(root, "src/components/NativeGuide.tsx"), "utf8"),
  ]);
  assert.match(view, /isFocusable = true/);
  assert.match(view, /selectedRow/);
  assert.match(view, /repeatCount > 10/);
  assert.match(view, /val ahead = 8 \+ min\(28, repeatCount \* 2\)/);
  assert.match(view, /emitSelection\(settled = true\)/);
  assert.match(view, /override fun onDraw\(canvas: Canvas\)/);
  assert.match(manager, /CharmNativeGuide/);
  assert.match(guide, /if \(!item\.value\.settled\) return/);
});

test("Startup V4 uses real provider milestones and alternate install identity", async () => {
  const [startup, config, gradle] = await Promise.all([
    readFile(join(root, "src/components/StartupVersion4.tsx"), "utf8"),
    readFile(join(root, "app.json"), "utf8"),
    readFile(join(root, "android/app/build.gradle"), "utf8"),
  ]);
  assert.match(startup, /channels, loading, refreshing, windowStart, windowEnd/);
  assert.doesNotMatch(startup, /setTimeout|setInterval/);
  assert.match(startup, /startup-version-4/);
  assert.match(config, /Charm IPTV Native Guide/);
  assert.match(config, /com\.charmiptv\.app\.nativeguide/);
  assert.match(gradle, /applicationId 'com\.charmiptv\.app\.nativeguide'/);
});
