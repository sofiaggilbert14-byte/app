import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  beginSession,
  getSessionPhase,
  isSessionCurrent,
  pauseSessionDecoders,
  registerSessionStop,
  resetPlaybackSessionsForTests,
  setSessionPhase,
  stopPreviewForFullscreen,
  stopFullscreenSession,
  stopAllPlaybackSessions,
} from "../src/core/playbackSession.ts";
import { alternateEngine, detectStreamKind, preferredEngine } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("playback session generations isolate preview from fullscreen", () => {
  resetPlaybackSessionsForTests();
  const previewGen = beginSession("preview");
  const fullGen = beginSession("fullscreen");
  assert.equal(isSessionCurrent("preview", previewGen), true);
  assert.equal(isSessionCurrent("fullscreen", fullGen), true);

  let previewStopped = 0;
  let fullStopped = 0;
  registerSessionStop("preview", previewGen, () => {
    previewStopped += 1;
  });
  registerSessionStop("fullscreen", fullGen, () => {
    fullStopped += 1;
  });

  stopPreviewForFullscreen();
  assert.equal(previewStopped, 1);
  assert.equal(fullStopped, 0);
  assert.equal(isSessionCurrent("preview", previewGen), false);
  assert.equal(isSessionCurrent("fullscreen", fullGen), true);
});

test("stale session events are rejected after channel generation bump", () => {
  resetPlaybackSessionsForTests();
  const gen1 = beginSession("fullscreen");
  assert.equal(setSessionPhase("fullscreen", gen1, "playing"), true);
  assert.equal(getSessionPhase("fullscreen"), "playing");

  const gen2 = beginSession("fullscreen");
  assert.equal(setSessionPhase("fullscreen", gen1, "failed", "stream-error"), false);
  assert.equal(getSessionPhase("fullscreen"), "preparing");
  assert.equal(setSessionPhase("fullscreen", gen2, "playing"), true);
  assert.equal(isSessionCurrent("fullscreen", gen1), false);
});

test("pauseSessionDecoders does not invalidate generation", () => {
  resetPlaybackSessionsForTests();
  const gen = beginSession("preview");
  let stops = 0;
  registerSessionStop("preview", gen, () => {
    stops += 1;
  });
  pauseSessionDecoders("preview");
  assert.equal(stops, 1);
  assert.equal(isSessionCurrent("preview", gen), true);
});

test("fullscreen stop does not tear down a later preview session", () => {
  resetPlaybackSessionsForTests();
  beginSession("fullscreen");
  const previewGen = beginSession("preview");
  let previewStopped = 0;
  registerSessionStop("preview", previewGen, () => {
    previewStopped += 1;
  });
  stopFullscreenSession();
  assert.equal(previewStopped, 0);
  assert.equal(isSessionCurrent("preview", previewGen), true);
  stopAllPlaybackSessions();
  assert.equal(isSessionCurrent("preview", previewGen), false);
});

test("capability-based engine selection still prefers Media3 for HLS and VLC for TS", () => {
  assert.equal(detectStreamKind("https://x/live.m3u8"), "hls");
  assert.equal(preferredEngine("hls"), "media3");
  assert.equal(detectStreamKind("https://x/live.ts"), "transport");
  assert.equal(preferredEngine("transport"), "vlc");
  assert.equal(alternateEngine("media3", true), "vlc");
  assert.equal(alternateEngine("media3", false), null);
});

test("play entry points hand off through openFullscreenPlayer", async () => {
  const files = [
    "app/(tabs)/guide.tsx",
    "app/(tabs)/index.tsx",
    "app/(tabs)/favorites.tsx",
    "app/(tabs)/channels.tsx",
    "app/(tabs)/search.tsx",
    "app/(tabs)/catchup.tsx",
    "src/components/ProgramModal.tsx",
    "src/components/PurpleChannelCollection.tsx",
    "app/_layout.tsx",
  ];
  for (const file of files) {
    const body = await source(file);
    assert.match(body, /openFullscreenPlayer/, `${file} should use openFullscreenPlayer`);
    assert.doesNotMatch(
      body,
      /pathname:\s*["']\/player["']/,
      `${file} should not push /player directly`,
    );
  }
});

test("StreamPlayer and player route use role-scoped session teardown", async () => {
  const [playerComp, playerRoute, lifecycle] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/player.tsx"),
    source("src/utils/streamLifecycle.ts"),
  ]);
  assert.match(playerComp, /pauseSessionDecoders\(role\)/);
  assert.match(playerComp, /beginSession\(role\)/);
  assert.match(playerComp, /isSessionCurrent/);
  assert.match(playerComp, /sessionRole/);
  assert.doesNotMatch(playerComp, /forceStopAllStreams\(\)/);
  assert.match(playerRoute, /stopFullscreenSession/);
  assert.match(playerRoute, /sessionRole="fullscreen"/);
  assert.match(lifecycle, /playbackSession/);
});
