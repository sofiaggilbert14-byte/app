import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFavoriteIds, toggleFavoriteId, MAX_FAVORITES } from "../src/utils/favoriteIds.ts";
import { resolveFavoritesBackup, serializeFavoritesBackup } from "../src/core/favoritesBackupCore.ts";

const channel = (id, tvgId, name, url = `https://stream.example/${id}`) => ({
  id, tvg_id: tvgId, name, url, logo: "", group: "", stream_type: "unknown", programs: [],
});

test("favorite migration keeps bounded unique ID strings only", () => {
  assert.deepEqual(sanitizeFavoriteIds([" one ", { id: "two" }, "one", "https://secret", {}, ""]), ["one", "two"]);
  assert.equal(sanitizeFavoriteIds(Array.from({ length: MAX_FAVORITES + 5 }, (_, i) => `id-${i}`)).length, MAX_FAVORITES);
});

test("favorite toggle is immutable and reversible", () => {
  const before = ["one"];
  const added = toggleFavoriteId(before, "two");
  assert.deepEqual(before, ["one"]);
  assert.deepEqual(added, ["one", "two"]);
  assert.deepEqual(toggleFavoriteId(added, "one"), ["two"]);
});

test("backup never serializes stream URLs and restores by exact identity", () => {
  const channels = [channel("one", "tvg.one", "One")];
  const raw = serializeFavoritesBackup(["one"], channels, new Date("2026-08-07T00:00:00Z"));
  assert.equal(raw.includes("stream.example"), false);
  const restored = resolveFavoritesBackup(raw, channels);
  assert.deepEqual([...restored], ["one"]);
  assert.equal(restored.unavailable.length, 0);
});

test("backup restore reports ambiguous and unplayable matches", () => {
  const raw = JSON.stringify({
    format: "charmiptv-favorites", version: 1, exportedAt: "2026-08-07T00:00:00Z",
    favorites: [
      { id: "old-a", tvgId: "shared", name: "Duplicate" },
      { id: "old-b", tvgId: "dead", name: "Dead" },
    ],
  });
  const restored = resolveFavoritesBackup(raw, [
    channel("a", "shared", "Duplicate"), channel("b", "shared", "Duplicate"), channel("dead", "dead", "Dead", ""),
  ]);
  assert.deepEqual([...restored], []);
  assert.deepEqual(restored.unavailable.map((item) => item.reason), ["ambiguous-name", "no-playable-stream"]);
});
