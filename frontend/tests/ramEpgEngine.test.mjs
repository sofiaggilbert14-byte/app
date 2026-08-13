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

  assert.match(engine, /queryWindow\(startMs, endMs, null\)/);
  assert.match(engine, /runtime\.maxMemory\(\) \* 0\.52/);
  assert.match(engine, /PREBUILD_PRESSURE_FRACTION/);
  assert.match(engine, /FAILED_REBUILD_COOLDOWN_MS/);
  assert.match(engine, /heapPressureCritical/);
  assert.match(engine, /firstOverlap/);

  assert.match(ramModule, /ensureWarmForCurrentEpoch/);
  assert.match(ramModule, /currentGuideEpoch/);
  assert.match(ramModule, /promise\.resolve\(null\)/);
  assert.doesNotMatch(ramModule, /EPG_RAM_GUIDE_FAILED/);

  assert.match(bridge, /CharmEpgRam/);
  assert.match(bridge, /ramModule\.warm/);
  assert.match(bridge, /if \(ramWindow\) return windowToPrograms/);
  assert.match(memory, /ramEpgModule\?\.clearMemory/);
  assert.match(app, /add\(EpgRamPackage\(\)\)/);

  // Normal startup/source refresh remains cache-first for 24 hours.
  assert.match(source, /const TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /Date\.now\(\) - cached\.ts < TTL_MS/);
  assert.match(source, /return cached/);
});
