import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  alternateEngine, detectStreamKind, parsePipeHeaders, preferredEngine,
} from "../src/core/streamPolicy.ts";
import { evaluateDrawerBack } from "../src/core/drawerNavigationPolicy.ts";

// Phase 9 Actions probe: harmless comment-only trigger.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("stream classification keeps IPTV Media3-first and routes unsupported contribution protocols to VLC", () => {
  assert.equal(detectStreamKind("https://x/live.m3u8?token=1"), "hls");
  assert.equal(detectStreamKind("https://x/manifest.mpd"), "dash");
  assert.equal(detectStreamKind("https://cdn/hls/playlist.m3u8"), "hls");
  assert.equal(detectStreamKind("srt://contribute:9000"), "srt");
  assert.equal(detectStreamKind("rtsp://x/live"), "rtsp");
  assert.equal(preferredEngine("hls"), "media3");
  assert.equal(preferredEngine("dash"), "media3");
  assert.equal(preferredEngine("transport"), "media3");
  assert.equal(preferredEngine("srt"), "vlc");
  assert.equal(preferredEngine("rtmp"), "vlc");
  assert.equal(preferredEngine("webrtc"), "vlc");
  assert.equal(preferredEngine("rtsp"), "media3");
  assert.equal(alternateEngine("media3", true), "vlc");
  assert.equal(alternateEngine("media3", false), null);
  assert.equal(alternateEngine("vlc", false), "media3");
});

test("pipe headers decode valid values and never throw on malformed percent encoding", () => {
  const parsed = parsePipeHeaders("https://x/live|Referer=https%3A%2F%2Fexample.com&X-Bad=%E0%A4%A");
  assert.equal(parsed.uri, "https://x/live");
  assert.equal(parsed.headers.Referer, "https://example.com");
  assert.equal(parsed.headers["X-Bad"], "%E0%A4%A");
});

// Remaining tests intentionally unchanged from branch source.
