import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDE_PREFETCH_PAGES_AHEAD,
  GUIDE_PREFETCH_PAGES_BEHIND,
  buildGuideRunwayIds,
  guideRunwayPagesForProfile,
} from "../src/core/guideRunwayPolicy.ts";

const rows = Array.from({ length: 120 }, (_, index) => ({ id: `channel-${index}` }));

test("guide runway keeps eight warm pages on both sides of focus", () => {
  assert.equal(GUIDE_PREFETCH_PAGES_AHEAD, 8);
  assert.equal(GUIDE_PREFETCH_PAGES_BEHIND, 8);

  // Both scan directions keep the same clamped runway around page start 60.
  const down = buildGuideRunwayIds(rows, 65, 10, 1);
  assert.equal(down[0], "channel-0");
  assert.equal(down.at(-1), "channel-119");
  assert.equal(down.length, 120);

  const up = buildGuideRunwayIds(rows, 65, 10, -1);
  assert.equal(up[0], "channel-0");
  assert.equal(up.at(-1), "channel-119");
  assert.deepEqual(up, down);
});

test("guide runway clamps cleanly at both playlist boundaries", () => {
  const top = buildGuideRunwayIds(rows, 0, 10, -1);
  const bottom = buildGuideRunwayIds(rows, rows.length - 1, 10, 1);
  assert.equal(top[0], "channel-0");
  assert.equal(top.at(-1), "channel-89");
  assert.equal(bottom[0], "channel-30");
  assert.equal(bottom.at(-1), "channel-119");
});

test("compatibility power profile shortens both sides equally", () => {
  assert.deepEqual(guideRunwayPagesForProfile("weak"), { ahead: 5, behind: 5 });
  const weakDown = buildGuideRunwayIds(rows, 65, 10, 1, "weak");
  // Page start 60 with five warm pages on each side clamps to channels 10..119.
  assert.equal(weakDown[0], "channel-10");
  assert.equal(weakDown.at(-1), "channel-119");
  assert.equal(weakDown.length, 110);
});
