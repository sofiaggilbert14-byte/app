import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFile(join(root, path), "utf8");

test("local-file RAM EPG is full-download/full-parse, bounded, and SQLite-fallback safe", async () => {
  const [engine, ramModule, nativeModule, database, handoff, bridge, memory, source, app] = await Promise.all([
    read("android/app/src/main/java/com/charmiptv/app/EpgRamEngine.kt"),
    read("android/app/src/main/java/com/charmiptv/app/EpgRamModule.kt"),
    read("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    read("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt"),
    read("android/app/src/main/java/com/charmiptv/app/SharedParsedEpgSnapshot.kt"),
    read("src/nativeEpg.ts"),
    read("src/utils/androidMemoryPressure.ts"),
    read("src/source.native.ts"),
    read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"),
  ]);

  // Download must finish to a local file before XML parsing starts.
  assert.match(nativeModule, /downloaded = downloadEpg\(/);
  assert.match(nativeModule, /parseCompleteLocalFile\(downloaded\.file/);
  assert.ok(nativeModule.indexOf("downloaded = downloadEpg(") < nativeModule.indexOf("parseCompleteLocalFile(downloaded.file"));
  assert.match(nativeModule, /fileOutput\.fd\.sync\(\)/);
  assert.match(nativeModule, /openDownloadedFile\(file\)/);
  assert.match(nativeModule, /GZIPInputStream/);
  assert.match(nativeModule, /download-complete-then-full-local-parse/);

  // Parsing is one complete collection, not the old 1,000-row/yield pipeline.
  assert.match(nativeModule, /parseCompleteLocalFile/);
  assert.match(nativeModule, /ArrayList<NativeEpgProgram>/);
  assert.match(nativeModule, /normalizeStopsAndRetain/);
  assert.doesNotMatch(nativeModule, /streamProgramBatches/);
  assert.doesNotMatch(nativeModule, /BATCH_SIZE\s*=\s*1000/);
  assert.doesNotMatch(nativeModule, /yield\(ArrayList\(batch\)\)/);
  assert.match(nativeModule, /SharedParsedEpgSnapshot\.publish/);
  assert.match(handoff, /takeIfCovers/);

  // SQLite remains durable/atomic even though parsing is now full-file in RAM.
  assert.match(database, /STAGING_TABLE/);
  assert.match(database, /Refusing to replace live EPG with an empty feed/);
  assert.match(database, /INSERT INTO \$LIVE_TABLE/);
  assert.match(database, /PRAGMA journal_mode=WAL/);

  // Fresh refreshes can hand the parsed objects straight to RAM. Restarts use a
  // cursor scan instead of allocating another giant temporary List.
  assert.match(engine, /SharedParsedEpgSnapshot\.takeIfCovers/);
  assert.match(engine, /forEachProgramInWindow/);
  assert.doesNotMatch(engine, /queryWindow\(startMs, endMs, null\)/);
  assert.match(engine, /runtime\.maxMemory\(\) \* 0\.52/);
  assert.match(engine, /PREBUILD_PRESSURE_FRACTION/);
  assert.match(engine, /FAILED_REBUILD_COOLDOWN_MS/);
  assert.match(engine, /heapPressureCritical/);
  assert.match(engine, /firstOverlap/);
  assert.match(engine, /playlistToXmltv = current\.playlistToXmltv/);
  assert.match(engine, /readPlaylistEpgMatches/);

  // A cold RAM query never blocks the Guide on a full warm: queue the warm and
  // return null immediately so the existing SQLite runway can answer.
  assert.match(ramModule, /scheduleWarmForCurrentEpoch/);
  assert.match(ramModule, /currentGuideEpoch/);
  assert.match(ramModule, /promise\.resolve\(null\)/);
  assert.match(ramModule, /sqliteFallbackCount/);
  assert.doesNotMatch(ramModule, /EPG_RAM_GUIDE_FAILED/);

  assert.match(bridge, /CharmEpgRam/);
  assert.match(bridge, /ramModule\.warm/);
  assert.match(bridge, /if \(ramWindow\) return windowToPrograms/);
  assert.match(memory, /ramEpgModule\?\.clearMemory/);
  assert.match(memory, /One global native clear per Android event/);
  assert.match(app, /add\(EpgRamPackage\(\)\)/);

  // Normal startup/source refresh remains cache-first for the user's bounded interval.
  assert.match(source, /DEFAULT_EPG_REFRESH_HOURS = 24/);
  assert.match(source, /Math\.min\(48, Math\.max\(1/);
  assert.match(source, /Date\.now\(\) - guideAgeBase < epgRefreshIntervalMs/);
  assert.match(source, /return cached/);
});

test("drawer globally suspends playback and Guide native ownership", async () => {
  const [gate, shell, stream, rootLayout, remote, guide, mainActivity] = await Promise.all([
    read("src/core/drawerActivityGate.ts"),
    read("src/components/PurpleTvShell.tsx"),
    read("src/components/StreamPlayer.tsx"),
    read("app/_layout.tsx"),
    read("src/utils/tvRemote.ts"),
    read("app/(tabs)/guide.tsx"),
    read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);

  assert.match(gate, /setDrawerActivitySuspended/);
  assert.match(gate, /generation \+= 1/);
  assert.match(shell, /setDrawerActivitySuspended\(drawerOpen\)/);
  assert.match(stream, /useDrawerActivityGate/);
  assert.match(stream, /playbackFocused = isFocused && appActive && !drawerSuspended/);
  assert.match(stream, /drawer-\$\{drawerGeneration\}/);

  // The Guide route can express intent, but the root overlay gate has final say
  // and only the arbitration helper writes the native active flag.
  assert.match(rootLayout, /setGuideNavigationSuppressed/);
  assert.match(rootLayout, /drawerOpen/);
  assert.match(rootLayout, /activeProgram/);
  assert.match(remote, /guideRouteWantsNavigation/);
  assert.match(remote, /guideNavigationSuppressed/);
  assert.match(remote, /applyGuideNavigationOwnership/);
  assert.match(guide, /active=\{isFocused && !activeProgram && !drawerOpen\}/);

  // Held vertical focus is still geometry-validated after drawer/focus changes.
  assert.match(mainActivity, /hasSafeGuideVerticalTarget/);
  assert.match(mainActivity, /focusSearch\(direction\)/);
});
