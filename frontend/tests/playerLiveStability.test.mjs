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

test("Media3 live reads tolerate provider jitter without disabling bounded decoder recovery", async () => {
  const [patch, player] = await Promise.all([
    source("patches/expo-video+3.0.16.patch"),
    source("src/components/StreamPlayer.tsx"),
  ]);
  assert.match(patch, /connectTimeout\(5, TimeUnit\.SECONDS\)/);
  assert.match(patch, /readTimeout\(30, TimeUnit\.SECONDS\)/);
  assert.doesNotMatch(patch, /readTimeout\(5, TimeUnit\.SECONDS\)/);
  assert.match(player, /const MEDIA3_FROZEN_CLOCK_MS = 9000/);
  assert.match(player, /observedPlaybackTime = Number\(player\.currentTime\)/);
  assert.match(player, /Boolean\(\(player as any\)\.playing\)/);
  assert.match(player, /MAX_SILENT_BUFFERING_RESYNCS = 2/);
});

test("fullscreen channel zaps pause the active decoder and defer remount during rapid surfing", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /pauseSessionDecoders\("fullscreen"\)/);
  assert.match(player, /setDecoderArmed\(false\)/);
  assert.match(player, /armDecoderAfterSettle\(CHANNEL_ZAP_SETTLE_MS\)/);
  assert.match(player, /if \(pendingChannelIdRef\.current !== id\) return/);
  assert.match(player, /rapidStripUntilRef/);
});

test("fullscreen exit returns the currently tuned channel to Guide instead of the launch channel", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /const currentChannelId = pendingChannelIdRef\.current \|\| channelIdRef\.current/);
  assert.match(player, /requestGuideJump\(\{ channelId: currentChannelId, group: "All" \}\)/);
  assert.match(player, /router\.replace\("\/guide" as any\)/);
});
