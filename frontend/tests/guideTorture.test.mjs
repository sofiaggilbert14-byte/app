import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CHANNEL_NAME_MAX_LINES,
  getGuideRailMetrics,
  getGuideRailNameWidth,
} from "../src/core/guideLayoutPolicy.ts";
import { evaluateGuideNavigation } from "../src/core/guideNavigationPolicy.ts";
import { runGuideTortureSimulation } from "../src/core/guideTorture.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("approved channel rail reserves two readable name lines beside number and logo", () => {
  const metrics = getGuideRailMetrics(1920, "normal", true, true);
  assert.equal(CHANNEL_NAME_MAX_LINES, 2);
  assert.equal(metrics.rowHeight, 64);
  assert.equal(metrics.logoSize, 38);
  assert.ok(metrics.railWidth >= 200);
  assert.ok(getGuideRailNameWidth(metrics, true, true) >= metrics.minimumNameWidth);
  assert.ok(metrics.nameLineHeight * CHANNEL_NAME_MAX_LINES <= metrics.rowHeight - 8);
});

test("channel rail keeps usable name width across density and visibility settings", () => {
  for (const width of [720, 1280, 1920]) {
    for (const density of ["large", "normal", "compact"]) {
      for (const numbers of [false, true]) {
        for (const logos of [false, true]) {
          const metrics = getGuideRailMetrics(width, density, numbers, logos);
          assert.ok(getGuideRailNameWidth(metrics, numbers, logos) >= metrics.minimumNameWidth);
          assert.ok(metrics.rowHeight >= metrics.logoSize + 10);
        }
      }
    }
  }
});

test("held D-pad scans and rapid direction reversals never escape guide bounds", () => {
  const result = runGuideTortureSimulation({
    channelCount: 220,
    cycles: 20,
    groupSwitches: 500,
    horizontalTransitions: 2_000,
  });
  assert.equal(result.finalRow, 0);
  assert.equal(result.directionReversals, 40);
  assert.ok(result.events > 10_000);
  assert.ok(result.bottomLocks > 0);
  assert.ok(result.topBoundaries > 0);
});

test("guide boundary policy distinguishes channel rail, timeline, top, and bottom", () => {
  const decide = (key, focusRegion, focusedRow) => evaluateGuideNavigation({
    active: true,
    key,
    gridOwnsFocus: true,
    focusRegion,
    focusedRow,
    lastRow: 99,
  });
  assert.equal(decide("left", "channel", 30).boundary, "left-boundary");
  assert.equal(decide("left", "program", 30).boundary, null);
  assert.equal(decide("up", "program", 0).boundary, "top-boundary");
  assert.equal(decide("down", "channel", 99).boundary, "bottom-lock");
  assert.equal(decide("right", "channel", 50).boundary, null);
});

test("timeline uses the approved two-line rail and shared torture-tested navigation policy", async () => {
  const source = await readFile(join(root, "src/components/TimelineGrid.tsx"), "utf8");
  assert.match(source, /CHANNEL_NAME_MAX_LINES/);
  assert.match(source, /adjustsFontSizeToFit/);
  assert.match(source, /minimumFontScale=\{0\.82\}/);
  assert.match(source, /getGuideRailMetrics/);
  assert.match(source, /evaluateGuideNavigation/);
  assert.doesNotMatch(source, /numberOfLines=\{1\} style=\{styles\.logoName\}/);
});

test("guide session keeps preview, modal, refresh, and route-loop safety wiring", async () => {
  const [guide, streamPlayer, playerRoute, programModal] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8"),
    readFile(join(root, "app/player.tsx"), "utf8"),
    readFile(join(root, "src/components/ProgramModal.tsx"), "utf8"),
  ]);
  assert.match(guide, /previewId === previewChannel\.id/);
  assert.match(guide, /GuidePreviewRail/);
  assert.match(guide, /previewEpoch=\{previewEpoch\}/);
  assert.match(guide, /if \(previewTimer\.current\) clearTimeout\(previewTimer\.current\)/);
  assert.match(guide, /active=\{!activeProgram && !drawerOpen\}/);
  assert.match(guide, /refreshing=\{refreshing\}/);
  assert.match(guide, /openFullscreenPlayer/);
  assert.match(guide, /setPreviewId\(null\)/);
  // Blur must not globally force-stop (kills newly mounted fullscreen); zap/play use role-scoped stops.
  assert.doesNotMatch(streamPlayer, /if \(!isFocused\) forceStopAllStreams\(\)/);
  assert.doesNotMatch(streamPlayer, /forceStopAllStreams\(\)/);
  assert.doesNotMatch(streamPlayer, /pauseSessionDecoders\(role\)|pauseOnRapidScan|guideScanSettled/);
  assert.match(streamPlayer, /role === "preview"/);
  assert.match(streamPlayer, /clearFullscreenCircuit/);
  assert.match(streamPlayer, /parsePipeHeaders\(uri\)\.uri/);
  assert.match(streamPlayer, /setStatus\("error", "circuit-open"\)/);
  assert.doesNotMatch(streamPlayer, /pathname === "\/player"/);
  assert.match(playerRoute, /stopFullscreenSession/);
  assert.match(playerRoute, /pauseSessionDecoders\("fullscreen"\)/);
  assert.match(playerRoute, /rapidStripUntilRef/);
  assert.match(playerRoute, /remaining \+ 40/);
  assert.match(playerRoute, /clearFullscreenCircuit/);
  assert.match(playerRoute, /if \(zapTimer\.current\) clearTimeout\(zapTimer\.current\)/);
  assert.match(programModal, /hardwareBackPress/);
});
