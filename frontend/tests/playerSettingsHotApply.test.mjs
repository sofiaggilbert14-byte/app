import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("native Media3 hot-applies audio subtitles mute pause and aspect without decoder rebuild", async () => {
  const [adapter, native] = await Promise.all([readFile(join(root, "src/components/StreamPlayer.tsx"), "utf8"), readFile(join(root, "android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"), "utf8")]);
  assert.match(adapter, /selectNativeAudio/); assert.match(adapter, /selectNativeSubtitle/); assert.match(adapter, /setNativePlaybackMuted/); assert.match(adapter, /pauseNativePlayback/); assert.match(adapter, /resumeNativePlayback/); assert.match(adapter, /setNativePlaybackResizeMode/);
  assert.match(native, /trackSelectionParameters\.buildUpon\(\)/); assert.match(native, /TrackSelectionOverride/); assert.match(native, /setResizeMode/); assert.doesNotMatch(adapter, /VLCPlayer|vlcEngineKey|media3EngineKey|hardStop/);
});

test("real-device defaults expose only controls supported by the native Media3 player", async () => {
  const [store, layout, settings, quickActions, packageJson, appJson] = await Promise.all([readFile(join(root, "src/store.tsx"), "utf8"), readFile(join(root, "src/core/guideLayoutDefault.ts"), "utf8"), readFile(join(root, "app/(tabs)/settings.tsx"), "utf8"), readFile(join(root, "src/components/TvQuickActionsOverlay.tsx"), "utf8"), readFile(join(root, "package.json"), "utf8"), readFile(join(root, "app.json"), "utf8")]);
  assert.match(store, /useState<SafePreviewMode>\("delayed"\)/); assert.match(store, /SAFE_PREVIEW_MODE_KEY, "delayed"/); assert.match(store, /useState<DeviceLayoutMode>\("tv"\)/); assert.match(layout, /return "cinematic"/); assert.match(settings, /Media3 live TV/); assert.doesNotMatch(settings, /VLC|Video decoder|Auto retry streams/); assert.doesNotMatch(quickActions, /Player engine|ENGINE_ORDER|usePlayerEnginePreference/); assert.doesNotMatch(packageJson, /react-native-vlc-media-player|expo-video|patch-package/); assert.doesNotMatch(appJson, /react-native-vlc-media-player|expo-video/);
});
