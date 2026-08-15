import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFile(join(root, path), "utf8");

test("RAM EPG engine remains bounded, restart-local, and SQLite-fallback safe", async () => {
  const [engine, ramModule, bridge, memory, source, app] = await Promise.all([
    read("android/app/src/main/java/com/charmiptv/app/EpgRamEngine.kt"),
    read("android/app/src/main/java/com/charmiptv/app/EpgRamModule.kt"),
    read("src/nativeEpg.ts"),
    read("src/utils/androidMemoryPressure.ts"),
    read("src/source.native.ts"),
    read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"),
  ]);

  assert.match(engine, /database\.forEachProgramInWindow\(startMs, endMs\)/);
  assert.match(engine, /fun replacePrograms\(programs: List<NativeEpgProgram>/);
  assert.match(engine, /generation\.incrementAndGet\(\)/);
  assert.match(engine, /runtime\.maxMemory\(\) \* 0\.52/);
  assert.match(engine, /PREBUILD_PRESSURE_FRACTION/);
  assert.match(engine, /FAILED_REBUILD_COOLDOWN_MS/);
  assert.match(engine, /heapPressureCritical/);
  assert.match(engine, /firstOverlap/);

  assert.match(ramModule, /isWarmForCurrentEpoch/);
  assert.doesNotMatch(ramModule, /scheduleWarmForCurrentEpoch/);
  assert.match(ramModule, /currentGuideEpoch/);
  assert.match(ramModule, /promise\.resolve\(null\)/);
  assert.doesNotMatch(ramModule, /EPG_RAM_GUIDE_FAILED/);

  assert.match(bridge, /CharmEpgRam/);
  assert.match(bridge, /ramModule\.warm/);
  assert.match(bridge, /nativeModule\.queryGuideWindow/);
  assert.doesNotMatch(bridge, /ramModule\.queryGuideWindow/);
  assert.match(memory, /ramEpgModule\?\.clearMemory/);
  assert.match(app, /add\(EpgRamPackage\(\)\)/);

  // Normal startup/source refresh remains cache-first for the user's bounded interval.
  assert.match(source, /DEFAULT_EPG_REFRESH_HOURS = 24/);
  assert.match(source, /Math\.min\(48, Math\.max\(1/);
  assert.match(source, /Date\.now\(\) - guideAgeBase < epgRefreshIntervalMs/);
  assert.match(source, /return cached/);
});

test("EPG refresh interval persists whole-hour choices and controls the source cache age", async () => {
  const [store, settings, nativeSource, webSource] = await Promise.all([
    read("src/store.tsx"),
    read("app/(tabs)/settings.tsx"),
    read("src/source.native.ts"),
    read("src/source.ts"),
  ]);
  assert.match(store, /EPG_REFRESH_INTERVAL_HOURS_KEY/);
  assert.match(store, /setEpgRefreshIntervalHours\(storedEpgRefreshHours\)/);
  assert.match(store, /refreshEpgIfDue\(\)/);
  assert.match(settings, /EPG refresh interval/);
  assert.match(settings, /settings-epg-refresh-dec/);
  assert.match(settings, /settings-epg-refresh-inc/);
  assert.match(nativeSource, /epgRefreshIntervalMs/);
  assert.match(webSource, /epgRefreshIntervalMs/);
});
