import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  alternateEngine, detectStreamKind, parsePipeHeaders, preferredEngine,
} from "../src/core/streamPolicy.ts";

// Phase 9 Actions probe: harmless comment-only trigger.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("stream classification selects Media3 first with VLC fallback", () => {
  assert.equal(detectStreamKind("https://x/live.m3u8?token=1"), "hls");
  assert.equal(detectStreamKind("https://x/manifest.mpd"), "dash");
  assert.equal(detectStreamKind("https://cdn/hls/playlist.m3u8"), "hls");
  assert.equal(detectStreamKind("srt://contribute:9000"), "srt");
  assert.equal(detectStreamKind("rtsp://x/live"), "rtsp");
  assert.equal(preferredEngine("hls"), "media3");
  assert.equal(preferredEngine("dash"), "media3");
  assert.equal(preferredEngine("transport"), "media3");
  assert.equal(preferredEngine("srt"), "media3");
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

test("drawer edge is a typed remote owner and stale blur cleanup cannot clobber main drawer", async () => {
  const [remote, button, activity] = await Promise.all([
    source("src/utils/tvRemote.ts"),
    source("src/components/PurpleDrawerButton.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);
  assert.match(remote, /\| "drawer_edge"/);
  assert.match(remote, /let remoteContextOwner: RemoteContext = "default"/);
  assert.match(remote, /export function resetRemoteContextIfOwned/);
  assert.match(remote, /if \(remoteContextOwner !== expected\) return/);
  assert.match(button, /setRemoteContext\("drawer_edge"\)/);
  assert.match(button, /resetRemoteContextIfOwned\("drawer_edge"\)/);
  assert.doesNotMatch(button, /return \(\) => \{[\s\S]{0,120}setRemoteContext\("default"\)/);
  assert.match(activity, /context == "drawer_edge" && boundaryKey == "LEFT"/);
});

test("Guide action strip walks all six actions before returning to the native Guide", async () => {
  const rail = await source("src/components/GuidePreviewRail.tsx");
  const actionStripBeforeHide = rail.slice(rail.indexOf("ref={playFocus.setRef}"), rail.indexOf("ref={hideFocus.setRef}"));
  assert.match(rail, /testID="guide-preview-play"/);
  assert.match(rail, /testID="guide-preview-favorite"/);
  assert.match(rail, /testID="guide-preview-remind"/);
  assert.match(rail, /testID="guide-preview-drawer"/);
  assert.match(rail, /testID="guide-preview-mute"/);
  assert.match(rail, /testID="guide-preview-hide"/);
  assert.doesNotMatch(actionStripBeforeHide, /nextFocusDown=\{guideFocusTag \|\| undefined\}/);
  assert.match(rail.slice(rail.lastIndexOf("ref={hideFocus.setRef}")), /nextFocusDown=\{guideFocusTag \|\| undefined\}/);
});

test("main drawer cleanup cannot steal the Guide Groups drawer owner", async () => {
  const [shell, groups] = await Promise.all([
    source("src/components/PurpleTvShell.tsx"),
    source("src/components/PurpleGuideGroupDrawer.tsx"),
  ]);
  assert.match(shell, /resetRemoteContextIfOwned\("main_drawer", "guide"\)/);
  assert.doesNotMatch(shell, /if \(active === "\/guide"\) \{\s*setRemoteContext\("guide"\)/);
  assert.match(groups, /setRemoteContext\("guide_groups"\)/);
  assert.match(groups, /hasTVPreferredFocus=\{preferActiveFocus && item\.name === activeNameRef\.current\}/);
});

