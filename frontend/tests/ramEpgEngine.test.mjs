import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFile(join(root, path), "utf8");

test("RAM EPG engine remains bounded, restart-local, and SQLite-fallback safe", async () => {
  const [engine, ramModule, bridge, memory, source, app, refreshPreferences] = await Promise.all([
    read("android/app/src/main/java/com/charmiptv/app/EpgRamEngine.kt"),
    read("android/app/src/main/java/com/charmiptv/app/EpgRamModule.kt"),
    read("src/nativeEpg.ts"),
    read("src/utils/androidMemoryPressure.ts"),
    read("src/source.native.ts"),
    read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"),
    read("src/core/sourceRefreshPreferences.ts"),
  ]);

  assert.match(engine, /queryWindow\(startMs, endMs, missing\)/);
  assert.match(engine, /runtime\.maxMemory\(\) \* 0\.18/);
  assert.match(engine, /CharmMemoryCoordinator\.budgets\(\)/);
  assert.match(engine, /LOW_RAM_CHANNEL_LIMIT/);
  assert.match(engine, /trimToBudget/);
  assert.match(engine, /firstOverlap/);

  assert.match(ramModule, /ensureWarmForCurrentEpoch/);
  assert.match(ramModule, /currentGuideEpoch/);
  assert.match(ramModule, /promise\.resolve\(null\)/);
  assert.doesNotMatch(ramModule, /EPG_RAM_GUIDE_FAILED/);

  assert.match(bridge, /CharmEpgRam/);
  assert.match(bridge, /ramModule\.getWindow/);
  assert.match(bridge, /ramModule\.queryGuideWindow/);
  assert.match(bridge, /if \(ramWindow\) return windowToPrograms/);
  assert.match(engine, /CharmTrimLevel\.BACKGROUND/);
  assert.match(memory, /background/);
  assert.doesNotMatch(memory, /ramEpgModule\?\.clearMemory/);
  assert.match(app, /add\(EpgRamPackage\(\)\)/);
  assert.match(ramModule, /engine\.dispose\(\)/);
  assert.match(ramModule, /queryPool\.shutdownNow\(\)/);

  // Normal startup remains cache-first; independent playlist/EPG clocks decide
  // whether background refresh is due without blocking the Guide.
  assert.match(source, /refreshSourcesIfDue/);
  assert.match(source, /isRefreshDue\(playlistLast/);
  assert.match(source, /isRefreshDue\(guideLast/);
  assert.match(refreshPreferences, /playlistHours: 24/);
  assert.match(refreshPreferences, /epgHours: 6/);
});
