import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseM3U, parseXmltvTime } from "../src/core/sourceParsing.ts";
import { sanitizeFavoriteIds } from "../src/utils/favoriteIds.ts";

const channelCount = Number(process.env.CHARM_BENCH_CHANNELS || 20_000);
const lines = ["#EXTM3U"];
for (let i = 0; i < channelCount; i++) {
  lines.push(`#EXTINF:-1 tvg-id="channel.${i}" group-title="Group ${i % 20}",Channel ${i}`);
  lines.push(`https://stream.example/${i}${i % 2 ? ".m3u8" : ".ts"}?token=redacted`);
}
const playlist = lines.join("\n");

const memoryBefore = process.memoryUsage().heapUsed;
const parseStarted = performance.now();
const channels = parseM3U(playlist);
const parseMs = performance.now() - parseStarted;
const memoryAfter = process.memoryUsage().heapUsed;

const favoriteInput = Array.from({ length: 2_500 }, (_, index) => index % 2 ? `channel.${index}` : { id: `channel.${index}` });
const favoriteStarted = performance.now();
const favorites = sanitizeFavoriteIds(favoriteInput);
const favoriteMs = performance.now() - favoriteStarted;

const timeStarted = performance.now();
for (let i = 0; i < 100_000; i++) parseXmltvTime("20260807103000 -0400");
const xmltvTime100kMs = performance.now() - timeStarted;

if (channels.length !== channelCount) throw new Error(`Expected ${channelCount} channels, received ${channels.length}`);
if (favorites.length !== 1_000) throw new Error(`Expected capped 1000 favorites, received ${favorites.length}`);

const result = {
  schema: "charmiptv-phase1-baseline-v1",
  recordedAt: new Date().toISOString(),
  runtime: process.version,
  platform: `${process.platform}-${process.arch}`,
  inputs: { channelCount, playlistBytes: new TextEncoder().encode(playlist).byteLength, xmltvTimestampIterations: 100_000 },
  metrics: {
    playlistParseMs: Number(parseMs.toFixed(2)),
    playlistParseChannelsPerSecond: Math.round(channelCount / (parseMs / 1000)),
    playlistHeapDeltaBytes: Math.max(0, memoryAfter - memoryBefore),
    favoriteSanitizeMs: Number(favoriteMs.toFixed(2)),
    xmltvTimestamp100kMs: Number(xmltvTime100kMs.toFixed(2)),
  },
};

const output = process.env.CHARM_BENCHMARK_OUTPUT;
if (output) {
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));
