import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("Media3 path exposes selectable audio tracks and deterministic audio focus", async () => {
  const [player, screen, diagnostics] = await Promise.all([
    source("src/components/StreamPlayer.tsx"),
    source("app/player.tsx"),
    source("src/core/audioDiagnostics.ts"),
  ]);
  assert.match(player, /reportAndSelectMedia3Tracks/);
  assert.match(player, /availableAudioTracksChange/);
  assert.match(player, /player\.audioTrack = selectedAudio/);
  assert.match(player, /player\.audioMixingMode = mode === "preview" \? "mixWithOthers" : "doNotMix"/);
  assert.match(player, /mediaReady/);
  assert.match(player, /forceMedia3/);
  assert.match(player, /recordAudioDiagnostics/);
  assert.match(player, /auto-supported/);
  assert.match(player, /Displace an unsupported selection/);
  assert.match(screen, /unsupported on this decoder/);
  assert.match(screen, /silent-audio/);
  assert.match(screen, /setAudioTrackId\(undefined\)/);
  assert.match(diagnostics, /fingerprintStreamUri/);
  assert.match(diagnostics, /audioDiagnosticsExtras/);
});

test("Expo Video patch disables chunkless HLS prep and exposes renderer track capability", async () => {
  const patch = await source("patches/expo-video+3.0.16.patch");
  assert.match(patch, /HlsMediaSource/);
  assert.match(patch, /setAllowChunklessPreparation\(false\)/);
  assert.match(patch, /HlsAudioRecoveryPlaylistParserFactory/);
  assert.match(patch, /setPlaylistParserFactory/);
  assert.match(patch, /EXTENSION_RENDERER_MODE_ON/);
  assert.match(patch, /mimeType/);
  assert.match(patch, /isSupported/);
  assert.match(patch, /IPTV HLS manifests often omit a stable FORMAT id/);
  assert.match(patch, /groupIdsMatch/);
  assert.match(patch, /missingAttach/);
  assert.match(patch, /CharmIPTVAudio/);
  assert.match(patch, /currentTracks/);
  assert.match(patch, /identity/);
});

test("Android TV build includes a pinned LGPL Media3 FFmpeg audio extension", async () => {
  const [appBuild, settings, workflow, script, nativeBuildScript, notice, proguard, moduleBuild] =
    await Promise.all([
      source("android/app/build.gradle"),
      source("android/settings.gradle"),
      source("../.github/workflows/purple-tv-ui.yml"),
      source("scripts/build-media3-ffmpeg-audio.sh"),
      source("android/ffmpeg-audio/src/main/jni/build_ffmpeg.sh"),
      source("android/ffmpeg-audio/NOTICE.md"),
      source("android/ffmpeg-audio/proguard-rules.pro"),
      source("android/ffmpeg-audio/build.gradle"),
    ]);
  assert.match(appBuild, /implementation project\(':ffmpeg-audio'\)/);
  assert.match(settings, /include ':ffmpeg-audio'/);
  assert.match(workflow, /Build LGPL Media3 FFmpeg audio extension/);
  assert.match(workflow, /ndk;27\.1\.12297006/);
  assert.match(workflow, /cmake;3\.22\.1/);
  assert.match(workflow, /build-media3-ffmpeg-audio\.sh/);
  assert.match(workflow, /libffmpegJNI\\.so/);
  assert.match(script, /ac3 eac3 dca truehd mlp/);
  assert.match(script, /n6\.0/);
  assert.match(nativeBuildScript, /--disable-gpl/);
  assert.match(nativeBuildScript, /--disable-nonfree/);
  assert.match(notice, /LGPL/i);
  assert.match(notice, /patent/i);
  assert.match(proguard, /FfmpegAudioRenderer/);
  assert.match(moduleBuild, /FFmpeg android-libs missing/);
});

test("audio diagnostics fingerprint never retains the raw URI", async () => {
  const { fingerprintStreamUri, recordAudioDiagnostics, audioDiagnosticsExtras } = await import(
    "../src/core/audioDiagnostics.ts"
  );
  const uri = "http://example.test/live/secret-token-abc/index.m3u8|User-Agent=VLC";
  const key = fingerprintStreamUri(uri, "hls");
  assert.match(key, /^hls:/);
  assert.doesNotMatch(key, /secret-token/);
  assert.doesNotMatch(key, /User-Agent/);
  const snap = recordAudioDiagnostics({
    engine: "media3",
    role: "fullscreen",
    streamKey: key,
    trackId: "g0:t0:audio/ac3:eng:384000",
    mimeType: "audio/ac3",
    language: "eng",
    isSupported: true,
    trackCount: 1,
    supportedCount: 1,
    selectedBy: "auto-supported",
  });
  const extras = audioDiagnosticsExtras(snap);
  assert.equal(extras.audioMime, "audio/ac3");
  assert.equal(extras.audioSupported, true);
  assert.equal(extras.audioSilent, false);
});
