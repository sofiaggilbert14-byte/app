import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preferredEngine } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("live player routes only unsupported contribution transports straight to VLC", () => {
  assert.equal(preferredEngine("hls"), "media3");
  assert.equal(preferredEngine("dash"), "media3");
  assert.equal(preferredEngine("progressive"), "media3");
  assert.equal(preferredEngine("transport"), "media3");
  assert.equal(preferredEngine("rtsp"), "media3");
  assert.equal(preferredEngine("rtmp"), "vlc");
  assert.equal(preferredEngine("srt"), "vlc");
  assert.equal(preferredEngine("webrtc"), "vlc");
});

test("Media3 dead provider reads fail promptly without clock-only decoder reloads", async () => {
  const [patch, player] = await Promise.all([
    source("patches/expo-video+3.0.16.patch"),
    source("src/components/StreamPlayer.tsx"),
  ]);
  assert.match(patch, /connectTimeout\(5, TimeUnit\.SECONDS\)/);
  assert.match(patch, /readTimeout\(5, TimeUnit\.SECONDS\)/);
  assert.match(patch, /writeTimeout\(5, TimeUnit\.SECONDS\)/);
  assert.doesNotMatch(patch, /readTimeout\(30, TimeUnit\.SECONDS\)/);
  assert.match(player, /observedPlaybackTime = Number\(player\.currentTime\)/);
  assert.match(player, /if \(bufferingSince == null\) return/);
  assert.match(player, /const bufferingFor = now - bufferingSince/);
  assert.doesNotMatch(player, /MEDIA3_FROZEN_CLOCK_MS|const frozenReadyClock =/);
  assert.match(player, /MAX_SILENT_BUFFERING_RESYNCS = 1/);
  assert.match(player, /RESYNC_REARM_STABLE_MS = 30_000/);
});

test("VLC post-playback stalls become bounded recovery events", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /const VLC_FROZEN_PROGRESS_MS = 8_000/);
  assert.match(player, /const VLC_BUFFERING_FAIL_MS = 12_000/);
  assert.match(player, /const vlcProgressSeenRef = useRef\(false\)/);
  assert.match(player, /const vlcLastProgressValueRef = useRef<number \| null>\(null\)/);
  assert.match(player, /onProgress=\{\(info: any\) => \{/);
  assert.match(player, /const currentTime = Number\(info\?\.currentTime\)/);
  assert.match(player, /const position = Number\(info\?\.position\)/);
  assert.match(player, /Math\.abs\(progressValue - previous\) > 0\.0001/);
  assert.match(player, /vlcLastProgressAtRef\.current = Date\.now\(\)/);
  assert.match(player, /vlcBufferingSinceRef\.current = Date\.now\(\)/);
  assert.match(player, /const bufferingStalled = bufferingSince != null && now - bufferingSince >= VLC_BUFFERING_FAIL_MS/);
  assert.match(player, /now - vlcLastProgressAtRef\.current >= VLC_FROZEN_PROGRESS_MS/);
  assert.match(player, /if \(!bufferingStalled && !progressStalled\) return/);
  assert.match(player, /vlcHasPlayedRef\.current = false;\s*fail\(\)/);
  assert.match(player, /onError=\{fail\}\s*onStopped=\{fail\}/);
});

test("Guide preview cannot rewrite fullscreen engine memory", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /if \(role === "fullscreen"\) rememberSuccessfulStreamEngine\(engineMemoryKey, engine\)/);
  assert.doesNotMatch(player, /stableRef\.current = true;\s*rememberSuccessfulStreamEngine\(engineMemoryKey, engine\);/);
});

test("Guide preview stalls are bounded and cannot poison fullscreen health state", async () => {
  const [player, guide] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/(tabs)/guide.tsx"),
  ]);
  assert.doesNotMatch(player, /if \(mode === "preview" \|\| paused \|\| blocked\) return;/);
  assert.doesNotMatch(player, /if \(mode === "preview" \|\| paused \|\| blocked \|\| !mediaReady\)/);
  assert.match(player, /const VLC_FROZEN_PROGRESS_MS = 8_000/);
  assert.match(player, /const VLC_BUFFERING_FAIL_MS = 12_000/);
  assert.match(player, /if \(bufferingSince == null\) return/);
  assert.match(player, /const RESYNC_REARM_STABLE_MS = 30_000/);
  assert.doesNotMatch(player, /MEDIA3_FROZEN_CLOCK_MS|const frozenReadyClock =/);
  assert.doesNotMatch(guide, /noteStreamFailure/);
  assert.doesNotMatch(guide, /clearStreamFailure/);
});

test("Media3 reprepare and fullscreen retry budgets only re-arm after stable playback", async () => {
  const [stream, player] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/player.tsx"),
  ]);
  assert.match(stream, /const MAX_SILENT_BUFFERING_RESYNCS = 1/);
  assert.match(stream, /const RESYNC_REARM_STABLE_MS = 30_000/);
  assert.match(stream, /stableProgressSinceRef/);
  assert.doesNotMatch(stream, /lastPlaybackAdvanceAtRef|hasAdvancedPlaybackRef/);
  assert.match(player, /const STREAM_RETRY_DELAYS_MS = \[1000, 2000, 4000\] as const/);
  assert.match(player, /const MAX_AUTO_STREAM_RETRIES = 3/);
  assert.match(player, /const STABLE_RETRY_RESET_MS = 30_000/);
  assert.match(player, /stableRetryResetTimer\.current = setTimeout/);
  assert.doesNotMatch(player, /if \(status === "playing"\) \{\s*setRetryAttempt\(0\)/);
});

test("late stable-stream failure clears the stable gate and bounds fallback startup", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /if \(fallbackUsed \|\| forceVlc \|\| forceMedia3\) \{\s*pauseSessionDecoders\(role\);\s*setSessionPhase\(role, sessionGeneration, "failed", "start-timeout"\);\s*setStatus\("error", "start-timeout"\);/);
  assert.match(player, /if \(alternate\) \{[\s\S]*?stableRef\.current = false;[\s\S]*?setFallbackUsed\(true\);[\s\S]*?setEngine\(alternate\);/);
  assert.doesNotMatch(player, /if \(stableRef\.current \|\| fallbackUsed\) return;/);
});

test("fullscreen channel zaps pause one decoder, settle once, and preserve Previous channel", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /pauseSessionDecoders\("fullscreen"\)/);
  assert.match(player, /setDecoderArmed\(false\)/);
  assert.match(player, /armDecoderAfterSettle\(CHANNEL_ZAP_SETTLE_MS\)/);
  assert.match(player, /if \(pendingChannelIdRef\.current !== id\) return/);
  assert.match(player, /rapidStripUntilRef/);
  assert.match(player, /const previous = channelIdRef\.current/);
  assert.match(player, /if \(previous && previous !== pending\) previousChannelIdRef\.current = previous/);
});

test("retry and immediate channel remounts wait for native decoder release", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /const DECODER_RESTART_SETTLE_MS = 120/);
  assert.match(player, /if \(opts\?\.immediate\) \{[\s\S]*?setDecoderArmed\(false\);[\s\S]*?armDecoderAfterSettle\(DECODER_RESTART_SETTLE_MS\)/);
  assert.match(player, /zapTimer\.current = setTimeout\(\(\) => \{\s*if \(generation === generationRef\.current\) setDecoderArmed\(true\);\s*\}, DECODER_RESTART_SETTLE_MS\)/);
  const restart = player.match(/const restartStream = useCallback\([\s\S]*?\n  \}, \[channel\?\.name/)?.[0] || "";
  assert.doesNotMatch(restart, /requestAnimationFrame/);
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
  assert.doesNotMatch(modal, /openFullscreenPlayer\(router, channel\.id\);/);
});
