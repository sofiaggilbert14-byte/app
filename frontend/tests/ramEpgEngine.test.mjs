import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFile(join(root, path), "utf8");

test("RAM EPG engine keeps a SQLite fallback and heap guard", async () => {
  const engine = await read("android/app/src/main/java/com/charmiptv/app/EpgRamEngine.kt");
  const ramModule = await read("android/app/src/main/java/com/charmiptv/app/EpgRamModule.kt");
  const bridge = await read("src/nativeEpg.ts");
  const app = await read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt");
  assert.match(engine, /queryWindow\(startMs, endMs, null\)/);
  assert.match(engine, /heapPressureCritical/);
  assert.match(engine, /firstOverlap/);
  assert.match(ramModule, /ensureWarmForCurrentEpoch/);
  assert.match(bridge, /CharmEpgRam/);
  assert.match(app, /EpgRamPackage/);
});
