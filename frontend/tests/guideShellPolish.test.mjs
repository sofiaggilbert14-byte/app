import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGroupCounts,
  channelMatchesSmart,
  pinGroup,
  unpinGroup,
  buildVisibleGroups,
} from "../src/core/guideGroups.ts";
import {
  requestGuideJump,
  consumeGuideJump,
  peekGuideJump,
} from "../src/core/guideSearchJump.ts";
import {
  noteStreamFailure,
  failedStreamCount,
  listFailedChannelIds,
  clearStreamFailure,
} from "../src/core/streamFailureRegistry.ts";
import {
  setParentalPinMemory,
  verifyParentalPin,
} from "../src/core/parentalPinCore.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("guideGroups buildGroupCounts / smart HD / pin", () => {
  const channels = [
    { id: "1", name: "ESPN HD", group: "Sports", url: "http://x" },
    { id: "2", name: "Cartoon", group: "Kids", url: "http://x" },
    { id: "3", name: "News 4K", group: "News", url: "http://x" },
    { id: "4", name: "Hidden HD", group: "Sports", url: "http://x" },
  ];
  const counts = buildGroupCounts(channels, {
    favoriteSet: new Set(["2"]),
    recentIds: new Set(["1"]),
    hasEpgMatch: (channel) => channel.id !== "3",
    isFailed: (id) => id === "1",
    hiddenIds: new Set(["4"]),
  });
  assert.equal(counts.All, 3);
  assert.equal(counts.Favorites, 1);
  assert.equal(counts["Recently Watched"], 1);
  assert.equal(counts["HD Only"], 2); // ESPN HD + News 4K (hidden excluded)
  assert.equal(counts["Failed Streams"], 1);
  assert.equal(counts["Unmatched EPG"], 1);
  // Curated + raw playlist group share the Sports key (counted once per matching pass).
  assert.ok(counts.Sports >= 1);
  assert.ok(channelMatchesSmart(channels[0], "HD Only", {
    hasEpgMatch: () => true,
    isFailed: () => false,
  }));

  let pinned = pinGroup(["Favorites"], "Sports");
  pinned = pinGroup(pinned, "Sports");
  assert.deepEqual(pinned, ["Favorites", "Sports"]);
  assert.deepEqual(unpinGroup(pinned, "Favorites"), ["Sports"]);

  const visible = buildVisibleGroups({
    counts,
    pinned: ["Sports"],
    playlistGroups: ["Local"],
    maxPlaylistTabs: 4,
  });
  assert.ok(visible.tabs.includes("Sports"));
  assert.ok(visible.tabs.includes("All"));
  assert.ok(visible.tabs.includes("HD Only"));
});

test("guideSearchJump request/consume", () => {
  while (consumeGuideJump()) {
    /* drain */
  }
  assert.equal(peekGuideJump(), null);
  requestGuideJump({ channelId: "  ", group: "Sports" });
  assert.equal(peekGuideJump(), null);
  requestGuideJump({
    channelId: "ch-9",
    group: "Sports",
    programStart: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(peekGuideJump(), {
    channelId: "ch-9",
    group: "Sports",
    programStart: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(consumeGuideJump(), {
    channelId: "ch-9",
    group: "Sports",
    programStart: "2026-01-01T00:00:00Z",
  });
  assert.equal(consumeGuideJump(), null);
});

test("streamFailureRegistry stays bounded", () => {
  for (const id of listFailedChannelIds()) clearStreamFailure(id);
  noteStreamFailure("a");
  noteStreamFailure("b");
  assert.equal(failedStreamCount(), 2);
  assert.deepEqual(listFailedChannelIds().slice(0, 2), ["b", "a"]);
  for (let i = 0; i < 120; i += 1) noteStreamFailure(`f${i}`);
  assert.ok(failedStreamCount() <= 80);
  assert.equal(failedStreamCount(), 80);
});

test("parental pin normalize via verify after set", async () => {
  // Async-shaped set (storage-backed wrapper syncs this memory in parentalPin.ts).
  const set = async (pin) => setParentalPinMemory(pin);
  await set(null);
  assert.equal(verifyParentalPin("1234"), false);
  await set("12ab34");
  assert.equal(verifyParentalPin("1234"), true);
  assert.equal(verifyParentalPin("0000"), false);
  await set("12");
  assert.equal(verifyParentalPin("12"), false);
  await set(null);
  assert.equal(verifyParentalPin("1234"), false);
});

test("drawer shell has purple-icon-rail", async () => {
  const shell = await source("src/components/PurpleTvShell.tsx");
  assert.match(shell, /purple-icon-rail/);
  assert.match(shell, /focusPurpleIconRail/);
});

test("guide.tsx references GuidePreviewRail, focusPurpleIconRail, buildVisibleGroups", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /GuidePreviewRail/);
  assert.match(guide, /focusPurpleIconRail/);
  assert.match(guide, /buildVisibleGroups/);
});
