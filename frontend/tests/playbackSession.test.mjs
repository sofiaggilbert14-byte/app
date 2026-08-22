import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beginSession, getSessionPhase, isPreviewPlaybackAllowed, isSessionCurrent, pauseSessionDecoders, registerSessionStop, resetPlaybackSessionsForTests, setNativePlaybackReleaseHandler, setSessionPhase, stopPreviewForFullscreen, stopFullscreenSession, stopAllPlaybackSessions } from "../src/core/playbackSession.ts";
import { detectStreamKind, preferredEngine } from "../src/core/streamPolicy.ts";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("fullscreen reservation releases preview before allocating its decoder", async () => { resetPlaybackSessionsForTests(); const previewGen = beginSession("preview"); let stopped = 0; registerSessionStop("preview", previewGen, () => { stopped += 1; }); await stopPreviewForFullscreen(); assert.equal(stopped, 1); assert.equal(isPreviewPlaybackAllowed(), false); const fullGen = beginSession("fullscreen"); assert.equal(isSessionCurrent("preview", previewGen), false); assert.equal(isSessionCurrent("fullscreen", fullGen), true); });
test("stale session events are rejected after channel generation bump", () => { resetPlaybackSessionsForTests(); const gen1 = beginSession("fullscreen"); assert.equal(setSessionPhase("fullscreen", gen1, "playing"), true); const gen2 = beginSession("fullscreen"); assert.equal(setSessionPhase("fullscreen", gen1, "failed", "stream-error"), false); assert.equal(getSessionPhase("fullscreen"), "preparing"); assert.equal(setSessionPhase("fullscreen", gen2, "playing"), true); });
test("pause preview callbacks do not invalidate generation", () => { resetPlaybackSessionsForTests(); const gen = beginSession("preview"); let stops = 0; registerSessionStop("preview", gen, () => { stops += 1; }); pauseSessionDecoders("preview"); assert.equal(stops, 1); assert.equal(isSessionCurrent("preview", gen), true); });
test("new generation drains stale callbacks exactly once", () => { resetPlaybackSessionsForTests(); const gen = beginSession("fullscreen"); let stops = 0; registerSessionStop("fullscreen", gen, () => { stops += 1; }); beginSession("fullscreen"); assert.equal(stops, 1); stopFullscreenSession(); assert.equal(stops, 1); });
test("preview cannot re-arm until fullscreen fully releases", async () => {
  resetPlaybackSessionsForTests();
  let releaseFullscreen;
  setNativePlaybackReleaseHandler((role) => role === "fullscreen" ? new Promise((resolve) => { releaseFullscreen = resolve; }) : undefined);
  beginSession("fullscreen");
  const stopped = stopFullscreenSession();
  assert.equal(isPreviewPlaybackAllowed(), false);
  assert.equal(beginSession("preview"), 0);
  releaseFullscreen();
  await stopped;
  assert.equal(isPreviewPlaybackAllowed(), true);
  const preview = beginSession("preview");
  setNativePlaybackReleaseHandler(null);
  await stopAllPlaybackSessions();
  assert.equal(isSessionCurrent("preview", preview), false);
});
test("all automatic stream routing is Media3-only", () => { for (const uri of ["https://x/live.m3u8", "https://x/live.ts", "http://provider/live/u/p/1", "rtsp://x/live"]) assert.equal(preferredEngine(detectStreamKind(uri)), "media3"); });

test("play entry points hand off through openFullscreenPlayer", async () => { const files = ["app/(tabs)/guide.tsx", "app/(tabs)/index.tsx", "app/(tabs)/favorites.tsx", "app/(tabs)/channels.tsx", "app/(tabs)/search.tsx", "src/components/ProgramModal.tsx", "src/components/PurpleChannelCollection.tsx", "app/_layout.tsx"]; for (const file of files) { const body = await source(file); assert.match(body, /openFullscreenPlayer/); assert.doesNotMatch(body, /pathname:\s*["']\/player["']/); } });

test("StreamPlayer is only a command adapter to Activity-owned native Media3", async () => { const [adapter, native, handoff] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("src/utils/openFullscreenPlayer.ts")]); assert.match(adapter, /prepareNativeFullscreen/); assert.match(adapter, /prepareNativePreview/); assert.match(adapter, /stopNativePreview/); assert.match(adapter, /stopNativeFullscreen/); assert.doesNotMatch(adapter, /VideoView|createVideoPlayer|VLCPlayer|react-native-vlc-media-player/); assert.match(native, /private var player: ExoPlayer\? = null/); assert.match(native, /PlayerView\(activity\)/); assert.match(native, /onRenderedFirstFrame/); assert.match(handoff, /stopPreviewForFullscreen\(\)/); assert.doesNotMatch(handoff, /FULLSCREEN_HANDOFF_SETTLE_MS|PREVIEW_RELEASE_TIMEOUT_MS|Promise\.race/); });

test("fullscreen launched from Guide returns current tuned channel to Guide", async () => { const [guide, player] = await Promise.all([source("app/(tabs)/guide.tsx"), source("app/player.tsx")]); assert.match(guide, /openFullscreenPlayer\(router, channel\.id, \{ returnToGuide: true \}\)/); assert.match(player, /pendingChannelIdRef\.current \|\| channelIdRef\.current/); assert.match(player, /requestGuideJump\(\{ channelId: currentChannelId, group: "All" \}\)/); });

test("single native watchdog reparses post-first-frame buffering without JS clock polling", async () => { const [adapter, native] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt")]); assert.match(native, /HUNG_BUFFER_REPREPARE_MS = 5_000L/); assert.match(native, /if \(!firstFrameRendered \|\| instance\.playbackState != Player\.STATE_BUFFERING\) return@Runnable/); assert.match(native, /instance\.prepare\(\)/); assert.doesNotMatch(adapter, /player\.currentTime|setInterval|REBUFFER_REPREPARE_MS|silentResyncCountRef/); });
