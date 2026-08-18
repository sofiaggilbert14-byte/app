import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGroupCounts,
  channelMatchesSmart,
  pinGroup,
  unpinGroup,
  buildVisibleGroups,
} from "../src/core/guideGroups.ts";
import {
  requestGuideJump,
  consumeGuideJump,
  peekGuideJump,
} from "../src/core/guideSearchJump.ts";
import {
  noteStreamFailure,
  failedStreamCount,
  listFailedChannelIds,
  clearStreamFailure,
} from "../src/core/streamFailureRegistry.ts";
import {
  setParentalPinMemory,
  verifyParentalPin,
} from "../src/core/parentalPinCore.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("guideGroups buildGroupCounts / smart HD / pin", () => {
  const channels = [
    { id: "1", name: "ESPN HD", group: "Sports", url: "http://x" },
    { id: "2", name: "Cartoon", group: "Kids", url: "http://x" },
    { id: "3", name: "News 4K", group: "News", url: "http://x" },
    { id: "4", name: "Hidden HD", group: "Sports", url: "http://x" },
  ];
  const counts = buildGroupCounts(channels, {
    favoriteSet: new Set(["2"]),
    recentIds: new Set(["1"]),
    hasEpgMatch: (channel) => channel.id !== "3",
    isFailed: (id) => id === "1",
    hiddenIds: new Set(["4"]),
  });
  assert.equal(counts.All, 3);
  assert.equal(counts.Favorites, 1);
  assert.equal(counts["Recently Watched"], 1);
  assert.equal(counts["HD Only"], 2);
  assert.equal(counts["Failed Streams"], 1);
  assert.equal(counts["Unmatched EPG"], 1);
  assert.ok(counts.Sports >= 1);
  assert.ok(channelMatchesSmart(channels[0], "HD Only", {
    hasEpgMatch: () => true,
    isFailed: () => false,
  }));

  let pinned = pinGroup(["Favorites"], "Sports");
  pinned = pinGroup(pinned, "Sports");
  assert.deepEqual(pinned, ["Favorites", "Sports"]);
  assert.deepEqual(unpinGroup(pinned, "Favorites"), ["Sports"]);

  const visible = buildVisibleGroups({
    counts,
    pinned: ["Sports"],
    playlistGroups: ["Local"],
    maxPlaylistTabs: 4,
  });
  assert.ok(visible.tabs.includes("Sports"));
  assert.ok(visible.tabs.includes("All"));
  assert.ok(visible.tabs.includes("HD Only"));
});

test("guideSearchJump request/consume", () => {
  while (consumeGuideJump()) {
    /* drain */
  }
  assert.equal(peekGuideJump(), null);
  requestGuideJump({ channelId: "  ", group: "Sports" });
  assert.equal(peekGuideJump(), null);
  requestGuideJump({
    channelId: "ch-9",
    group: "Sports",
    programStart: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(peekGuideJump(), {
    channelId: "ch-9",
    group: "Sports",
    programStart: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(consumeGuideJump(), {
    channelId: "ch-9",
    group: "Sports",
    programStart: "2026-01-01T00:00:00Z",
  });
  assert.equal(consumeGuideJump(), null);
});

test("streamFailureRegistry stays bounded", () => {
  for (const id of listFailedChannelIds()) clearStreamFailure(id);
  noteStreamFailure("a");
  noteStreamFailure("b");
  assert.equal(failedStreamCount(), 2);
  assert.deepEqual(listFailedChannelIds().slice(0, 2), ["b", "a"]);
  for (let i = 0; i < 120; i += 1) noteStreamFailure(`f${i}`);
  assert.ok(failedStreamCount() <= 80);
  assert.equal(failedStreamCount(), 80);
});

test("parental pin normalize via verify after set", async () => {
  const set = async (pin) => setParentalPinMemory(pin);
  await set(null);
  assert.equal(verifyParentalPin("1234"), false);
  await set("12ab34");
  assert.equal(verifyParentalPin("1234"), true);
  assert.equal(verifyParentalPin("0000"), false);
  await set("12");
  assert.equal(verifyParentalPin("12"), false);
  await set(null);
  assert.equal(verifyParentalPin("1234"), false);
});

test("drawer shell boots closed without an icon rail", async () => {
  const shell = await source("src/components/PurpleTvShell.tsx");
  assert.match(shell, /useState\(false\)/);
  assert.doesNotMatch(shell, /purple-icon-rail|focusPurpleIconRail|PURPLE_ICON_RAIL_WIDTH/);
  assert.match(shell, /isGuideSurfing/);
  assert.match(shell, /focusable=\{drawerOpen\}/);
  assert.match(shell, /outputRange: \[-PURPLE_SIDEBAR_WIDTH, 0\]/);
  assert.doesNotMatch(shell, /Catch Up|\/catchup/);
  assert.match(shell, /autoFocus=\{!drawerOpen && active !== "\/guide"\}/);
});

test("drawer route changes release drawer focus ownership before mounting the next screen", async () => {
  const shell = await source("src/components/PurpleTvShell.tsx");
  const navigate = shell.match(/const navigate = useCallback\([\s\S]*?\n  \);/)?.[0] || "";
  assert.match(navigate, /closeDrawer\(\{ force: true \}\)/);
  assert.match(navigate, /if \(route === active\) return/);
  assert.match(navigate, /requestAnimationFrame\(\(\) => \{/);
  assert.match(navigate, /router\.replace\(route as any\)/);
  assert.ok(
    navigate.indexOf('closeDrawer({ force: true })') < navigate.indexOf('requestAnimationFrame'),
    "drawer must close before route handoff",
  );
  assert.doesNotMatch(navigate, /closeDrawer\(\);[\s\S]*router\.replace/);
});

test("shared page focus has a deterministic Left-edge drawer handoff", async () => {
  const [shell, collection, favorites, reminders, live, channels] = await Promise.all([
    source("src/components/PurpleTvShell.tsx"),
    source("src/components/PurpleChannelCollection.tsx"),
    source("app/(tabs)/favorites.tsx"),
    source("app/(tabs)/reminders.tsx"),
    source("app/(tabs)/index.tsx"),
    source("app/(tabs)/channels.tsx"),
  ]);
  assert.match(shell, /testID="purple-left-edge-drawer-target"/);
  assert.match(shell, /onFocus=\{\(\) => openDrawer\(\)\}/);
  assert.match(shell, /trapFocusLeft=\{false\}/);
  assert.match(shell, /isGuideScreenActive\(\) && isGuideSurfing\(\)/);
  for (const page of [collection, favorites, reminders, live, channels]) {
    assert.match(page, /preferInitialFocus/);
    assert.match(page, /setPreferInitialFocus\(false\)/);
  }
  assert.doesNotMatch(reminders, /hasTVPreferredFocus\s*\n/);
  assert.match(reminders, /hasTVPreferredFocus=\{preferInitialFocus\}/);
});

test("Live preview has an explicit D-pad bridge into the recent channel list", async () => {
  const live = await source("app/(tabs)/index.tsx");
  assert.match(live, /findNodeHandle/);
  assert.match(live, /nextFocusDown=\{firstRecentTag\}/);
  assert.match(live, /inputRef=\{index === 0 \? bindFirstRecentRef : undefined\}/);
  assert.match(live, /nextFocusUp=\{index === 0 \? heroButtonTag : undefined\}/);
  assert.match(live, /ref=\{bindHeroButtonRef as any\}/);
  assert.match(live, /ref=\{inputRef as any\}/);
});

test("automatic refresh stays away from guide and player screens", async () => {
  const [scheduler, preferences] = await Promise.all([
    source("src/components/SourceRefreshScheduler.tsx"),
    source("src/core/sourceRefreshPreferences.ts"),
  ]);
  assert.match(scheduler, /pathname\?\.startsWith\("\/guide"\)/);
  assert.match(scheduler, /pathname\?\.startsWith\("\/player"\)/);
  assert.match(scheduler, /isGuideSurfing\(\)/);
  assert.match(preferences, /playlistHours: 24/);
  assert.match(preferences, /epgHours: 6/);
});

test("EPG and playlist controls live only on the dedicated EPG settings page", async () => {
  const [settings, epg] = await Promise.all([
    source("app/(tabs)/settings.tsx"),
    source("app/(tabs)/epg-sources.tsx"),
  ]);
  for (const label of [
    "Guide EPG filter",
    "Guide window",
    "Prefer tvg-id matching only",
    "Playlist auto refresh",
    "EPG auto refresh",
    "Channel logos priority",
    "Clear & rebuild guide cache",
  ]) {
    assert.doesNotMatch(settings, new RegExp(label));
    assert.match(epg, new RegExp(label));
  }
  assert.match(epg, /Refresh playlist & EPG now/);
  assert.match(epg, /Refresh EPG only now/);
  assert.match(epg, /operationInFlight\.current/);
  assert.doesNotMatch(epg, /<Pressable disabled=\{disabled\}/);
  assert.match(epg, /accessibilityState=\{\{ busy: Boolean\(disabled\) \}\}/);
  assert.match(epg, /<ScrollView/);
  assert.match(epg, /<FocusGuide/);
  assert.match(epg, /hasTVPreferredFocus=\{preferTopFocus\}/);
  assert.match(epg, /scrollRef\.current\?\.scrollTo\(\{ y: 0, animated: false \}\)/);
  assert.match(epg, /nestedScrollEnabled/);
});

test("native guide preserves last-good paint across transient query failures", async () => {
  const nativeGuide = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(nativeGuide, /catch \(_: Throwable\) \{ null \}/);
  assert.match(nativeGuide, /if \(loaded == null\) continue/);
  assert.match(nativeGuide, /programs = programs\.filterKeys/);
});

test("Search hands suggestion focus to results without opening a competing modal", async () => {
  const [search, canvas, manager] = await Promise.all([
    source("app/(tabs)/search.tsx"),
    source("src/components/NativeGuideCanvas.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"),
  ]);
  assert.match(search, /focusResultsWhenReadyRef/);
  assert.match(search, /requestNativeFocusWithRetry\(firstResultRef\.current/);
  assert.doesNotMatch(search, /openProgram\(opts\.program/);
  assert.match(search, /programStart: opts\?\.programStart/);
  assert.match(canvas, /restoreTimeMs/);
  assert.match(manager, /@ReactProp\(name = "restoreTimeMs"/);
});

test("pointer BACK exits pointer mode and tap coordinates honor Android density", async () => {
  const [activity, remote] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
    source("android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt"),
  ]);
  assert.match(activity, /KEYCODE_BACK -> "BACK"/);
  assert.match(remote, /displayMetrics\.density/);
  assert.match(remote, /x \* density/);
  assert.match(remote, /y \* density/);
});

test("guide top strip is focusable while Left remains drawer-owned with conveyor retain", async () => {
  const [guide, preview, focus] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
    source("src/utils/tvFocus.ts"),
  ]);
  assert.match(guide, /GuidePreviewRail/);
  assert.match(guide, /another Left enters the drawer/);
  assert.match(guide, /openDrawer\(\)/);
  assert.match(guide, /focusGuidePreviewSurface\(\)/);
  assert.match(guide, /setPreviewFocusRequestToken/);
  assert.match(preview, /hasTVPreferredFocus=\{preferPlayFocus\}/);
  assert.match(focus, /typeof focus === "function"/);
  assert.match(focus, /dispatchViewManagerCommand/);
  assert.match(guide, /onOpenReminders=/);
  for (const action of ["play", "favorite", "remind", "drawer", "mute", "hide"]) {
    assert.match(preview, new RegExp(`testID="guide-preview-${action}"`));
  }
  for (const handler of ["onPlay", "onFavorite", "onOpenReminders", "onOpenDrawer", "onToggleMute", "onHideToggle"]) {
    assert.match(preview, new RegExp(`onPress=\\{${handler}\\}`));
  }
  assert.match(guide, /expandRunwayKeepSet/);
  assert.match(guide, /MAX_REMEMBERED_GUIDE_GROUPS = 128/);
  assert.match(guide, /retainGuideSlidingCache/);
  assert.doesNotMatch(guide, /focusPurpleIconRail/);
  assert.match(guide, /buildVisibleGroups/);
  assert.doesNotMatch(guide, /NowPlayingBar/);
  assert.match(preview, /width: 138/);
  assert.match(preview, /actionColumn: \{ flex: 1, minWidth: 0, gap: 3 \}/);
  assert.doesNotMatch(preview, /actionPlaceholder/);
});
