import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDE_PREFETCH_PAGES_AHEAD,
  GUIDE_PREFETCH_PAGES_BEHIND,
} from "../src/core/guideRunwayPolicy.ts";
import {
  computeSlidingCacheWindow,
  expandRunwayKeepSet,
  getSlidingCachePages,
  pickKeepIdsAroundFocus,
  slidingWindowChannelIds,
  slidingWindowKeepSet,
} from "../src/core/guideSlidingCache.ts";

const channelIds = Array.from({ length: 200 }, (_, index) => `channel-${index}`);

test("sliding cache pages track the exact symmetric seven-page runway policy", () => {
  const pages = getSlidingCachePages("normal");
  assert.equal(pages.ahead, GUIDE_PREFETCH_PAGES_AHEAD);
  assert.equal(pages.behind, GUIDE_PREFETCH_PAGES_BEHIND);
  assert.equal(pages.hysteresis, 0);
  assert.equal(GUIDE_PREFETCH_PAGES_AHEAD, 7);
  assert.equal(GUIDE_PREFETCH_PAGES_BEHIND, 7);
});

test("sliding window remains symmetric while surfing down", () => {
  const window = computeSlidingCacheWindow({
    focusIndex: 40,
    channelCount: channelIds.length,
    pageSize: 10,
    direction: "down",
    profile: "normal",
  });
  assert.equal(window.behind, 7);
  assert.equal(window.ahead, 7);
  assert.equal(window.start, 0);
  assert.equal(window.end, 111);
  assert.equal(window.evictStart, window.start);
  assert.equal(window.evictEnd, window.end);

  const fetchIds = slidingWindowChannelIds(channelIds, window);
  assert.equal(fetchIds[0], "channel-0");
  assert.equal(fetchIds.at(-1), "channel-110");

  const keep = slidingWindowKeepSet(channelIds, window);
  assert.equal(keep.has("channel-20"), true);
  assert.equal(keep.has("channel-10"), true);
  assert.equal(keep.has("channel-0"), true);
});

test("expandRunwayKeepSet adds one page of hysteresis on each side", () => {
  const runway = channelIds.slice(40, 120);
  const keep = expandRunwayKeepSet(channelIds, runway, 10, 1);
  assert.equal(keep.has("channel-30"), true);
  assert.equal(keep.has("channel-40"), true);
  assert.equal(keep.has("channel-119"), true);
  assert.equal(keep.has("channel-129"), true);
  assert.equal(keep.has("channel-20"), false);
  assert.equal(keep.has("channel-130"), false);
});

test("pickKeepIdsAroundFocus keeps the focused neighborhood, not the list head", () => {
  const source = channelIds.slice(0, 80);
  const keep = pickKeepIdsAroundFocus(source, 8, "channel-40");
  assert.equal(keep.length, 8);
  assert.ok(keep.includes("channel-40"));
  assert.equal(keep.includes("channel-0"), false);
  assert.deepEqual(pickKeepIdsAroundFocus(source, 8, null).length, 8);
});

test("eviction band does not shrink while focus stays inside previous window", () => {
  const first = computeSlidingCacheWindow({
    focusIndex: 50,
    channelCount: channelIds.length,
    pageSize: 10,
    direction: "down",
  });
  const second = computeSlidingCacheWindow({
    focusIndex: 55,
    channelCount: channelIds.length,
    pageSize: 10,
    direction: "down",
    previousWindow: first,
  });
  assert.ok(second.evictStart <= first.evictStart);
  assert.ok(second.evictEnd >= first.evictEnd);
});
