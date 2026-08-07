import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDrawerBack } from "../src/core/drawerNavigationPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Back opens a closed drawer but never steals an overlay or open-drawer Back", () => {
  assert.equal(evaluateDrawerBack({ drawerOpen: false, blockingOverlayOpen: false }), "open-drawer");
  assert.equal(evaluateDrawerBack({ drawerOpen: true, blockingOverlayOpen: false }), "keep-drawer-open");
  assert.equal(evaluateDrawerBack({ drawerOpen: false, blockingOverlayOpen: true }), "pass-through");
});

test("drawer uses bounded native motion and excludes hidden controls from TV focus", async () => {
  const [shell, layout] = await Promise.all([
    readFile(join(root, "src/components/PurpleTvShell.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/_layout.tsx"), "utf8"),
  ]);
  assert.match(shell, /useNativeDriver: true/);
  assert.match(shell, /width: drawerOpen \? PURPLE_SIDEBAR_WIDTH : 0/);
  assert.match(shell, /focusable=\{drawerOpen\}/);
  assert.match(shell, /trapFocusRight/);
  assert.match(shell, /closeDrawer\(\);/);
  assert.match(shell, /requestNativeFocusWithRetry\(navRefs\.current\.get\(active\)/);
  // Guide owns preferred focus — content autoFocus must not pulse when drawer closes on /guide.
  assert.match(shell, /active !== "\/guide"/);
  assert.doesNotMatch(shell, /useNativeDriver: false/);
  assert.doesNotMatch(shell, /AsyncStorage|refreshSource|clearGuideCache|SQLite|database/i);
  assert.match(layout, /<PurpleTvDrawerProvider>/);
  assert.match(layout, /<Tabs/);
});

test("guide tabs reclaim the left edge and top-row Up restores the active tab", async () => {
  const guide = await readFile(join(root, "app/(tabs)/guide.tsx"), "utf8");
  assert.match(guide, /marginLeft: drawerOpen \? 140 : 0/);
  assert.match(guide, /transform: \[\{ translateX: groupSlideX \}\]/);
  assert.match(guide, /requestNativeFocusWithRetry\(chip, \[0, 40, 120\]\)/);
  assert.match(guide, /onUpBoundary=\{onGuideUpBoundary\}/);
  assert.match(guide, /onLeftBoundary=\{onGuideLeftBoundary\}/);
  assert.match(guide, /openDrawer\(\)/);
  assert.match(guide, /forceStopAllStreams\(\)/);
  assert.match(guide, /drawerWasOpenForFocusRef/);
  assert.match(guide, /requestNativeFocusWithRetry\(lastGuideFocusNodeRef\.current, \[80, 180, 300\]\)/);
});

test("legacy route-level guide redirects cannot override the drawer", async () => {
  const routes = ["catchup", "channels", "favorites", "index", "movies", "search", "series"];
  const sources = await Promise.all(routes.map((route) => readFile(join(root, `app/(tabs)/${route}.tsx`), "utf8")));
  for (const source of sources) assert.doesNotMatch(source, /useTvBackToGuide/);
});

test("APK install artifact is separate from diagnostics evidence", async () => {
  const workflow = await readFile(join(root, "../.github/workflows/purple-next-ci.yml"), "utf8");
  assert.match(workflow, /name: CharmIPTV-Purple-Next-APK-/);
  assert.match(workflow, /path: frontend\/artifact\/install\/CharmIPTV-Purple-Next\.apk/);
  assert.match(workflow, /name: CharmIPTV-Purple-Next-Evidence-/);
});
