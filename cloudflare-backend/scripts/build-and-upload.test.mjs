import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuideData,
  parseM3U,
  parseM3UWithMeta,
  parseXMLTV,
  readGuideWindowHours,
} from "./build-and-upload.mjs";

test("builder uses a six-hour guide default and safe bounds", () => {
  assert.equal(readGuideWindowHours(undefined), 6);
  assert.equal(readGuideWindowHours("2"), 6);
  assert.equal(readGuideWindowHours("18"), 18);
  assert.equal(readGuideWindowHours("100"), 72);
});

function xmltvTime(offsetMs) {
  const date = new Date(Date.now() + offsetMs);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`;
}

test("builder keeps duplicate playlist channels unique", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="HALL.us" tvg-name="Hallmark" group-title="Movies",Hallmark
https://example.test/hallmark.m3u8
#EXTINF:-1 tvg-id="HALL.us" tvg-name="Hallmark West" group-title="Movies",Hallmark West
https://example.test/hallmark-west.m3u8
`);

  assert.equal(channels.length, 2);
  assert.equal(channels[0].id, "HALL.us");
  assert.equal(channels[1].id, "HALL.us-2");
  assert.equal(channels[0].tvgId, "HALL.us");
  assert.equal(channels[1].tvgId, "HALL.us");
});

test("builder detects embedded EPG URL from playlist header", () => {
  const playlist = parseM3UWithMeta(`#EXTM3U url-tvg="http://example.test/guide.xml.gz"
#EXTINF:-1 tvg-id="AETV.us" tvg-name="A&E TV" group-title="TV",A&E TV
https://example.test/aetv.m3u8
`);

  assert.deepEqual(playlist.epgUrls, ["http://example.test/guide.xml.gz"]);
  assert.equal(playlist.channels.length, 1);
  assert.equal(playlist.channels[0].tvgId, "AETV.us");
});

test("builder matches EPG when playlist tvg-id has a source suffix", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="AETV.us (m3u4u)" tvg-name="A&E TV" group-title="TV",A&E TV
https://example.test/aetv.m3u8
`);
  const epg = parseXMLTV(`<tv>
<channel id="AETV.us"><display-name>A&E TV</display-name></channel>
<programme channel="AETV.us" start="${xmltvTime(60 * 60 * 1000)}" stop="${xmltvTime(2 * 60 * 60 * 1000)}">
  <title>Storage Wars</title>
</programme>
</tv>`);

  const guide = buildGuideData(channels, epg);

  assert.equal(guide.channelsWithGuide, 1);
  assert.equal(guide.guideChannels[0].id, "AETV.us (m3u4u)");
  assert.equal(guide.guideChannels[0].p[0].t, "Storage Wars");
});

test("builder matches EPG by display name when ids differ", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="strange-id-123" tvg-name="ESPN News" group-title="Sports",ESPN News
https://example.test/espn-news.m3u8
`);
  const epg = parseXMLTV(`<tv>
<channel id="ESPNEWS.us"><display-name>ESPN News</display-name></channel>
<programme channel="ESPNEWS.us" start="${xmltvTime(60 * 60 * 1000)}" stop="${xmltvTime(2 * 60 * 60 * 1000)}">
  <title>SportsCenter</title>
</programme>
</tv>`);

  const guide = buildGuideData(channels, epg);

  assert.equal(guide.channelsWithGuide, 1);
  assert.equal(guide.guideChannels[0].p[0].t, "SportsCenter");
});

test("builder matches M3U4U channels with provider prefixes before a colon", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="random-m3u-id" tvg-name="VIP USA HD : Spike/Paramount" group-title="TV",VIP USA HD : Spike/Paramount
https://example.test/paramount.m3u8
`);
  const epg = parseXMLTV(`<tv>
<channel id="PARAMOUNT.us"><display-name>Spike/Paramount</display-name></channel>
<programme channel="PARAMOUNT.us" start="${xmltvTime(60 * 60 * 1000)}" stop="${xmltvTime(2 * 60 * 60 * 1000)}">
  <title>Two and a Half Men</title>
</programme>
</tv>`);

  const guide = buildGuideData(channels, epg);

  assert.equal(guide.channelsWithGuide, 1);
  assert.equal(guide.guideChannels[0].p[0].t, "Two and a Half Men");
});

test("builder recovers stale EPG by shifting it forward by whole days", () => {
  const epg = parseXMLTV(`<tv>
<channel id="AMC.us"><display-name>AMC</display-name></channel>
<programme channel="AMC.us" start="${xmltvTime(-48 * 60 * 60 * 1000)}" stop="${xmltvTime(-47 * 60 * 60 * 1000)}">
  <title>Recovered Old Show</title>
</programme>
</tv>`);

  assert.equal(epg.stats.rawProgrammes, 1);
  assert.equal(epg.stats.recoveredStaleProgrammes, 1);
  assert.ok(epg.stats.staleShiftDays >= 1);
  assert.equal(epg.byChannel["AMC.us"][0].t, "Recovered Old Show");
  assert.ok(epg.byChannel["AMC.us"][0].e > Date.now() - 6 * 60 * 60 * 1000);
});
