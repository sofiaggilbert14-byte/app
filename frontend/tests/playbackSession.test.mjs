import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  beginSession,
  getSessionPhase,
  isPreviewPlaybackAllowed,
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

test("fullscreen reservation releases preview before allocating its decoder", async () => {
  resetPlaybackSessionsForTests();
  const previewGen = beginSession("preview");
  assert.equal(isSessionCurrent("preview", previewGen), true);
  let previewStopped = 0;
  let fullStopped = 0;
  registerSessionStop("preview", previewGen, () => { previewStopped += 1; });
  await stopPreviewForFullscreen();
  assert.equal(previewStopped, 1);
  assert.equal(isPreviewPlaybackAllowed(), false);
  const fullGen = beginSession("fullscreen");
  registerSessionStop("fullscreen", fullGen, () => { fullStopped += 1; });
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
  registerSessionStop("preview", gen, () => { stops += 1; });
  pauseSessionDecoders("preview");
  assert.equal(stops, 1);
  assert.equal(isSessionCurrent("preview", gen), true);
  pauseSessionDecoders("preview");
  assert.equal(stops, 1);
});

test("begin/stop clear stale decoder callbacks after invoking them once", () => {
  resetPlaybackSessionsForTests();
  const gen1 = beginSession("fullscreen");
  let stops = 0;
  registerSessionStop("fullscreen", gen1, () => { stops += 1; });
  beginSession("fullscreen");
  assert.equal(stops, 1);
  stopFullscreenSession();
  assert.equal(stops, 1);
});

test("preview cannot re-arm until fullscreen releases its reservation", async () => {
  resetPlaybackSessionsForTests();
  beginSession("fullscreen");
  assert.equal(beginSession("preview"), 0);
  assert.equal(isPreviewPlaybackAllowed(), false);
  await stopFullscreenSession();
  assert.equal(isPreviewPlaybackAllowed(), true);
  const previewGen = beginSession("preview");
  let previewStopped = 0;
  registerSessionStop("preview", previewGen, () => { previewStopped += 1; });
  assert.equal(previewStopped, 0);
  assert.equal(isSessionCurrent("preview", previewGen), true);
  await stopAllPlaybackSessions();
  assert.equal(isSessionCurrent("preview", previewGen), false);
});

test("all live stream classifications route automatically through Media3 only", () => {
  for (const uri of [
    "https://x/live.m3u8",
    "https://x/live.ts",
    "http://provider.example/live/user/pass/1234",
    "rtsp://x/live",
  ]) {
    assert.equal(preferredEngine(detectStreamKind(uri)), "media3");
  }
  assert.equal(alternateEngine("media3", true), null);
  assert.equal(alternateEngine("vlc", true), null);
});

test("play entry points hand off through openFullscreenPlayer", async () => {
  const files = [
    "app/(tabs)/guide.tsx",
    "app/(tabs)/index.tsx",
    "app/(tabs)/favorites.tsx",
    "app/(tabs)/channels.tsx",
    "app/(tabs)/search.tsx",
    "src/components/ProgramModal.tsx",
    "src/components/PurpleChannelCollection.tsx",
    "app/_layout.tsx",
  ];
  for (const file of files) {
    const body = await source(file);
    assert.match(body, /openFullscreenPlayer/, `${file} should use openFullscreenPlayer`);
    assert.doesNotMatch(body, /pathname:\s*["']\/player["']/, `${file} should not push /player directly`);
  }
});

test("StreamPlayer and player route use role-scoped deterministic Media3 teardown", async () => {
  const [playerComp, playerRoute, handoff, manager, packageJson] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/player.tsx"),
    source("src/utils/openFullscreenPlayer.ts"),
    source("src/core/media3PlaybackManager.ts"),
    source("package.json"),
  ]);
  assert.match(playerComp, /beginSession\(role\)/);
  assert.match(playerComp, /isSessionCurrent/);
  assert.match(playerComp, /sessionRole/);
  assert.match(playerComp, /isPreviewPlaybackAllowed/);
  assert.match(playerComp, /setNativePlaybackReleaseHandler/);
  assert.match(playerComp, /releasePreviewMedia3/);
  assert.match(playerComp, /releaseFullscreenMedia3/);
  assert.match(playerComp, /suspendFullscreenMedia3/);
  assert.match(playerComp, /AppState\.addEventListener/);
  assert.match(playerComp, /loadRequestRef/);
  assert.match(playerComp, /onStatusRef\.current/);
  assert.match(playerComp, /mode === "preview" \? "textureView" : "surfaceView"/);
  assert.match(playerComp, /player\.muted = muted/);
  assert.doesNotMatch(playerComp, /VLCPlayer|react-native-vlc-media-player|replaceQueueRef|hardStop/);
  assert.match(manager, /enqueueNativeMutation/);
  assert.match(manager, /await instance\.replaceAsync\(source\)/);
  assert.match(manager, /await instance\.replaceAsync\(null as any\)/);
  assert.match(manager, /instance\.release\(\)/);
  assert.match(playerRoute, /onStatus=\{handleStreamStatus\}/);
  assert.match(playerRoute, /pauseSessionDecoders\("fullscreen"\)/);
  assert.match(playerRoute, /stopFullscreenSession/);
  assert.match(playerRoute, /mode="full"/);
  assert.match(playerRoute, /sessionRole="fullscreen"/);
  assert.match(playerRoute, /MAX_AUTO_STREAM_RETRIES/);
  assert.match(playerRoute, /restartStream\(false\)/);
  assert.match(handoff, /stopPreviewForFullscreen\(\)/);
  assert.match(handoff, /\.then\(\(\) => \{/);
  assert.doesNotMatch(handoff, /FULLSCREEN_HANDOFF_SETTLE_MS|PREVIEW_RELEASE_TIMEOUT_MS|Promise\.race/);
  assert.match(packageJson, /apply-media3-live-tv-patch\.mjs/);
});

test("fullscreen launched from Guide returns the currently tuned channel to Guide", async () => {
  const [guide, player, handoff] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("app/player.tsx"),
    source("src/utils/openFullscreenPlayer.ts"),
  ]);
  assert.match(guide, /openFullscreenPlayer\(router, channel\.id, \{ returnToGuide: true \}\)/);
  assert.match(handoff, /returnToGuide: options\?\.returnToGuide \? "1" : undefined/);
  const exit = player.match(/const stopAndExit = useCallback\([\s\S]*?\n  \}, \[params\.returnToGuide, router\]\);/)?.[0] || "";
  assert.match(exit, /pendingChannelIdRef\.current \|\| channelIdRef\.current/);
  assert.match(exit, /params\.returnToGuide === "1"/);
  assert.match(exit, /requestGuideJump\(\{ channelId: currentChannelId, group: "All" \}\)/);
  assert.match(exit, /router\.replace\("\/guide" as any\)/);
  assert.match(exit, /router\.back\(\)/);
});

test("Media3 watchdog recovers only real post-first-frame buffering and never clock-polls", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /stableRef\.current && bufferingSinceRef\.current == null/);
  assert.match(player, /bufferingSinceRef\.current = now/);
  assert.match(player, /REBUFFER_REPREPARE_MS = 5_000/);
  assert.match(player, /REBUFFER_FAIL_MS = 12_000/);
  assert.match(player, /MAX_SILENT_BUFFERING_RESYNCS = 1/);
  assert.match(player, /RESYNC_REARM_STABLE_MS = 30_000/);
  assert.match(player, /void load\(true\)/);
  assert.doesNotMatch(player, /player\.currentTime|MEDIA3_FROZEN_CLOCK_MS|frozenReadyClock|stalledReady/);
});
