import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Media3 hot-applies decoder preferences while preserving bounded buffers", async () => {
  const source = await readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8");
  assert.match(source, /usePlayerCompatibilityPreferences\(\)/);
  assert.match(source, /usePlaybackBufferProfile\(\)/);
  assert.match(source, /const effectiveBufferProfile = bufferProfile \?\? savedBufferProfile/);
  assert.match(source, /compat\.media3AudioMode === "ffmpeg"/);
  assert.match(source, /compat\.media3Tunneling/);
  assert.match(source, /profile === "low_latency"/);
  assert.match(source, /profile === "stable"/);
  assert.match(source, /preferredForwardBufferDuration: lowRam \? 4 : 5/);
  assert.match(source, /maxBufferBytes: \(lowRam \? 20 : 32\) \* 1024 \* 1024/);
  assert.match(source, /preferredForwardBufferDuration: lowRam \? 2\.5 : 3/);
  assert.match(source, /maxBufferBytes: \(lowRam \? 14 : 24\) \* 1024 \* 1024/);
  assert.match(source, /coordinatedCacheBudget/);
  assert.match(source, /Math\.min\(full\.maxBufferBytes, coordinatedCacheBudget\)/);
  assert.match(source, /mode === "preview"/);
  assert.match(source, /Math\.min\(\(lowRam \? 6 : 10\) \* 1024 \* 1024, coordinatedCacheBudget\)/);
  assert.match(source, /player\.audioMixingMode = mode === "preview" \? "mixWithOthers" : "doNotMix"/);
  assert.match(source, /player\.muted = muted/);
  assert.match(source, /if \(paused\) player\.pause\(\); else if \(playbackFocused\) player\.play\(\)/);
  assert.match(source, /publishTracks\(\)/);
  assert.match(source, /player\.subtitleTrack = selectedText/);
  assert.doesNotMatch(source, /vlcEngineKey|media3EngineKey|--stereo-mode=1|hardStop\(\)/);
});

test("real-device stable defaults are wired at storage bootstrap", async () => {
  const [engine, buffer, compat, store, layout, settings] = await Promise.all([
    readFile(join(root, "src/playerEnginePreference.ts"), "utf8"),
    readFile(join(root, "src/core/playbackBufferProfile.ts"), "utf8"),
    readFile(join(root, "src/core/playerCompatibilityPreferences.ts"), "utf8"),
    readFile(join(root, "src/store.tsx"), "utf8"),
    readFile(join(root, "src/core/guideLayoutDefault.ts"), "utf8"),
    readFile(join(root, "app/(tabs)/settings.tsx"), "utf8"),
  ]);
  assert.match(engine, /cachedPreference: PlayerEnginePreference = "vlc"/);
  assert.match(engine, /PLAYER_ENGINE_KEY, "vlc"/);
  assert.match(buffer, /value: PlaybackBufferProfile = "stable"/);
  assert.match(buffer, /KEY, "stable"/);
  assert.match(compat, /vlcAudioOutput: "stereo"/);
  assert.match(compat, /videoDecoderMode: "device"/);
  assert.match(compat, /media3AudioMode: "device"/);
  assert.match(store, /useState<SafePreviewMode>\("delayed"\)/);
  assert.match(store, /SAFE_PREVIEW_MODE_KEY, "delayed"/);
  assert.match(store, /useState<DeviceLayoutMode>\("tv"\)/);
  assert.match(layout, /return "cinematic"/);
  assert.match(settings, /label="Video decoder"/);
  assert.match(settings, /label="Audio decoder"/);
});
