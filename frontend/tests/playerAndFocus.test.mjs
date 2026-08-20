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

test("closed main drawer consumes first Back and opens only on a bounded second Back", async () => {
  assert.equal(evaluateDrawerBack({ drawerOpen: false, blockingOverlayOpen: false, now: 10_000 }), "arm-reopen");
  assert.equal(evaluateDrawerBack({ drawerOpen: false, blockingOverlayOpen: false, reopenArmedAt: 10_000, now: 10_800 }), "open-drawer");
  assert.equal(evaluateDrawerBack({ drawerOpen: false, blockingOverlayOpen: false, reopenArmedAt: 10_000, now: 11_500 }), "arm-reopen");
  assert.equal(evaluateDrawerBack({ drawerOpen: true, blockingOverlayOpen: false }), "close-drawer");
  assert.equal(evaluateDrawerBack({ drawerOpen: false, blockingOverlayOpen: true }), "pass-through");
  const shell = await source("src/components/PurpleTvShell.tsx");
  assert.match(shell, /decision === "arm-reopen"[\s\S]*?reopenArmedAtRef\.current = Date\.now\(\)[\s\S]*?return true/);
  assert.match(shell, /decision === "open-drawer"[\s\S]*?openDrawer\(\{ focusTop: true \}\)[\s\S]*?return true/);
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
  assert.doesNotMatch(rail, /hasTVPreferredFocus=\{preferPlayFocus\}/);
});

test("active native Guide claims initial focus when its first channel rows arrive", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /val wasEmpty = rows\.isEmpty\(\)/);
  assert.match(view, /if \(wasEmpty\) requestFocus\(\)/);
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

test("fullscreen remote mappings use one native semantic router and remain player-scoped", async () => {
  const [activity, remote, prefs, player, settings] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
    source("src/utils/tvRemote.ts"),
    source("src/core/remoteShortcutPreferences.ts"),
    source("app/player.tsx"),
    source("app/(tabs)/settings.tsx"),
  ]);
  assert.match(activity, /TvRemoteModule\.remoteContext == "player"/);
  assert.match(activity, /emitRemoteEvent\("TvRemoteShortcut", shortcut\)/);
  assert.match(remote, /export function addTvShortcutListener/);
  for (const key of ["channelUp", "channelDown", "mediaPlayPause"]) assert.match(prefs, new RegExp(key));
  assert.match(player, /runRemoteAction/);
  assert.match(player, /addTvShortcutListener/);
  assert.match(settings, /Restore remote defaults/);
});

test("Guide long Select is exclusively contextual Quick Actions, never the old Favorite shortcut", async () => {
  const [guide, overlay, modal, activity] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/TvQuickActionsOverlay.tsx"),
    source("src/components/ProgramModal.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);
  assert.doesNotMatch(guide, /remoteShortcuts\.longSelect/);
  assert.doesNotMatch(guide, /addTvLongPressListener/);
  assert.match(activity, /emitRemoteEvent\("TvRemoteQuickActions", context\)/);
  assert.match(overlay, /guideSelection\?\.surface === "program" && guideSelection\.program/);
  assert.match(overlay, /PROGRAM QUICK ACTIONS/);
  assert.match(overlay, /Program details \/ reminder/);
  assert.doesNotMatch(overlay, /guideSelection\.program\) \{\s*openProgram/);
  assert.match(modal, /trapFocusUp trapFocusDown trapFocusLeft trapFocusRight/);
});

test("custom EPG clear is explicit and preserves source configuration and bindings", async () => {
  const [native, bridge, screen] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt"),
    source("src/nativeEpg.ts"),
    source("app/epg-custom.tsx"),
  ]);
  assert.match(native, /fun clearUserGuide/);
  assert.match(native, /userDatabase\.clear\(\)/);
  assert.doesNotMatch(native.match(/fun clearUserGuide[\s\S]*?\n  }\n/)?.[0] || "", /clearChannelBindings/);
  assert.match(bridge, /export async function clearNativeUserGuide/);
  assert.match(screen, /Clear EPG data/);
});

test("player route cannot reclaim a channel selected inside fullscreen", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /lastRouteChannelIdRef/);
  assert.match(player, /routeChannelId === lastRouteChannelIdRef\.current/);
});

test("player More panel owns focus and scrolls all actions", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /moreFirstActionRef/);
  assert.match(player, /requestNativeFocus\(moreFirstActionRef\.current\)/);
  assert.match(player, /style=\{styles\.morePanel\}/);
  assert.match(player, /nestedScrollEnabled/);
});

test("Media3 recovery requires explicit buffering or a genuinely frozen native playing clock", async () => {
  const stream = await source("src/components/StreamPlayer.tsx");
  assert.match(stream, /const MEDIA3_FROZEN_CLOCK_MS = 9000/);
  assert.match(stream, /const observedPlaybackTime = Number\(player\.currentTime\)/);
  assert.match(stream, /Boolean\(\(player as any\)\.playing\)/);
  assert.match(stream, /const frozenReadyClock =/);
  assert.match(stream, /if \(bufferingSince == null && !frozenReadyClock\) return/);
  assert.doesNotMatch(stream, /const stalledReady =/);
  assert.match(stream, /const BUFFERING_RESYNC_MS = 5000/);
  assert.match(stream, /const BUFFERING_FAIL_MS = 22000/);
});

test("long Select consumes release and program context stays in Quick Actions", async () => {
  const [activity, overlay] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
    source("src/components/TvQuickActionsOverlay.tsx"),
  ]);
  assert.match(activity, /if \(consumedLongSelect\) return true/);
  assert.match(overlay, /PROGRAM QUICK ACTIONS/);
  assert.match(overlay, /Program details \/ reminder/);
  assert.doesNotMatch(overlay, /guideSelection\.program\) \{\s*openProgram/);
});

