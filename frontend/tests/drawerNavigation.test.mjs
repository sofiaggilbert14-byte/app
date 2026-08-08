import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRAWER_REOPEN_DOUBLE_BACK_MS,
  evaluateDrawerBack,
} from "../src/core/drawerNavigationPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("closed-drawer Back arms reopen; second Back within the window opens", () => {
  assert.equal(evaluateDrawerBack({ drawerOpen: false, blockingOverlayOpen: false }), "arm-reopen");
  assert.equal(
    evaluateDrawerBack({
      drawerOpen: false,
      blockingOverlayOpen: false,
      reopenArmedAt: 1_000,
      now: 1_000 + DRAWER_REOPEN_DOUBLE_BACK_MS,
    }),
    "open-drawer",
  );
  assert.equal(
    evaluateDrawerBack({
      drawerOpen: false,
      blockingOverlayOpen: false,
      reopenArmedAt: 1_000,
      now: 1_000 + DRAWER_REOPEN_DOUBLE_BACK_MS + 1,
    }),
    "arm-reopen",
  );
  assert.equal(evaluateDrawerBack({ drawerOpen: true, blockingOverlayOpen: false }), "close-drawer");
  assert.equal(evaluateDrawerBack({ drawerOpen: false, blockingOverlayOpen: true }), "pass-through");
});

test("drawer uses bounded native motion and excludes hidden controls from TV focus", async () => {
  const [shell, layout, rootLayout] = await Promise.all([
    readFile(join(root, "src/components/PurpleTvShell.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/_layout.tsx"), "utf8"),
    readFile(join(root, "app/_layout.tsx"), "utf8"),
  ]);
  assert.match(shell, /useNativeDriver: true/);
  assert.match(shell, /styles\.sidebarSpacer|sidebarSpacer/);
  assert.match(shell, /focusable=\{drawerOpen\}/);
  assert.match(shell, /trapFocusRight/);
  assert.match(shell, /closeDrawer\(\);/);
  assert.match(shell, /requestNativeFocusWithRetry\(\s*navRefs\.current\.get\(active\)/);
  assert.match(shell, /drawerAutoFocus && selected/);
  assert.match(shell, /PURPLE_DRAWER_ANIMATION_MS,\s*280,\s*420,\s*650/);
  // Guide owns preferred focus — content autoFocus must not pulse when drawer closes on /guide.
  assert.match(shell, /active !== "\/guide"/);
  assert.match(shell, /evaluateDrawerBack/);
  assert.match(shell, /close-drawer/);
  assert.match(shell, /closeDrawer\(\)/);
  assert.match(shell, /PURPLE_RAIL_PEEK_WIDTH/);
  assert.match(shell, /sidebarOverlay/);
  assert.match(shell, /onLongPress=\{exit\}/);
  assert.match(shell, /Hold Exit/);
  assert.match(shell, /purple-rail-double-back-hint/);
  assert.doesNotMatch(shell, /testID="purple-rail-open-drawer"/);
  assert.match(shell, /decorative rail when closed/);
  assert.match(shell, /combineTvEdgeInsets/);
  assert.doesNotMatch(shell, /NAV\.slice\(0,\s*6\)/);
  assert.doesNotMatch(shell, /useNativeDriver: false/);
  assert.doesNotMatch(shell, /AsyncStorage|refreshSource|clearGuideCache|SQLite|database/i);
  assert.doesNotMatch(layout, /PurpleTvDrawerProvider/);
  assert.match(rootLayout, /<PurpleTvDrawerProvider>/);
  assert.match(layout, /<Tabs/);
});

test("guide tabs reclaim the left edge and top-row Up restores the active tab", async () => {
  const guide = await readFile(join(root, "app/(tabs)/guide.tsx"), "utf8");
  assert.match(guide, /marginLeft: drawerOpen \? 140 : 0/);
  assert.match(guide, /transform: \[\{ translateX: groupSlideX \}\]/);
  assert.match(guide, /requestNativeFocusWithRetry\(chip, \[0, 40, 120\]\)/);
  assert.match(guide, /onUpBoundary=\{onGuideUpBoundary\}/);
  assert.match(guide, /trapFocusLeft=\{!drawerOpen\}/);
  assert.match(guide, /active=\{!activeProgram && !drawerOpen\}/);
  assert.match(guide, /lockLeftEdge=\{!drawerOpen\}/);
  assert.doesNotMatch(guide, /onLeftBoundary=\{onGuideLeftBoundary\}/);
  assert.doesNotMatch(guide, /onGuideLeftBoundary/);
  assert.doesNotMatch(guide, /openDrawer\(\)/);
  assert.match(guide, /openFullscreenPlayer/);
  assert.match(guide, /drawerWasOpenForFocusRef/);
  assert.match(guide, /requestNativeFocusWithRetry\(lastGuideFocusNodeRef\.current/);
  assert.match(guide, /setGuideNavigationActive\(false\)/);
  assert.doesNotMatch(guide, /setGuideNavigationActive\(true\)/);
  assert.match(guide, /Preview recovering/);
  assert.match(guide, /setPreviewId\(null\)/);
  assert.match(guide, /useTvBackHandler/);
  assert.match(guide, /onBackTargetChange/);
  assert.match(guide, /guideSessionGroup/);
  assert.match(guide, /restoreChannelId=\{guideSessionChannelId\}/);
  assert.doesNotMatch(guide, /openDrawer\(\);\s*\n\s*return true/);
});

test("grids never open the drawer from D-pad Left", async () => {
  const [timeline, box] = await Promise.all([
    readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8"),
    readFile(join(root, "src/components/BoxGrid.tsx"), "utf8"),
  ]);
  assert.match(timeline, /armGuideLeftFocusLock/);
  assert.match(timeline, /applyLeftFocusLock\(node, lockFocusLeft\)/);
  assert.match(box, /armGuideLeftFocusLock/);
  assert.match(box, /lockFocusLeft/);
  assert.match(timeline, /viewPosition: rapidVertical \? 0\.22 : 0\.45/);
  assert.match(box, /viewPosition: 0\.25/);
  assert.doesNotMatch(timeline, /onLeftBoundary\?\.\(\)/);
  assert.doesNotMatch(box, /onLeftBoundary\?\.\(\)/);
  assert.match(timeline, /epg-timeline-now-indicator/);
  assert.match(timeline, /progProgressFill/);
});

test("settings and reminders never open the drawer on a single Back", async () => {
  const settings = await readFile(join(root, "app/(tabs)/settings.tsx"), "utf8");
  const reminders = await readFile(join(root, "app/(tabs)/reminders.tsx"), "utf8");
  assert.doesNotMatch(settings, /openDrawer\(\)/);
  assert.doesNotMatch(reminders, /openDrawer\(\)/);
  assert.match(settings, /Defer to PurpleTvShell/);
});

test("legacy route-level guide redirects cannot override the drawer", async () => {
  const routes = ["catchup", "channels", "favorites", "index", "movies", "search", "series"];
  const sources = await Promise.all(routes.map((route) => readFile(join(root, `app/(tabs)/${route}.tsx`), "utf8")));
  for (const source of sources) assert.doesNotMatch(source, /useTvBackToGuide/);
  const home = await readFile(join(root, "app/(tabs)/index.tsx"), "utf8");
  assert.match(home, /NowPlayingBar/);
});

test("APK install artifact is separate from diagnostics evidence", async () => {
  const workflow = await readFile(join(root, "../.github/workflows/purple-next-ci.yml"), "utf8");
  assert.match(workflow, /name: CharmIPTV-Purple-Next-APK-/);
  assert.match(workflow, /path: frontend\/artifact\/install\/CharmIPTV-Purple-Next\.apk/);
  assert.match(workflow, /name: CharmIPTV-Purple-Next-Evidence-/);
});
