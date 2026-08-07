import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseM3U, parseXmltvTime, resolveXmltvStop } from "../src/core/sourceParsing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(join(here, "fixtures", name), "utf8");

test("M3U parser preserves metadata, classifies streams, and disambiguates duplicate IDs", async () => {
  const channels = parseM3U(await fixture("playlist-valid.m3u"), (url) => url.replace(/^http:/, "https:"));
  assert.equal(channels.length, 3);
  assert.deepEqual(channels.map((channel) => channel.id), ["news.1", "sports.1", "news.1#2"]);
  assert.equal(channels[0].logo, "https://img.example/news.png");
  assert.equal(channels[0].stream_type, "hls");
  assert.equal(channels[1].stream_type, "ts");
});

test("M3U parser skips records without a playable URL and survives a BOM", async () => {
  const channels = parseM3U(await fixture("playlist-malformed.m3u"));
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, "Playable After Bad Record");
});

test("XMLTV timestamps respect offsets and reject malformed values", async () => {
  const xml = await fixture("epg-edge-cases.xml");
  const times = [...xml.matchAll(/(?:start|stop)="([^"]+)"/g)].map((match) => parseXmltvTime(match[1]));
  assert.equal(times[0], "2026-08-07T14:00:00.000Z");
  assert.equal(times[1], "2026-08-07T14:30:00.000Z");
  assert.equal(times.at(-2), null);
});

test("XMLTV stop fallback is bounded and deterministic", () => {
  const start = "2026-08-07T14:30:00.000Z";
  assert.equal(resolveXmltvStop(start, ""), "2026-08-07T15:00:00.000Z");
  assert.equal(resolveXmltvStop(start, "20260808160000 -0400"), "2026-08-07T15:00:00.000Z");
  assert.equal(resolveXmltvStop(start, "20260807110000 -0400"), "2026-08-07T15:00:00.000Z");
});
