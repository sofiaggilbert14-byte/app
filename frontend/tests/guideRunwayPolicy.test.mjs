import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDE_PREFETCH_PAGES_AHEAD,
  GUIDE_PREFETCH_PAGES_BEHIND,
  buildGuideRunwayIds,
} from "../src/core/guideRunwayPolicy.ts";

const rows = Array.from({ length: 120 }, (_, index) => ({ id: `channel-${index}` }));

test("guide runway keeps five pages ahead and two behind in the scan direction", () => {
  assert.equal(GUIDE_PREFETCH_PAGES_AHEAD, 5);
  assert.equal(GUIDE_PREFETCH_PAGES_BEHIND, 2);

  const down = buildGuideRunwayIds(rows, 65, 10, 1);
  assert.equal(down[0], "channel-40");
  assert.equal(down.at(-1), "channel-119");
  assert.equal(down.length, 80);

  const up = buildGuideRunwayIds(rows, 65, 10, -1);
  assert.equal(up[0], "channel-10");
  assert.equal(up.at(-1), "channel-89");
  assert.equal(up.length, 80);
});

test("guide runway clamps cleanly at both playlist boundaries", () => {
  const top = buildGuideRunwayIds(rows, 0, 10, -1);
  const bottom = buildGuideRunwayIds(rows, rows.length - 1, 10, 1);
  assert.equal(top[0], "channel-0");
  assert.equal(top.at(-1), "channel-29");
  assert.equal(bottom[0], "channel-90");
  assert.equal(bottom.at(-1), "channel-119");
});
