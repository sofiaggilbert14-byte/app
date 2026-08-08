import test from "node:test";
import assert from "node:assert/strict";
import {
  alternateEngine, detectStreamKind, parsePipeHeaders, preferredEngine,
} from "../src/core/streamPolicy.ts";
import {
  DECODER_RESUME_SETTLE_MS, MODAL_FOCUS_RETRY_DELAYS_MS,
  isRapidDirectionalScan, routeAcceptsRapidScanKey,
} from "../src/core/guideRegressionPolicy.ts";

test("stream classification selects the expected first engine and fallback", () => {
  assert.equal(detectStreamKind("https://x/live.m3u8?token=1"), "hls");
  assert.equal(detectStreamKind("rtsp://x/live"), "rtsp");
  assert.equal(preferredEngine("hls"), "media3");
  assert.equal(preferredEngine("transport"), "vlc");
  assert.equal(alternateEngine("media3", false), null);
  assert.equal(alternateEngine("vlc", false), "media3");
});

test("pipe headers decode valid values and never throw on malformed percent encoding", () => {
  const parsed = parsePipeHeaders("https://x/live|Referer=https%3A%2F%2Fexample.com&X-Bad=%E0%A4%A");
  assert.equal(parsed.uri, "https://x/live");
  assert.equal(parsed.headers.Referer, "https://example.com");
  assert.equal(parsed.headers["X-Bad"], "%E0%A4%A");
});

test("rapid scan policy is route-specific and bounded", () => {
  assert.equal(routeAcceptsRapidScanKey("/guide", "DOWN"), true);
  assert.equal(routeAcceptsRapidScanKey("/player", "DOWN"), false);
  assert.equal(routeAcceptsRapidScanKey("/player", "RIGHT"), true);
  assert.equal(isRapidDirectionalScan(1_000, 1_200), true);
  assert.equal(isRapidDirectionalScan(1_000, 1_221), false);
  assert.equal(DECODER_RESUME_SETTLE_MS, 480);
  assert.deepEqual([...MODAL_FOCUS_RETRY_DELAYS_MS], [0, 40, 120, 280]);
});
