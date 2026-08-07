import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildXmltvMatchIndexes,
  formatNativeEpgError,
  matchPlaylistChannelToXmltv,
  normalizeGuideKey,
  shouldDeleteLegacyEpgName,
} from "../src/core/epgMatching.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("normalizeGuideKey strips punctuation and case", () => {
  assert.equal(normalizeGuideKey("ESPN-HD"), "espnhd");
  assert.equal(normalizeGuideKey("  Foo.Bar "), "foobar");
});

test("playlist→XMLTV matching prefers programme-bearing ids then name", () => {
  const indexes = buildXmltvMatchIndexes({
    channelIds: ["espn.us", "news.1"],
    channelNames: { "espn.us": "ESPN", "news.1": "News" },
    idsWithPrograms: ["espn.us"],
  });
  const espn = matchPlaylistChannelToXmltv(
    { id: "x", tvg_id: "ESPN-US", name: "ESPN" },
    indexes,
    { "espn.us": "https://logo/espn.png" },
  );
  assert.equal(espn.sourceId, "espn.us");
  assert.equal(espn.logoId, "espn.us");

  const orphan = matchPlaylistChannelToXmltv(
    { id: "orphan", tvg_id: "", name: "Missing" },
    indexes,
    {},
  );
  assert.equal(orphan.sourceId, "");
});

test("empty idsWithPrograms never invents a programme sourceId", () => {
  const indexes = buildXmltvMatchIndexes({
    channelIds: ["espn.us"],
    channelNames: { "espn.us": "ESPN" },
    idsWithPrograms: [],
  });
  const byTvg = matchPlaylistChannelToXmltv(
    { id: "x", tvg_id: "bar", name: "ESPN" },
    indexes,
    { "espn.us": "https://logo/espn.png" },
  );
  assert.equal(byTvg.sourceId, "");
  // Logo may still resolve from channel metadata / name.
  assert.equal(byTvg.logoId, "espn.us");
});

test("formatNativeEpgError maps engine/network failures to readable copy", () => {
  assert.match(
    formatNativeEpgError(new Error("Native EPG engine is unavailable in this Android build")),
    /TV guide engine unavailable/,
  );
  assert.match(formatNativeEpgError(new Error("EPG HTTP 503")), /Could not download/);
});

test("legacy cleanup never targets live native v3 DB names", () => {
  assert.equal(shouldDeleteLegacyEpgName("charm_epg_v1.db"), true);
  assert.equal(shouldDeleteLegacyEpgName("guide_cache_v5_programs_0.json"), true);
  assert.equal(shouldDeleteLegacyEpgName("charm_epg_v3.db"), false);
  assert.equal(shouldDeleteLegacyEpgName("charm_native_channels_v2.json"), false);
});

test("Android source path stays native-only (no JS XMLTV inflate/parse)", async () => {
  const native = await readFile(join(root, "src/source.native.ts"), "utf8");
  assert.match(native, /refreshNativeEpg/);
  assert.match(native, /cleanupLegacyEpgArtifactsOnce/);
  assert.match(native, /formatNativeEpgError/);
  assert.doesNotMatch(native, /parseXMLTV|inflateToTextChunks|from "fflate"|epgDb/);
  assert.match(native, /Native EPG engine is unavailable/);
});

test("web source path documents no TV JS fallback and uses shared matching", async () => {
  const web = await readFile(join(root, "src/source.ts"), "utf8");
  assert.match(web, /WEB \/ non-native source path/);
  assert.match(web, /do not add a JS XMLTV fallback on TV/i);
  assert.match(web, /matchPlaylistChannelToXmltv/);
  assert.match(web, /buildXmltvMatchIndexes/);
});
