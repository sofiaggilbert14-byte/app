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
  assert.match(navigate, /if \(route === active\) \{[\s\S]*CharmGuideGroupsRequestOpen[\s\S]*return;[\s\S]*\}/);
  assert.match(navigate, /requestAnimationFrame\(\(\) => \{/);
  assert.match(navigate, /router\.replace\(route as any\)/);
  assert.ok(
    navigate.indexOf('closeDrawer({ force: true })') < navigate.indexOf('requestAnimationFrame'),
    "drawer must close before route handoff",
  );
  assert.doesNotMatch(navigate, /closeDrawer\(\);[\s\S]*router\.replace/);
});

test("main drawer focus retries ignore EPG group-count and programme churn", async () => {
  const shell = await source("src/components/PurpleTvShell.tsx");
  assert.match(shell, /const activeGuideGroupName = useMemo/);
  assert.match(shell, /\[active, activeGuideGroupName, consumeFocusDrawerTop, drawerOpen, focusDrawerTop\]/);
  assert.doesNotMatch(shell, /\[active, activeProgram, consumeFocusDrawerTop, drawerOpen, focusDrawerTop, guideGroups\]/);
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
  assert.match(shell, /leftEdgeDrawerTarget:[\s\S]{0,300}width: 10/);
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

test("Guide matched filters and custom EPG refresh track current ownership and query", async () => {
  const [guide, sources, custom] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("app/(tabs)/epg-sources.tsx"),
    source("app/epg-custom.tsx"),
  ]);
  assert.match(guide, /const epgMatchOwnership = useMemo/);
  assert.match(guide, /group, hasOwnedEpgMatch, hiddenIdSet/);
  assert.match(sources, /channelHasOwnedEpgMatch\(channel, epgMatchOwnership\)/);
  assert.match(custom, /\[busy, prefs, urlDraft, xmltvQuery\]/);
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
  assert.match(preview, /onOpenDrawer/);
  assert.match(guide, /openDrawer\(\)/);
  assert.match(guide, /focusGuidePreviewSurface\(\)/);
  assert.match(guide, /setPreviewActionsFocused\(true\)/);
  assert.match(guide, /!previewActionsFocused/);
  assert.match(preview, /onActionsFocusChange\(true\)/);
  assert.match(preview, /onFocusLost=\{\(\) => onActionsFocusChange\(false\)\}/);
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

test("custom XMLTV ownership and user tabs stay isolated from provider parser rows", async () => {
  const [settings, epg, customEpg, customGroups, nativeEpg, nativeControl] = await Promise.all([
    source("app/(tabs)/settings.tsx"),
    source("app/(tabs)/epg-sources.tsx"),
    source("app/epg-custom.tsx"),
    source("src/core/customGuideGroups.ts"),
    source("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/EpgBindingNativeModule.kt"),
  ]);
  assert.match(settings, /router\.push\("\/epg-sources"/);
  assert.match(epg, /Custom EPG & channel assignments/);
  assert.match(epg, /Manage Guide groups & custom tabs/);
  assert.match(epg, /Guide opens on/);
  assert.match(customEpg, /Custom XMLTV URL/);
  assert.match(customEpg, /refreshNativeUserGuide\(url\)/);
  assert.match(customEpg, /setNativeGuideChannelBinding\(channel\.id, xmltvId\)/);
  assert.match(nativeEpg, /charm_epg_user_v1\.db/);
  assert.match(nativeControl, /dao\.setChannelBinding\(USER_SOURCE_ID, cleanChannelId, cleanXmltvId\)/);
  assert.match(customGroups, /channelIds: string\[\]/);
  assert.doesNotMatch(customGroups, /streamUrl|epgRows|programmes:/);
});

test("TV Guide drawer entry opens groups first and overlay cleanup preserves the next owner", async () => {
  const [shell, groups, remote, guide, intent] = await Promise.all([
    source("src/components/PurpleTvShell.tsx"),
    source("src/components/PurpleGuideGroupDrawer.tsx"),
    source("src/utils/tvRemote.ts"),
    source("app/(tabs)/guide.tsx"),
    source("src/core/guideEntryIntent.ts"),
  ]);
  assert.match(shell, /if \(route === "\/guide"\) requestGuideGroupsOnEntry\(\)/);
  assert.match(guide, /consumeGuideGroupsOnEntry\(\)/);
  assert.match(intent, /openGroupsOnNextGuideEntry/);
  assert.match(remote, /\): boolean \{/);
  assert.match(groups, /resetRemoteContextIfOwned\("guide_groups", "guide"\)/);
  assert.doesNotMatch(groups, /setRemoteContext\("guide"\);\s*setGuideNavigationActive\(true\)/);
});

test("entry preferred focus disarms as soon as real user focus exists", async () => {
  const [channels, collection, search, settings] = await Promise.all([
    source("app/(tabs)/channels.tsx"),
    source("src/components/PurpleChannelCollection.tsx"),
    source("app/(tabs)/search.tsx"),
    source("app/(tabs)/settings.tsx"),
  ]);
  assert.match(channels, /const noteChannelFocus = useCallback\([\s\S]*?setPreferInitialFocus\(false\)[\s\S]*?setFocusedChannelId\(id\)/);
  assert.match(channels, /onFocusChannel=\{noteChannelFocus\}/);
  assert.match(collection, /onFocus=\{onFocus\}/);
  assert.match(collection, /const disarmInitialFocus = useCallback\(\(\) => setPreferInitialFocus\(false\)/);
  assert.match(search, /const noteKeyboardFocus = useCallback\([\s\S]*?setPreferKeyFocus\(false\)/);
  assert.match(search, /const noteResultsFocus = useCallback\([\s\S]*?setPreferKeyFocus\(false\)/);
  assert.match(settings, /hasTVPreferredFocus=\{preferBackFocus\}[\s\S]{0,100}onFocus=\{\(\) => setPreferBackFocus\(false\)\}/);
  assert.match(settings, /hasTVPreferredFocus=\{preferTileFocus && index === 0\}[\s\S]{0,100}onFocus=\{\(\) => setPreferTileFocus\(false\)\}/);
});

test("Guide preview uses a large channel-logo placeholder while tuning", async () => {
  const rail = await source("src/components/GuidePreviewRail.tsx");
  const matches = rail.match(/size=\{132\}/g) || [];
  assert.equal(matches.length, 2);
  assert.doesNotMatch(rail, /size=\{104\}/);
});

test("Live TV and EPG entry focus bootstrap yields immediately to Android focus", async () => {
  const [home, epg] = await Promise.all([
    source("app/(tabs)/index.tsx"),
    source("app/(tabs)/epg-sources.tsx"),
  ]);
  assert.match(home, /hasTVPreferredFocus=\{preferInitialFocus\}[\s\S]{0,140}onFocus=\{\(\) => setPreferInitialFocus\(false\)\}/);
  assert.match(epg, /hasTVPreferredFocus=\{preferTopFocus\} onFocus=\{\(\) => setPreferTopFocus\(false\)\}/);
});

test("Phase 9 management screens disarm their preferred Back focus immediately", async () => {
  const [customEpg, groups] = await Promise.all([
    source("app/epg-custom.tsx"),
    source("app/group-settings.tsx"),
  ]);
  for (const body of [customEpg, groups]) {
    assert.match(body, /hasTVPreferredFocus=\{preferBackFocus\} onFocus=\{\(\) => setPreferBackFocus\(false\)\}/);
  }
});

test("rapid Guide runway movement debounces duplicate JS programme patching", async () => {
  const [guide, canvas] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/NativeGuideCanvas.tsx"),
  ]);
  assert.match(canvas, /pageSize: number, velocity: number/);
  assert.match(canvas, /Math\.max\(0, value\.velocity \|\| 0\)/);
  assert.match(guide, /pendingRunwayPatchRef/);
  assert.match(guide, /const rapid = velocity > 0 \|\| isGuideSurfing\(\)/);
  assert.match(guide, /const delay = rapid \? 110 : 0/);
  assert.match(guide, /clearTimeout\(runwayPatchTimer\.current\)/);
  assert.match(guide, /patchProgramsForChannelIds\(pending\.ids, pending\.priorityIds\)/);
});

test("native Guide cancels delayed settled selection when focus ownership moves", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(native, /settleSelectionRunnable = Runnable/);
  assert.match(native, /if \(!value\) \{[\s\S]{0,180}removeCallbacks\(settleSelectionRunnable\)[\s\S]{0,120}navigationKeyDown = false[\s\S]{0,120}moveVelocity = 0/);
  assert.match(native, /removeCallbacks\(settleSelectionRunnable\)[\s\S]{0,120}reloadGeneration = value/);
  assert.match(native, /if \(enabled\) postDelayed\(settleSelectionRunnable, 80L\)/);
  assert.doesNotMatch(native, /postDelayed\(\{ emitSelection\(true\) \}, 80L\)/);
});

test("Guide query completion cannot falsely settle held D-pad navigation", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(native, /private var navigationKeyDown = false/);
  assert.match(native, /navigationKeyDown = true[\s\S]{0,120}removeCallbacks\(settleSelectionRunnable\)/);
  assert.match(native, /navigationKeyDown = false[\s\S]{0,80}moveVelocity = 0/);
  assert.match(native, /key-up\/focus ownership[\s\S]{0,260}if \(enabled\) emitSelection\(false\)/);
  assert.match(native, /putBoolean\("settled", immediate \|\| \(!navigationKeyDown && moveVelocity == 0\)\)/);
});

test("inactive native Guide query completion cannot reclaim JS focus", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(native, /If a drawer,[\s\S]{0,180}if \(enabled\) emitSelection\(false\)/);
  assert.doesNotMatch(native, /key-up\/focus ownership may declare navigation settled\.\s*emitSelection\(false\)/);
});

test("native Guide clears held-navigation state when focus ownership leaves", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const setActive = native.match(/fun setActive\(value: Boolean\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(setActive, /if \(!value\) \{[\s\S]*navigationKeyDown = false[\s\S]*moveVelocity = 0/);
  assert.match(native, /onDetachedFromWindow\(\)[\s\S]{0,220}navigationKeyDown = false[\s\S]{0,120}moveVelocity = 0/);
  assert.match(native, /fun dispose\(\)[\s\S]{0,220}navigationKeyDown = false[\s\S]{0,120}moveVelocity = 0/);
});

test("native Guide does no database or bridge work for blocked vertical moves", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const move = native.match(/private fun moveVertical\(delta: Int\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(move, /val nextRow = \(selectedRow \+ delta\)\.coerceIn/);
  assert.match(move, /if \(nextRow == selectedRow\) return/);
  assert.ok(move.indexOf('if (nextRow == selectedRow) return') < move.indexOf('loadPrograms()'));
  assert.ok(move.indexOf('if (nextRow == selectedRow) return') < move.indexOf('emitRunway(delta)'));
});

test("native Guide only takes focus on an inactive-to-active ownership transition", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const setActive = native.match(/fun setActive\(value: Boolean\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(setActive, /val wasEnabled = enabled/);
  assert.match(setActive, /if \(!wasEnabled && rows\.isNotEmpty\(\)\) \{/);
  assert.ok(setActive.indexOf('if (!wasEnabled && rows.isNotEmpty())') < setActive.indexOf('requestFocus()'));
});

test("Guide preview actions have a deterministic D-pad Down return to the native Guide", async () => {
  const [canvas, rail, guide] = await Promise.all([
    source("src/components/NativeGuideCanvas.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
    source("app/(tabs)/guide.tsx"),
  ]);
  assert.match(canvas, /findNodeHandle/);
  assert.match(canvas, /onNativeGuideTag\?\./);
  assert.match(canvas, /ref=\{bindNativeGuideRef\}/);
  assert.match(rail, /nextFocusDown=\{guideFocusTag \|\| undefined\}/);
  assert.match(guide, /nativeGuideFocusTag/);
  assert.match(guide, /onNativeGuideTag=\{setNativeGuideFocusTag\}/);
  assert.match(guide, /guideFocusTag=\{nativeGuideFocusTag\}/);
});

test("Android remote accepts the drawer_edge ownership context used by the shell", async () => {
  const [nativeRemote, activity, bridge] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
    source("src/utils/tvRemote.ts"),
  ]);
  assert.match(nativeRemote, /"main_drawer", "drawer_edge", "player"/);
  assert.match(activity, /context == "drawer_edge" && boundaryKey == "LEFT"/);
  assert.match(bridge, /\| "drawer_edge"/);
});
