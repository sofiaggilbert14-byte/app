import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("live TV core is one Activity-owned Media3 path", async () => {
  const [stream, native, bridge] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("src/nativePlayback.ts")]);
  assert.match(stream, /prepareNativeFullscreen/); assert.match(stream, /prepareNativePreview/); assert.doesNotMatch(stream, /VideoView|VLCPlayer|react-native-vlc-media-player|alternateEngine/);
  assert.match(native, /object NativePlaybackManager/); assert.match(native, /private var player: ExoPlayer\? = null/); assert.match(native, /private var owner: Owner = Owner\.NONE/); assert.match(native, /if \(requestedOwner == Owner\.PREVIEW && owner == Owner\.FULLSCREEN\) return@runOnMain/); assert.match(bridge, /NativeModules\.NativePlayback/);
});

test("channel changes replace MediaItem on the same native ExoPlayer", async () => {
  const [player, native] = await Promise.all([
    source("app/player.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
  ]);
  assert.match(native, /player\?\.let \{ return it \}/); assert.match(native, /instance\.clearMediaItems\(\)/); assert.match(native, /instance\.setMediaItem\(itemBuilder\.build\(\), true\)/); assert.match(native, /instance\.prepare\(\)/);
  assert.doesNotMatch(player, /decoderArmed|pauseSessionDecoders|CHANNEL_ZAP_SETTLE_MS|armDecoderAfterSettle/);
});

test("Media3 uses live-TV buffers and one native recovery watchdog", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /MIN_BUFFER_MS = 1_000/); assert.match(native, /MAX_BUFFER_MS = 2_500/); assert.match(native, /PLAYBACK_BUFFER_MS = 500/); assert.match(native, /REBUFFER_BUFFER_MS = 1_000/); assert.match(native, /TARGET_BUFFER_BYTES = 12 \* 1024 \* 1024/); assert.match(native, /HUNG_BUFFER_REPREPARE_MS = 5_000L/); assert.match(native, /if \(owner == Owner\.NONE \|\| recoveryUsed\)/); assert.match(native, /instance\.prepare\(\)/);
});

test("first frame is the stable-playing gate", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  const firstFrame = native.match(/override fun onRenderedFirstFrame\(\)[\s\S]*?\n\s*}/)?.[0] || ""; assert.match(firstFrame, /firstFrameRendered = true/); assert.match(firstFrame, /listener\?\.onState\("playing", null\)/);
});

test("native PlayerView is mounted inside the React playback target instead of below opaque screens", async () => {
  const [native, surface, adapter] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackSurface.kt"),
    source("src/components/StreamPlayer.tsx"),
  ]);
  assert.match(native, /attachSurface/); assert.match(native, /target\.addView\(video, fillParent\(\)\)/); assert.match(native, /setShutterBackgroundColor\(Color\.BLACK\)/);
  assert.doesNotMatch(native, /content\.removeView\(reactRoot\)/);
  assert.match(surface, /class NativePlaybackSurface/); assert.match(surface, /NativePlaybackManager\.attachSurface/);
  assert.match(adapter, /CharmNativePlaybackSurface/);
});

test("audio and subtitles hot-apply through TrackSelectionParameters", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /trackSelectionParameters\.buildUpon\(\)/); assert.match(native, /TrackSelectionOverride/); assert.match(native, /clearOverridesOfType\(C\.TRACK_TYPE_AUDIO\)/); assert.match(native, /clearOverridesOfType\(C\.TRACK_TYPE_TEXT\)/);
});

test("Guide preview cannot own playback while fullscreen owns native player", async () => {
  const [stream, native, guide] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("app/(tabs)/guide.tsx")]);
  assert.match(stream, /isPreviewPlaybackAllowed\(\)/); assert.match(native, /requestedOwner == Owner\.PREVIEW && owner == Owner\.FULLSCREEN/); assert.doesNotMatch(guide, /noteStreamFailure|clearStreamFailure/);
});

test("fullscreen exit returns currently tuned channel to Guide", async () => {
  const player = await source("app/player.tsx"); assert.match(player, /const currentChannelId = pendingChannelIdRef\.current \|\| channelIdRef\.current/); assert.match(player, /requestGuideJump\(\{ channelId: currentChannelId, group: "All" \}\)/); assert.match(player, /router\.replace\("\/guide" as any\)/);
});

test("Program Details Watch now preserves Guide return anchor", async () => { const modal = await source("src/components/ProgramModal.tsx"); assert.match(modal, /openFullscreenPlayer\(router, channel\.id, \{ returnToGuide: pathname\?\.startsWith\("\/guide"\) \}\)/); });
