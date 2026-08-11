import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("My Reminders page uses six-wide cards with live ETA and cancel", async () => {
  const source = await readFile(join(root, "app/(tabs)/reminders.tsx"), "utf8");
  assert.match(source, /My Reminders/);
  assert.match(source, /Return to Guide/);
  assert.match(source, /Cancel Reminder/);
  assert.match(source, /COLUMNS = 6/);
  assert.match(source, /ETA :/);
  assert.match(source, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/);
  assert.match(source, /backgroundColor: PAGE_BG/);
  assert.match(source, /removeReminder/);
});

test("reminders persist logo and description from guide selection", async () => {
  const store = await readFile(join(root, "src/store.tsx"), "utf8");
  assert.match(store, /channelLogo:/);
  assert.match(store, /programDesc:/);
});
