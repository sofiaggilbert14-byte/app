import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("native Media3 exposes selectable audio tracks and deterministic track selection", async () => {
  const [adapter, native, screen] = await Promise.all([source("src/components/StreamPlayer.tsx"), source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), source("app/player.tsx")]);
  assert.match(adapter, /addNativePlaybackTracksListener/); assert.match(adapter, /selectNativeAudio/); assert.match(adapter, /getRememberedChannelAudioTrack\(channelKey\)/); assert.match(adapter, /getPreferredAudioLanguage\(\)/); assert.match(native, /fun selectAudio/); assert.match(native, /clearOverridesOfType\(C\.TRACK_TYPE_AUDIO\)/); assert.match(native, /TrackSelectionOverride/); assert.match(native, /EXTENSION_RENDERER_MODE_ON/); assert.match(screen, /setAudioTrackId\(undefined\)/);
});

test("Android TV build includes a pinned LGPL Media3 FFmpeg audio extension", async () => {
  const [appBuild, settings, workflow, script, nativeBuildScript, nativeBridge, notice, proguard, moduleBuild] = await Promise.all([source("android/app/build.gradle"), source("android/settings.gradle"), source("../.github/workflows/purple-tv-ui.yml"), source("scripts/build-media3-ffmpeg-audio.sh"), source("android/ffmpeg-audio/src/main/jni/build_ffmpeg.sh"), source("android/ffmpeg-audio/src/main/jni/ffmpeg_jni.cc"), source("android/ffmpeg-audio/NOTICE.md"), source("android/ffmpeg-audio/proguard-rules.pro"), source("android/ffmpeg-audio/build.gradle")]);
  assert.match(appBuild, /implementation project\(':ffmpeg-audio'\)/); assert.match(settings, /include ':ffmpeg-audio'/); assert.match(workflow, /Build LGPL Media3 FFmpeg audio extension/); assert.match(workflow, /ndk;27\.1\.12297006/); assert.match(workflow, /cmake;3\.22\.1/); assert.match(workflow, /build-media3-ffmpeg-audio\.sh/); assert.match(script, /ac3 eac3 dca truehd mlp/); assert.match(script, /n6\.0/); assert.match(nativeBuildScript, /--disable-gpl/); assert.match(nativeBuildScript, /--disable-nonfree/); assert.match(notice, /LGPL/i); assert.match(notice, /patent/i); assert.match(proguard, /FfmpegAudioRenderer/); assert.match(moduleBuild, /media3-exoplayer:1\.8\.0/); assert.match(moduleBuild, /media3-ui:1\.8\.0/); assert.match(moduleBuild, /media3-datasource-okhttp:1\.8\.0/); assert.match(nativeBridge, /AV_CODEC_ID_TRUEHD/); assert.match(nativeBridge, /releaseContext\(context\)/); assert.match(nativeBridge, /avcodec_flush_buffers\(context\)/);
});

test("audio diagnostics fingerprint never retains raw URI", async () => { const { fingerprintStreamUri, recordAudioDiagnostics, audioDiagnosticsExtras } = await import("../src/core/audioDiagnostics.ts"); const uri = "http://example.test/live/secret-token-abc/index.m3u8|User-Agent=VLC"; const key = fingerprintStreamUri(uri, "hls"); assert.match(key, /^hls:/); assert.doesNotMatch(key, /secret-token/); const snap = recordAudioDiagnostics({ engine: "media3", role: "fullscreen", streamKey: key, trackId: "g0:t0:audio/ac3:eng:384000", mimeType: "audio/ac3", language: "eng", isSupported: true, trackCount: 1, supportedCount: 1, selectedBy: "auto-supported" }); const extras = audioDiagnosticsExtras(snap); assert.equal(extras.audioMime, "audio/ac3"); assert.equal(extras.audioSupported, true); });
