import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (path) => readFile(join(root, path), "utf8");

test("source refresh settings cannot be overwritten by a stale startup read", async () => {
  const prefs = await text("src/core/sourceRefreshPreferences.ts");
  assert.match(prefs, /let mutationEpoch = 0/);
  assert.match(prefs, /const loadEpoch = mutationEpoch/);
  assert.match(prefs, /function commit\(next: SourceRefreshPreferences\): void \{[\s\S]*?mutationEpoch \+= 1/);
  assert.match(prefs, /if \(loaded \|\| loadEpoch !== mutationEpoch\) return cached/);
  for (const setter of [
    "setPlaylistRefreshInterval",
    "setEpgRefreshInterval",
    "setEpgPastDays",
    "setUpdateEpgOnAppStart",
    "setUpdateEpgOnPlaylistChange",
  ]) {
    const section = prefs.match(new RegExp(`export async function ${setter}\\([\\s\\S]*?\\n}`))?.[0] || "";
    assert.match(section, /commit\(/, `${setter} must advance mutation ownership before persistence`);
  }
});

test("EPG source settings and binding hydration cannot overwrite newer user edits", async () => {
  const prefs = await text("src/core/epgSourcePreferences.ts");
  assert.match(prefs, /let mutationEpoch = 0/);
  assert.match(prefs, /const loadEpoch = mutationEpoch/);
  assert.match(prefs, /function commitPrepared\(value: EpgSourcePreferences\) \{[\s\S]*?mutationEpoch \+= 1/);
  const staleGuards = prefs.match(/if \(loaded \|\| loadEpoch !== mutationEpoch\) return cached/g) || [];
  assert.ok(staleGuards.length >= 3, "storage, native migration/read, and fallback publication need stale guards");
  assert.match(prefs, /await importLegacyNativeEpgBindings\(legacy\.userOverrides\);[\s\S]*?await readNativeEpgBindings\(\)[\s\S]*?if \(loaded \|\| loadEpoch !== mutationEpoch\) return cached/);
  assert.match(prefs, /setValue\(next\);\s*commitPrepared\(next\);/);
  assert.match(prefs, /setNativeEpgBinding\(id, sourceId \|\| null\)/);
});
