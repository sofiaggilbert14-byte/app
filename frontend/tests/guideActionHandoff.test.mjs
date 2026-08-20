import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("Guide stays active until a preview action actually receives focus", async () => {
  const [guide, rail] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
  ]);
  const boundary = guide.match(/const onGuideUpBoundary = useCallback\([\s\S]*?\n  \}, \[\]\);/)?.[0] || "";
  assert.match(boundary, /focusGuidePreviewSurface\(\)/);
  assert.doesNotMatch(boundary, /setPreviewActionsFocused\(true\)/);
  assert.match(rail, /onActionsFocusChange\(true\)/);
  assert.match(guide, /active=\{isFocused && !activeProgram && !drawerOpen && !groupDrawerOpen && !previewActionsFocused\}/);
});
