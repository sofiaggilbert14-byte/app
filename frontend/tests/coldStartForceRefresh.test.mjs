import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const prefs = fs.readFileSync(new URL("../src/core/sourceRefreshPreferences.ts", import.meta.url), "utf8");
const scheduler = fs.readFileSync(new URL("../src/components/SourceRefreshScheduler.tsx", import.meta.url), "utf8");

test("cold-start forced refresh is opt-in", () => {
  assert.match(
    prefs,
    /updateEpgOnAppStart:\s*false/,
    "cold-start refresh must default off",
  );
  assert.match(
    prefs,
    /updateEpgOnAppStart:\s*updateEpgOnAppStart\s*===\s*true/,
    "only an explicit persisted true may enable cold-start force refresh",
  );
  assert.match(
    scheduler,
    /if \(!prefs\.updateEpgOnAppStart\) return;/,
    "scheduler must leave the cache-first startup path alone unless user opted in",
  );
  assert.match(
    scheduler,
    /if \(isInitialCheck\) \{\s*await refreshSource\(true\);/s,
    "the opt-in startup action must be a real forced source refresh",
  );
});
