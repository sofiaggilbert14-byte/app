import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const source = (path) => readFile(join(root, path), "utf8");

test("Guide is a single native logical canvas with predictive prefetch", async () => {
  const [guide, bridge, view, manager, app] = await Promise.all([
    source("app/(tabs)/guide.tsx"), source("src/components/NativeGuideCanvas.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"),
    source("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"),
  ]);
  assert.match(guide, /<NativeGuideCanvas/);
  assert.doesNotMatch(guide, /TimelineGrid|BoxGrid|focusClaimNonce/);
  assert.match(bridge, /requireNativeComponent<any>\("CharmNativeGuide"\)/);
  assert.match(view, /override fun onDraw\(canvas: Canvas\)/);
  assert.match(view, /override fun onKeyDown/);
  assert.match(view, /moveVelocity/);
  assert.match(view, /database\.queryGuideWindow/);
  assert.match(view, /rows\.subList\(from, to\)\.map \{ it\.id \}/);
  assert.match(view, /val ahead = 8 \+ min\(28, moveVelocity \* 2\)/);
  assert.doesNotMatch(view, /val ids = rows\.map \{ it\.id \}/);
  assert.match(manager, /view\.setWindowStart\(value\)/);
  assert.match(manager, /view\.setWindowEnd\(value\)/);
  assert.doesNotMatch(manager, /setTag|getTag|WINDOW_START_TAG|WINDOW_END_TAG/);
  assert.match(manager, /override fun onDropViewInstance/);
  assert.match(manager, /view\.dispose\(\)/);
  assert.match(view, /fun dispose\(\)/);
  assert.doesNotMatch(view, /onDetachedFromWindow\(\)[\s\S]{0,180}(shutdownNow|database\.close)/);
  assert.match(view, /pendingQuery = GuideQuery/);
  assert.match(view, /queryDrainScheduled = AtomicBoolean\(false\)/);
  assert.match(view, /Keep at most one active read plus the newest requested runway/);
  assert.match(app, /add\(NativeGuidePackage\(\)\)/);
});

test("Guide logical resets force a bounded native reload without remounting", async () => {
  const [guide, bridge, manager, view] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/NativeGuideCanvas.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
  ]);
  assert.match(guide, /reloadGeneration=\{resetToken\}/);
  assert.match(bridge, /reloadGeneration\?: number/);
  assert.match(bridge, /reloadGeneration=\{reloadGeneration\}/);
  assert.match(manager, /@ReactProp\(name = "reloadGeneration", defaultInt = 0\)/);
  assert.match(view, /fun setReloadGeneration\(value: Int\)/);
  assert.match(view, /pendingQuery = null[\s\S]{0,260}loadPrograms\(\)/);
  assert.doesNotMatch(guide, /key=\{resetToken\}/);
});

test("native Guide timeline uses real program duration and queries the visible runway", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /visibleWindowMs = 3L \* 60L \* 60_000L/);
  assert.match(view, /private fun timeToX\(timeMs: Long, visibleStartMs: Long, visibleEndMs: Long\)/);
  assert.match(view, /val left = timeToX\(program\.startMs, visibleStartMs, visibleEndMs\)/);
  assert.match(view, /val right = timeToX\(program\.endMs, visibleStartMs, visibleEndMs\)/);
  assert.match(view, /val x = timeToX\(tick, start, end\)/);
  assert.match(view, /val queryStart = max\(windowStartMs, viewportStartMs - horizontalPrefetchBeforeMs\)/);
  assert.match(view, /val queryEnd = min\(windowEndMs, viewportEndMs\(\) \+ horizontalPrefetchAfterMs\)/);
  assert.match(view, /list\.sortedBy \{ it\.startMs \}\.toTypedArray\(\)/);
  assert.doesNotMatch(view, /pixelsPerMinute/);
});

test("native Guide draw loop reuses formatter/date objects instead of allocating per frame", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /private val timeFormatter = SimpleDateFormat\("h:mm a", Locale\.getDefault\(\)\)/);
  assert.match(view, /private val tickDate = Date\(\)/);
  const drawHeader = view.match(/private fun drawHeader[\s\S]*?\n  }\n\n  private fun drawClippedText/)?.[0] || "";
  assert.match(drawHeader, /tickDate\.time = tick/);
  assert.match(drawHeader, /timeFormatter\.format\(tickDate\)/);
  assert.doesNotMatch(drawHeader, /SimpleDateFormat\(|Date\(/);
  assert.doesNotMatch(view, /listOfNotNull\(row\.number/);
});

test("preview tuning only follows settled native selection", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /if \(settled\) armPreviewForChannel\(channel\)/);
});

test("Startup V4 uses ordered milestones and exits at eight seconds", async () => {
  const startup = await source("src/components/StartupVersion4.tsx");
  assert.match(startup, /subscribeProgress/);
  assert.match(startup, /const STARTUP_SEQUENCE_MS = 8_000/);
  assert.match(startup, /CACHE_DOT_MS = 900/);
  assert.match(startup, /DATABASE_DOT_MS = 2_400/);
  assert.match(startup, /PLAYLIST_DOT_MS = 4_500/);
  assert.match(startup, /setInterval/);
  assert.match(startup, /return \(\) => clearInterval\(timer\)/);
  assert.match(startup, /const mayEnter = sequenceComplete/);
  assert.match(startup, /Starting EPG in background/);
  assert.match(startup, /let completedForSession = false/);
  assert.match(startup, /if \(mayEnter\) completedForSession = true/);
  assert.match(startup, /if \(completedForSession\) return null/);
});

test("settings recovery and drawer transition guard are wired", async () => {
  const [settings, epg, shell] = await Promise.all([
    source("app/(tabs)/settings.tsx"), source("app/(tabs)/epg-sources.tsx"), source("src/components/PurpleTvShell.tsx"),
  ]);
  assert.match(settings, /testID="settings-all-settings"/);
  assert.match(settings, /<PurpleDrawerButton testID="settings-open-drawer" \/>[\s\S]*?testID="settings-all-settings"[\s\S]*?<Ionicons name="arrow-back"/);
  assert.doesNotMatch(settings, /<FocusGuide style=\{styles\.detailsWrap\}>\s*<Pressable[\s\S]*?testID="settings-all-settings"/);
  assert.match(settings, /CharmShowAllSettings/);
  assert.match(epg, />All Settings</);
  assert.match(shell, /openedAtRef/);
  assert.match(shell, /PURPLE_DRAWER_ANIMATION_MS \+ 70/);
});


test("Settings claims destination focus before swapping tile/detail trees", async () => {
  const settings = await source("app/(tabs)/settings.tsx");
  const choose = settings.match(/const choose = useCallback\([\s\S]*?\n  \}, \[router\]\);/)?.[0] || "";
  assert.match(choose, /setPreferBackFocus\(true\);[\s\S]{0,100}setSection\(id\)/);
  const back = settings.match(/useTvBackHandler\([\s\S]*?\n  \);/)?.[0] || "";
  assert.match(back, /setPreferTileFocus\(true\);[\s\S]{0,100}setSection\(null\)/);
  assert.match(settings, /hasTVPreferredFocus=\{preferBackFocus\}/);
  assert.match(settings, /hasTVPreferredFocus=\{preferTileFocus && index === 0\}/);
});

test("native Guide precomputes row labels outside the repaint loop", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /ChannelRow\(val id: String, val name: String, val number: String, val label: String\)/);
  assert.match(view, /drawClippedText\(canvas, row\.label/);
  assert.doesNotMatch(view, /val rowLabel = if \(row\.number\.isBlank\(\)\)/);
});

test("native Guide treats horizontal cache misses as loading, not false boundaries", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const keys = view.match(/override fun onKeyDown[\s\S]*?override fun onKeyUp/)?.[0] || "";
  assert.doesNotMatch(keys, /current == null \|\| selectedTimeMs <= windowStartMs/);
  assert.match(keys, /selectedTimeMs <= windowStartMs \+ 60_000L/);
  assert.match(keys, /current\?\.let \{ it\.startMs - 1L \} \?: \(selectedTimeMs - 30L \* 60_000L\)/);
  const horizontalLoads = keys.match(/loadPrograms\(\)/g) || [];
  assert.ok(horizontalLoads.length >= 2, "left and right navigation must both refresh the bounded runway");
  assert.match(view, /Keep at most one active read plus the newest requested runway/);
});

test("native Guide renders selectable no-information cells instead of black rows", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /var paintedProgramme = false/);
  assert.match(view, /if \(!paintedProgramme\)/);
  assert.match(view, /drawClippedText\(canvas, "No information"/);
  assert.match(view, /if \(rowIndex == selectedRow\) selected else cell/);
});
