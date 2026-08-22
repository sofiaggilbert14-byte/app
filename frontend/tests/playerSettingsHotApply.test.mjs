import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("player remounts for device decoder changes while preserving bounded buffers", async () => {
  const source = await readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8");
  assert.match(source, /vlcEngineKey/);
  assert.match(source, /media3EngineKey/);
  assert.match(source, /playerCompat\.vlcAudioOutput/);
  assert.match(source, /playerCompat\.media3AudioMode/);
  assert.match(source, /playerCompat\.videoDecoderMode/);
  assert.match(source, /hwDecoderEnabled: playerCompat\.videoDecoderMode === "device" \? 1 : 0/);
  assert.match(source, /hwDecoderForced: 0/);
  assert.match(source, /--stereo-mode=1/);
  assert.doesNotMatch(source, /--audio-filter=stereo_widen/);
  assert.match(source, /reportAndSelectMedia3Tracks\(\)/);
  // Settings remount must reset silent-audio / start-timeout fallback gates.
  assert.match(source, /appliedCompatKeyRef/);
  assert.match(source, /const sessionKey = `\$\{role\}:\$\{uri\}:\$\{initialEngine\}:\$\{appliedCompatKeyRef\.current\}/);
  // Preview freezes compat keys while Guide is unfocused (Tabs keep-alive).
  assert.match(source, /role !== "preview" \|\| isFocused/);
  // Optional profiles scale down on low-RAM devices; balanced stays on the
  // real-device RC.1 control while preview remains tightly bounded.
  assert.match(source, /shouldUseLowRamTuning/);
  assert.match(source, /preferredForwardBufferDuration: 3/);
  assert.match(source, /maxBufferBytes: 48 \* 1024 \* 1024/);
  assert.match(source, /profile === "balanced"\s*\? full\.maxBufferBytes/);
  assert.match(source, /coordinatedCacheBudget/);
  assert.match(source, /Math\.min\(12 \* 1024 \* 1024, coordinatedCacheBudget\)/);
  assert.match(source, /if \(media3Audio === "ffmpeg"\) return selectedAudio != null/);
  assert.match(source, /export function isFullscreenCircuitOpen/);
  // Terminal native failures must release the decoder before publishing failure.
  assert.match(source, /hardStop\(\);\s*recordFailure\(sessionRole, engine, uri, "stream-error"\)/);
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
