import assert from "node:assert/strict";
import test from "node:test";

import {
  clampGuideTimeAnchor,
  moveGuideLogicalCursor,
  resolveGuideProgramAtTime,
} from "../src/core/guideLogicalFocus.ts";

const start = Date.parse("2026-08-12T12:00:00Z");
const end = Date.parse("2026-08-12T18:00:00Z");
const programs = [
  { title: "A", start: new Date(start).toISOString(), stop: new Date(start + 60 * 60_000).toISOString() },
  { title: "B", start: new Date(start + 60 * 60_000).toISOString(), stop: new Date(start + 120 * 60_000).toISOString() },
  { title: "C", start: new Date(start + 120 * 60_000).toISOString(), stop: new Date(start + 180 * 60_000).toISOString() },
];

test("logical vertical focus preserves the exact time column", () => {
  const cursor = { rowIndex: 12, region: "program", timeAnchorMs: start + 95 * 60_000 };
  const up = moveGuideLogicalCursor({ cursor, key: "UP", lastRowIndex: 50, programs, windowStartMs: start, windowEndMs: end });
  const down = moveGuideLogicalCursor({ cursor: up.cursor, key: "DOWN", lastRowIndex: 50, programs, windowStartMs: start, windowEndMs: end });
  assert.equal(up.cursor.rowIndex, 11);
  assert.equal(up.cursor.timeAnchorMs, cursor.timeAnchorMs);
  assert.deepEqual(down.cursor, cursor);
});

test("logical direction reversals do not queue or drift horizontally", () => {
  let cursor = { rowIndex: 25, region: "program", timeAnchorMs: start + 95 * 60_000 };
  for (let i = 0; i < 500; i += 1) {
    cursor = moveGuideLogicalCursor({ cursor, key: "UP", lastRowIndex: 100, programs, windowStartMs: start, windowEndMs: end }).cursor;
    cursor = moveGuideLogicalCursor({ cursor, key: "DOWN", lastRowIndex: 100, programs, windowStartMs: start, windowEndMs: end }).cursor;
  }
  assert.equal(cursor.rowIndex, 25);
  assert.equal(cursor.timeAnchorMs, start + 95 * 60_000);
});

test("horizontal movement selects adjacent programmes and returns to the channel rail", () => {
  let cursor = { rowIndex: 2, region: "channel", timeAnchorMs: start + 15 * 60_000 };
  cursor = moveGuideLogicalCursor({ cursor, key: "RIGHT", lastRowIndex: 4, programs, windowStartMs: start, windowEndMs: end }).cursor;
  assert.equal(cursor.region, "program");
  assert.equal(resolveGuideProgramAtTime(programs, cursor.timeAnchorMs)?.title, "A");
  cursor = moveGuideLogicalCursor({ cursor, key: "RIGHT", lastRowIndex: 4, programs, windowStartMs: start, windowEndMs: end }).cursor;
  assert.equal(resolveGuideProgramAtTime(programs, cursor.timeAnchorMs)?.title, "B");
  cursor = moveGuideLogicalCursor({ cursor, key: "LEFT", lastRowIndex: 4, programs, windowStartMs: start, windowEndMs: end }).cursor;
  cursor = moveGuideLogicalCursor({ cursor, key: "LEFT", lastRowIndex: 4, programs, windowStartMs: start, windowEndMs: end }).cursor;
  assert.equal(cursor.region, "channel");
});

test("logical boundaries clamp rows and time without wraparound", () => {
  const top = moveGuideLogicalCursor({ cursor: { rowIndex: 0, region: "program", timeAnchorMs: start }, key: "UP", lastRowIndex: 9, programs, windowStartMs: start, windowEndMs: end });
  const bottom = moveGuideLogicalCursor({ cursor: { rowIndex: 9, region: "program", timeAnchorMs: end }, key: "DOWN", lastRowIndex: 9, programs, windowStartMs: start, windowEndMs: end });
  assert.equal(top.boundary, "top");
  assert.equal(bottom.boundary, "bottom");
  assert.equal(clampGuideTimeAnchor(end + 1000, start, end), end - 1);
});
