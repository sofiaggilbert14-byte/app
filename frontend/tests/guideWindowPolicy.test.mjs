import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GUIDE_WINDOW_HOURS,
  GUIDE_WINDOW_HOUR_OPTIONS,
  resolveGuideWindowHours,
} from "../src/core/guideWindowPolicy.ts";

test("guide window policy accepts only the five bounded forward options", () => {
  assert.deepEqual(GUIDE_WINDOW_HOUR_OPTIONS, [6, 8, 12, 14, 16]);
  assert.equal(DEFAULT_GUIDE_WINDOW_HOURS, 8);
  for (const hours of GUIDE_WINDOW_HOUR_OPTIONS) {
    assert.equal(resolveGuideWindowHours(hours), hours);
    assert.equal(resolveGuideWindowHours(String(hours)), hours);
  }
});

test("guide window policy safely migrates or rejects retired values", () => {
  assert.equal(resolveGuideWindowHours(24), 16);
  assert.equal(resolveGuideWindowHours(10), 8);
  assert.equal(resolveGuideWindowHours(undefined, 6), 6);
});
