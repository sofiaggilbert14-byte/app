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
  assert.match(source, /reminders-open-drawer/);
  assert.match(source, /openDrawer\(\{ focusTop: true \}\)/);
  assert.match(source, /Cancel Reminder/);
  assert.match(source, /COLUMNS = 6/);
  assert.match(source, /ETA :/);
  assert.match(source, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/);
  // Match Guide / Live TV canvas — no separate bright page panel or permanent rail.
  assert.match(source, /backgroundColor: tvColors\.canvas/);
  assert.doesNotMatch(source, /PAGE_BG|#2B0B4A/);
  assert.match(source, /removeReminder/);
  assert.match(source, /active="\/reminders"/);
});

test("drawer lists My Reminders directly under Favorites and routes to it", async () => {
  const shell = await readFile(join(root, "src/components/PurpleTvShell.tsx"), "utf8");
  assert.match(
    shell,
    /route: "\/favorites", label: "Favorites"[\s\S]*?route: "\/reminders", label: "My Reminders"/,
  );
  assert.match(shell, /onPress=\{\(\) => navigate\(item\.route\)\}/);
  assert.match(shell, /testID=\{`purple-nav-\$\{item\.label\.toLowerCase\(\)\.replace/);
});

test("reminders persist logo and description from guide selection", async () => {
  const store = await readFile(join(root, "src/store.tsx"), "utf8");
  assert.match(store, /channelLogo:/);
  assert.match(store, /programDesc:/);
});
