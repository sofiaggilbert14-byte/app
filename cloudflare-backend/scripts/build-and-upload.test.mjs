import assert from "node:assert/strict";
import test from "node:test";

import { buildGuideData, parseM3U, parseXMLTV } from "./build-and-upload.mjs";

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

test("builder matches EPG when playlist tvg-id has a source suffix", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="AETV.us (m3u4u)" tvg-name="A&E TV" group-title="TV",A&E TV
https://example.test/aetv.m3u8
`);
  const epg = parseXMLTV(`<tv>
<channel id="AETV.us"><display-name>A&E TV</display-name></channel>
<programme channel="AETV.us" start="20260723090000 +0000" stop="20260723100000 +0000">
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
<programme channel="ESPNEWS.us" start="20260723090000 +0000" stop="20260723100000 +0000">
  <title>SportsCenter</title>
</programme>
</tv>`);

  const guide = buildGuideData(channels, epg);

  assert.equal(guide.channelsWithGuide, 1);
  assert.equal(guide.guideChannels[0].p[0].t, "SportsCenter");
});
