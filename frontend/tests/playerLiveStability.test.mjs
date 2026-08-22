import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preferredEngine } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("RC.1 routing keeps extensionless and raw IPTV on VLC probing", () => {
  assert.equal(preferredEngine("hls"), "media3");
  assert.equal(preferredEngine("dash"), "media3");
  assert.equal(preferredEngine("progressive"), "media3");
  assert.equal(preferredEngine("transport"), "vlc");
  assert.equal(preferredEngine("unknown"), "vlc");
  assert.equal(preferredEngine("rtsp"), "vlc");
  assert.equal(preferredEngine("rtmp"), "vlc");
  assert.equal(preferredEngine("srt"), "vlc");
  assert.equal(preferredEngine("webrtc"), "vlc");
});

test("Media3 keeps the RC.1 HTTP transport without clock-only decoder reloads", async () => {
  const [patch, player] = await Promise.all([
    source("patches/expo-video+3.0.16.patch"),
    source("src/components/StreamPlayer.tsx"),
  ]);
  assert.doesNotMatch(patch, /CharmPlayerHttpPool|ConnectionPool|Dispatcher/);
  assert.doesNotMatch(patch, /connectTimeout|readTimeout|writeTimeout/);
  assert.doesNotMatch(patch, /VideoPlayerLoadControl\.kt|bufferForPlaybackAfterRebufferMs/);
  assert.match(player, /observedPlaybackTime = Number\(player\.currentTime\)/);
  assert.match(player, /if \(bufferingSince == null\) return/);
  assert.match(player, /const bufferingFor = now - bufferingSince/);
  assert.doesNotMatch(player, /MEDIA3_FROZEN_CLOCK_MS|const frozenReadyClock =/);
  assert.match(player, /MAX_SILENT_BUFFERING_RESYNCS = 1/);
  assert.match(player, /RESYNC_REARM_STABLE_MS = 30_000/);
});

test("VLC post-playback stalls become bounded recovery events", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /const VLC_BUFFERING_FAIL_MS = 12_000/);
  assert.match(player, /vlcBufferingSinceRef\.current = Date\.now\(\)/);
  assert.match(player, /bufferingSince == null \|\| Date\.now\(\) - bufferingSince < VLC_BUFFERING_FAIL_MS/);
  assert.doesNotMatch(player, /VLC_FROZEN_PROGRESS_MS|vlcLastProgressAtRef|vlcProgressSeenRef|onProgress=/);
  assert.doesNotMatch(player, /--clock-jitter=0|--clock-synchro=0/);
  assert.match(player, /const bufferRate = Number\(info\?\.bufferRate\)/);
  assert.match(player, /bufferRate >= 99\.9[\s\S]*?vlcBufferingSinceRef\.current = null/);
  assert.match(player, /vlcHasPlayedRef\.current = false;\s*fail\(\)/);
  assert.match(player, /onError=\{fail\}\s*onStopped=\{\(\) => \{\s*releaseResolveRef\.current\?\.\(\);\s*fail\(\);/);
  const vlcHardStop = player.match(/const hardStop = useCallback\(\(\): Promise<void> => \{[\s\S]*?\n  \}, \[\]\);/)?.[0] || "";
  assert.match(vlcHardStop, /releasePlayer/);
  assert.doesNotMatch(vlcHardStop, /if \(mode === "preview"\)/);
});

test("stale successful-engine memory cannot override RC.1 format routing", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.doesNotMatch(player, /getRememberedStreamEngine|rememberSuccessfulStreamEngine|engineMemoryKey/);
  assert.match(player, /const preferred = preferredEngine\(kind\)/);
});

test("Player Settings describes the format-aware default accurately", async () => {
  const settings = await source("app/(tabs)/settings.tsx");
  assert.match(settings, /Automatic \(format-aware\)/);
  assert.match(settings, /VLC probing for raw or extensionless IPTV links/);
  assert.doesNotMatch(settings, /Expo \/ Media3 \(Default\)/);
});

test("Media3 fullscreen uses the RC.1 render and balanced buffer path", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /surfaceType=\{Platform\.OS === "android" \? "textureView" : undefined\}/);
  assert.doesNotMatch(player, /mode === "preview" \? "textureView" : "surfaceView"/);
  assert.match(player, /preferredForwardBufferDuration: 3,\s*maxBufferBytes: 48 \* 1024 \* 1024/);
  assert.match(player, /profile === "balanced"\s*\? full\.maxBufferBytes/);
});

test("subtitle selection never reloads or remounts the active stream", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  const selection = player.match(/const reportAndSelectMedia3Tracks = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[/)?.[0] || "";
  assert.match(selection, /player\.subtitleTrack\?\.id !== selectedText\.id/);
  assert.match(selection, /player\.subtitleTrack = selectedText/);
  assert.doesNotMatch(selection, /replaceAsync|setEngine|hardStop|pauseSessionDecoders/);
});

test("Guide preview stalls are bounded and cannot poison fullscreen health state", async () => {
  const [player, guide] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/(tabs)/guide.tsx"),
  ]);
  assert.doesNotMatch(player, /if \(mode === "preview" \|\| paused \|\| blocked\) return;/);
  assert.doesNotMatch(player, /if \(mode === "preview" \|\| paused \|\| blocked \|\| !mediaReady\)/);
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
  assert.match(player, /if \(fallbackUsed \|\| forceVlc \|\| forceMedia3\) \{[\s\S]*?pauseSessionDecoders\(role\)\.then\(\(\) => \{[\s\S]*?setStatus\("error", "start-timeout"\);/);
  assert.match(player, /if \(alternate\) \{[\s\S]*?stableRef\.current = false;[\s\S]*?pauseSessionDecoders\(role\)\.then\(\(\) => \{[\s\S]*?setFallbackUsed\(true\);[\s\S]*?setEngine\(alternate\);/);
  assert.match(player, /engineSwapInFlightRef/);
  assert.doesNotMatch(player, /if \(stableRef\.current \|\| fallbackUsed\) return;/);
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
  assert.match(player, /if \(opts\?\.immediate\) \{[\s\S]*?const release = pauseSessionDecoders\("fullscreen"\);[\s\S]*?armDecoderAfterSettle\(DECODER_RESTART_SETTLE_MS, release\)/);
  const restart = player.match(/const restartStream = useCallback\([\s\S]*?\n  \}, \[channel\?\.name/)?.[0] || "";
  assert.match(restart, /const release = pauseSessionDecoders\("fullscreen"\);/);
  assert.match(restart, /void release\.catch\(\(\) => undefined\)\.then\(\(\) => \{[\s\S]*?setDecoderArmed\(true\)/);
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
