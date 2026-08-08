import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFavoriteIds, toggleFavoriteId, MAX_FAVORITES } from "../src/utils/favoriteIds.ts";
import { sanitizeRecentIds, pushRecentId, MAX_RECENT } from "../src/utils/recentIds.ts";
import { sanitizeReminders, MAX_REMINDERS } from "../src/utils/reminderIds.ts";
import { remapStoredChannelIds } from "../src/utils/channelIdentityMigrate.ts";
import { resolveFavoritesBackup, serializeFavoritesBackup } from "../src/core/favoritesBackupCore.ts";

const channel = (id, tvgId, name, url = `https://stream.example/${id}`) => ({
  id, tvg_id: tvgId, name, logo: "", group: "", url, stream_type: "unknown", programs: [],
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

test("recent migration keeps bounded unique ID strings only", () => {
  assert.deepEqual(
    sanitizeRecentIds([{ id: "a", programs: [{ title: "fat" }] }, "b", "a", "https://stream", ""]),
    ["a", "b"],
  );
  assert.equal(sanitizeRecentIds(Array.from({ length: MAX_RECENT + 5 }, (_, i) => `id-${i}`)).length, MAX_RECENT);
});

test("recent push keeps newest first and capped", () => {
  const next = pushRecentId(["a", "b"], "c");
  assert.deepEqual(next, ["c", "a", "b"]);
  assert.deepEqual(pushRecentId(next, "a"), ["a", "c", "b"]);
  let ids = [];
  for (let i = 0; i < MAX_RECENT + 3; i += 1) ids = pushRecentId(ids, `id-${i}`);
  assert.equal(ids.length, MAX_RECENT);
  assert.equal(ids[0], `id-${MAX_RECENT + 2}`);
});

test("reminders drop expired rows and stay capped", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  const rows = sanitizeReminders([
    { key: "old", channelId: "a", start: "2026-08-08T08:00:00.000Z", stop: "2026-08-08T09:00:00.000Z" },
    { key: "live", channelId: "b", start: "2026-08-08T11:30:00.000Z", stop: "2026-08-08T12:30:00.000Z" },
    { key: "soon", channelId: "c", start: "2026-08-08T13:00:00.000Z", stop: "2026-08-08T14:00:00.000Z" },
  ], now);
  assert.deepEqual(rows.map((row) => row.key), ["live", "soon"]);
  const many = Array.from({ length: MAX_REMINDERS + 5 }, (_, i) => ({
    key: `k${i}`,
    channelId: `c${i}`,
    start: new Date(now + i * 60_000).toISOString(),
    stop: new Date(now + (i + 60) * 60_000).toISOString(),
  }));
  assert.equal(sanitizeReminders(many, now).length, MAX_REMINDERS);
});

test("stored channel ids remap through unique tvg-id without wiping orphans", () => {
  const channels = [channel("news.1~abc", "news.1", "News One"), channel("sports.1", "sports.1", "Sports")];
  const { ids, remapped } = remapStoredChannelIds(["news.1#2", "sports.1", "missing-orphan"], channels);
  assert.equal(remapped, 1);
  assert.deepEqual(ids, ["news.1~abc", "sports.1", "missing-orphan"]);
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
