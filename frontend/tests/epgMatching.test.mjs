import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyLogoOnlyUpdates,
  applyXmltvMatchesToChannels,
  buildXmltvMatchIndexes,
  formatNativeEpgError,
  matchPlaylistChannelToXmltv,
  normalizeGuideKey,
  shouldDeleteLegacyEpgName,
} from "../src/core/epgMatching.ts";
import { inferMissingStopsFromNextProgram } from "../src/core/sourceParsing.ts";

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
  assert.equal(espn.ambiguous, false);

  const orphan = matchPlaylistChannelToXmltv(
    { id: "orphan", tvg_id: "", name: "Missing" },
    indexes,
    {},
  );
  assert.equal(orphan.sourceId, "");
  assert.equal(orphan.ambiguous, false);
});

test("rematching keeps the provider tvg-id after a previous resolved id", () => {
  const indexes = buildXmltvMatchIndexes({
    channelIds: ["provider.raw"],
    channelNames: { "provider.raw": "Provider Channel" },
    idsWithPrograms: ["provider.raw"],
  });
  const match = matchPlaylistChannelToXmltv(
    { id: "playlist-id", raw_tvg_id: "provider.raw", tvg_id: "stale.resolved", name: "Provider Channel" },
    indexes,
  );
  assert.equal(match.sourceId, "provider.raw");
});

test("ambiguous normalized names refuse to invent a sourceId", () => {
  const indexes = buildXmltvMatchIndexes({
    channelIds: ["cnn.us", "cnn.uk"],
    channelNames: { "cnn.us": "CNN", "cnn.uk": "CNN" },
    idsWithPrograms: ["cnn.us", "cnn.uk"],
  });
  const hit = matchPlaylistChannelToXmltv(
    { id: "p1", tvg_id: "", name: "CNN" },
    indexes,
    {},
  );
  assert.equal(hit.sourceId, "");
  assert.equal(hit.ambiguous, true);
});

test("preferTvgIdOnly never matches by display name", () => {
  const indexes = buildXmltvMatchIndexes({
    channelIds: ["espn.us"],
    channelNames: { "espn.us": "ESPN" },
    idsWithPrograms: ["espn.us"],
  });
  const byName = matchPlaylistChannelToXmltv(
    { id: "x", tvg_id: "", name: "ESPN" },
    indexes,
    {},
    { preferTvgIdOnly: true },
  );
  assert.equal(byName.sourceId, "");
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

test("logo-only updates skip full rematch when fingerprint matches", () => {
  const channels = [
    { id: "1", tvg_id: "espn.us", name: "ESPN", logo: "old.png", group: "Sports", url: "http://x", stream_type: "hls" },
  ];
  const indexes = buildXmltvMatchIndexes({
    channelIds: ["espn.us"],
    channelNames: { "espn.us": "ESPN" },
    idsWithPrograms: ["espn.us"],
  });
  const same = applyLogoOnlyUpdates(channels, { "espn.us": "new.png" }, indexes.fingerprint, indexes.fingerprint);
  assert.ok(same);
  assert.equal(same[0].logo, "new.png");
  assert.equal(same[0].tvg_id, "espn.us");

  const forced = applyLogoOnlyUpdates(channels, { "espn.us": "new.png" }, "stale", indexes.fingerprint);
  assert.equal(forced, null);
});

test("applyXmltvMatchesToChannels reports match quality", () => {
  const indexes = buildXmltvMatchIndexes({
    channelIds: ["a.1", "b.1", "c.1", "c.2"],
    channelNames: { "a.1": "Alpha", "b.1": "Beta", "c.1": "Dup", "c.2": "Dup" },
    idsWithPrograms: ["a.1", "c.1", "c.2"],
  });
  const { quality } = applyXmltvMatchesToChannels(
    [
      { id: "1", tvg_id: "a.1", name: "Alpha", logo: "", group: "", url: "u", stream_type: "hls" },
      { id: "2", tvg_id: "", name: "Dup", logo: "", group: "", url: "u", stream_type: "hls" },
      { id: "3", tvg_id: "", name: "Missing", logo: "", group: "", url: "u", stream_type: "hls" },
    ],
    indexes,
    {},
  );
  assert.equal(quality.matched, 1);
  assert.equal(quality.ambiguous, 1);
  assert.equal(quality.unmatched, 1);
});

test("inferMissingStopsFromNextProgram fills default stop from next start", () => {
  const programs = {
    news: [
      { start: "2026-08-07T14:00:00.000Z", stop: "2026-08-07T14:30:00.000Z", title: "A" },
      { start: "2026-08-07T15:00:00.000Z", stop: "2026-08-07T16:00:00.000Z", title: "B" },
    ],
  };
  // First row used default +30m while next starts at +60m → infer stop to next start.
  inferMissingStopsFromNextProgram(programs);
  assert.equal(programs.news[0].stop, "2026-08-07T15:00:00.000Z");
});

test("formatNativeEpgError maps engine/network failures to readable copy", () => {
  assert.match(
    formatNativeEpgError(new Error("Native EPG engine is unavailable in this Android build")),
    /TV guide engine unavailable/,
  );
  assert.match(formatNativeEpgError(new Error("EPG HTTP 503")), /Could not download/);
  assert.equal(
    formatNativeEpgError(new Error("unknown error (code 0 SQLITE_OK): Queries can be performed using rawQuery methods only")),
    "The saved TV guide could not be read. Your channels are unchanged; try Reload guide.",
  );
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
  assert.match(native, /applyLogoOnlyUpdates/);
  assert.match(native, /playlistIdentityFingerprint/);
  assert.match(native, /matchQuality/);
  assert.match(native, /guideEpoch/);
  assert.match(native, /playlistEpoch/);
  assert.match(native, /Array\.from\(\s*new Set\(/);
  assert.doesNotMatch(native, /parseXMLTV|inflateToTextChunks|from "fflate"|epgDb/);
  assert.match(native, /Native EPG engine is unavailable/);
  assert.match(native, /const EMPTY_PROGRAMS: Program\[\] = \[\]/);
  assert.doesNotMatch(native, /EMPTY_PROGRAMS\.(?:push|pop|shift|unshift|splice|sort|reverse)\(/);
  // Weak-stick memory: bounded programme cache + no full-playlist warm emit hitch.
  assert.match(native, /maxProgrammeWindowKeys = 1800/);
  assert.match(native, /setProgrammeWindowCacheLimit/);
  assert.match(native, /HUGE_PLAYLIST_MATCH_THRESHOLD = 400/);
  assert.match(native, /trimProgrammeWindowCache/);
  assert.match(native, /never emits\(\)/i);
});

test("web source path documents no TV JS fallback and uses shared matching", async () => {
  const web = await readFile(join(root, "src/source.ts"), "utf8");
  assert.match(web, /WEB \/ non-native source path/);
  assert.match(web, /do not add a JS XMLTV fallback on TV/i);
  assert.match(web, /applyXmltvMatchesToChannels/);
  assert.match(web, /buildXmltvMatchIndexes/);
  assert.match(web, /inferMissingStopsFromNextProgram/);
});

test("native EPG engine strengthens migrate, next-stop, recovery, rare vacuum", async () => {
  const [db, mod] = await Promise.all([
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt"), "utf8"),
    readFile(join(root, "android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"), "utf8"),
  ]);
  assert.match(db, /DATABASE_VERSION = 10/);
  assert.match(db, /epg_programmes_fts/);
  assert.match(db, /toEpochSeconds/);
  assert.match(db, /Additive only/);
  assert.match(db, /inferMissingStopsFromNextProgram/);
  assert.match(db, /ensureHealthy/);
  assert.match(db, /maybeIncrementalVacuum/);
  assert.match(db, /category TEXT/);
  assert.match(db, /idx_epg_staging_order/);
  assert.match(db, /playlist_epg_matches/);
  assert.match(db, /queryGuideWindow/);
  assert.match(db, /epg_stop_updates/);
  assert.doesNotMatch(db, /ArrayList<Pair<Long, Long>>/);
  assert.match(mod, /MAX_PROGRAMME_COUNT = 2_000_000L/);
  assert.match(mod, /MAX_COMPRESSED_EPG_BYTES/);
  assert.match(mod, /BoundedInputStream/);
  assert.doesNotMatch(db, /DROP TABLE IF EXISTS \$LIVE_TABLE[\s\S]*onUpgrade/);
  assert.match(mod, /MIN_VACUUM_DELETED_ROWS/);
  assert.match(mod, /guideEpoch/);
  assert.match(mod, /ensureHealthy/);
  assert.match(mod, /"category"/);
  assert.match(mod, /queryGuideWindow/);
});

test("edge-case XMLTV fixture covers missing stop + malformed start", async () => {
  const xml = await readFile(join(root, "tests/fixtures/epg-edge-cases.xml"), "utf8");
  assert.match(xml, /Missing stop/);
  assert.match(xml, /Malformed start/);
  assert.match(xml, /<category>/);
});
