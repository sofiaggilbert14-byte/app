import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("live TV core is a single Media3 path with serialized native ownership", async () => {
  const [stream, manager] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("src/core/media3PlaybackManager.ts"),
  ]);
  assert.match(stream, /VideoView/);
  assert.match(stream, /loadMedia3Source/);
  assert.doesNotMatch(stream, /VLCPlayer|react-native-vlc-media-player|setEngine\(|fallbackUsed|alternateEngine/);
  assert.match(manager, /let nativeMutationTail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(manager, /function enqueueNativeMutation/);
  assert.match(manager, /return enqueueNativeMutation\(async \(\) => \{/);
  assert.match(manager, /activeRole = role/);
  assert.match(manager, /await instance\.replaceAsync\(source\)/);
  assert.match(manager, /activeRole !== "preview"/);
  assert.match(manager, /activeRole !== "fullscreen"/);
});

test("stale channel loads are invalidated before they can restart old playback", async () => {
  const stream = await source("src/components/StreamPlayer.tsx");
  assert.match(stream, /const loadRequestRef = useRef\(0\)/);
  assert.match(stream, /const requestId = \+\+loadRequestRef\.current/);
  assert.match(stream, /if \(requestId !== loadRequestRef\.current\) return/);
  assert.match(stream, /loadRequestRef\.current \+= 1/);
  assert.match(stream, /isSessionCurrent\(role, generation\)/);
});

test("Media3 startup and post-playback recovery are bounded", async () => {
  const stream = await source("src/components/StreamPlayer.tsx");
  assert.match(stream, /FULLSCREEN_START_TIMEOUT_MS = 12_000/);
  assert.match(stream, /PREVIEW_START_TIMEOUT_MS = 8_000/);
  assert.match(stream, /REBUFFER_REPREPARE_MS = 5_000/);
  assert.match(stream, /REBUFFER_FAIL_MS = 12_000/);
  assert.match(stream, /MAX_SILENT_BUFFERING_RESYNCS = 1/);
  assert.match(stream, /RESYNC_REARM_STABLE_MS = 30_000/);
  assert.match(stream, /silentResyncCountRef\.current < MAX_SILENT_BUFFERING_RESYNCS/);
  assert.match(stream, /silentResyncCountRef\.current \+= 1/);
  assert.match(stream, /void load\(true\)/);
  assert.match(stream, /elapsed >= REBUFFER_FAIL_MS/);
  assert.doesNotMatch(stream, /MEDIA3_FROZEN_CLOCK_MS|VLC_FROZEN_PROGRESS_MS|frozenReadyClock/);
});

test("retry budget only rearms after a stable 30-second playback window", async () => {
  const stream = await source("src/components/StreamPlayer.tsx");
  assert.match(stream, /stableSinceRef = useRef<number \| null>\(null\)/);
  assert.match(stream, /stableSinceRef\.current = Date\.now\(\)/);
  assert.match(stream, /now - stableSinceRef\.current >= RESYNC_REARM_STABLE_MS/);
  assert.match(stream, /silentResyncCountRef\.current = 0/);
  assert.doesNotMatch(stream, /lastPlaybackAdvanceAtRef|hasAdvancedPlaybackRef/);
});

test("first-frame ownership is the only stable-playing gate", async () => {
  const stream = await source("src/components/StreamPlayer.tsx");
  const firstFrame = stream.match(/onFirstFrameRender=\{\(\) => \{[\s\S]*?\n\s*\}\}/)?.[0] || "";
  assert.match(firstFrame, /stableRef\.current = true/);
  assert.match(firstFrame, /setSessionPhase\(role, generation, "playing"\)/);
  assert.match(firstFrame, /emit\("playing"\)/);
  const ready = stream.match(/else if \(status === "readyToPlay"\) \{[\s\S]*?\n\s*\} else if/)?.[0] || "";
  assert.doesNotMatch(ready, /emit\("playing"\)|setSessionPhase\([^\n]*"playing"/);
});

test("fullscreen and preview use separate Android surfaces and bounded memory", async () => {
  const stream = await source("src/components/StreamPlayer.tsx");
  assert.match(stream, /mode === "preview" \? "textureView" : "surfaceView"/);
  assert.match(stream, /preferredForwardBufferDuration: 1\.2/);
  assert.match(stream, /maxBufferBytes: Math\.min\(\(lowRam \? 6 : 10\) \* 1024 \* 1024, coordinatedCacheBudget\)/);
  assert.match(stream, /preferredForwardBufferDuration: lowRam \? 4 : 5/);
  assert.match(stream, /maxBufferBytes: \(lowRam \? 20 : 32\) \* 1024 \* 1024/);
  assert.match(stream, /Math\.min\(full\.maxBufferBytes, coordinatedCacheBudget\)/);
});

test("subtitle selection hot-applies without replacing the stream", async () => {
  const stream = await source("src/components/StreamPlayer.tsx");
  const publish = stream.match(/const publishTracks = useCallback\(\(\) => \{[\s\S]*?\n\s*\}, \[/)?.[0] || "";
  assert.match(publish, /player\.subtitleTrack = selectedText/);
  assert.doesNotMatch(publish, /replaceAsync|loadMedia3Source|releaseFullscreenMedia3/);
});

test("Guide preview cannot own playback while fullscreen owns the session", async () => {
  const [stream, guide] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/(tabs)/guide.tsx"),
  ]);
  assert.match(stream, /isPreviewPlaybackAllowed\(\)/);
  assert.match(stream, /const previewAllowed = role !== "preview" \|\| isPreviewPlaybackAllowed\(\)/);
  assert.match(stream, /role === "preview" \? releasePreviewMedia3\(\) : releaseFullscreenMedia3\(\)/);
  assert.doesNotMatch(guide, /noteStreamFailure|clearStreamFailure/);
});

test("fullscreen channel zaps pause one decoder, settle once, and preserve Previous channel", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /const release = pauseSessionDecoders\("fullscreen"\);/);
  assert.match(player, /setDecoderArmed\(false\)/);
  assert.match(player, /armDecoderAfterSettle\(CHANNEL_ZAP_SETTLE_MS, release\)/);
  assert.match(player, /if \(pendingChannelIdRef\.current !== id\) return/);
  assert.match(player, /rapidStripUntilRef/);
  assert.match(player, /const previous = channelIdRef\.current/);
  assert.match(player, /if \(previous && previous !== pending\) previousChannelIdRef\.current = previous/);
});

test("retry and immediate channel remounts wait for native decoder release", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /const DECODER_RESTART_SETTLE_MS = 120/);
  assert.match(player, /pauseSessionDecoders\("fullscreen"\)/);
  assert.match(player, /armDecoderAfterSettle\(DECODER_RESTART_SETTLE_MS, release\)/);
});

test("fullscreen exit returns the currently tuned channel to Guide instead of the launch channel", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /const currentChannelId = pendingChannelIdRef\.current \|\| channelIdRef\.current/);
  assert.match(player, /requestGuideJump\(\{ channelId: currentChannelId, group: "All" \}\)/);
  assert.match(player, /router\.replace\("\/guide" as any\)/);
});

test("Program Details Watch now preserves the Guide return anchor", async () => {
  const modal = await source("src/components/ProgramModal.tsx");
  assert.match(modal, /openFullscreenPlayer\(router, channel\.id, \{ returnToGuide: pathname\?\.startsWith\("\/guide"\) \}\)/);
});
