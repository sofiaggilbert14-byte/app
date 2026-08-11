from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def replace_once(rel, old, new):
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{rel}: expected one exact match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def sub_once(rel, pattern, replacement):
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{rel}: expected one regex match, found {count}")
    path.write_text(new_text, encoding="utf-8")


# 1) Drawer -> Guide has exactly one focus owner. Shell never pre-focuses the
# Guide beneath a still-open drawer; the mounted Guide/grid owns restoration.
replace_once(
    "frontend/src/components/PurpleTvShell.tsx",
    '''import {\n  focusGuideSurfaceWhenMounted,\n  reclaimGuideBottomFocusIfArmed,\n} from "@/src/utils/tvGuideFocusLock";''',
    '''import { reclaimGuideBottomFocusIfArmed } from "@/src/utils/tvGuideFocusLock";''',
)
replace_once(
    "frontend/src/components/PurpleTvShell.tsx",
    '''  const navigate = useCallback(\n    (route: Route) => {\n      void Haptics.selectionAsync().catch(() => undefined);\n      // Claim Guide focus only when navigating TO Guide. Leaving Guide while\n      // also retrying guide focus fights the destination screen's autofocus.\n      if (route === "/guide") {\n        focusGuideSurfaceWhenMounted(undefined, [0, 32, 96, 180, 320, 520, 800]);\n      }\n      closeDrawer();\n      if (route !== active) router.replace(route as any);\n    },\n    [active, closeDrawer, router],\n  );''',
    '''  const navigate = useCallback(\n    (route: Route) => {\n      void Haptics.selectionAsync().catch(() => undefined);\n      // Never focus content beneath a still-open drawer. If Guide is already\n      // active, its drawer-close nonce owns restoration. If we navigate to Guide\n      // from another route, the newly mounted grid owns its mount-time focus.\n      closeDrawer();\n      if (route !== active) router.replace(route as any);\n    },\n    [active, closeDrawer, router],\n  );''',
)

# 2) Real route blur must stop preview work/decoder before releasing Guide cache.
# Opening the overlay drawer does not blur this route, so its warm runway survives.
replace_once(
    "frontend/app/(tabs)/guide.tsx",
    '''      return () => {\n        setViewportGuideChannelIds(null);\n        setPriorityMatchChannelIds([]);\n        releaseGuideSlidingCache();\n      };''',
    '''      return () => {\n        if (previewTimer.current) {\n          clearTimeout(previewTimer.current);\n          previewTimer.current = null;\n        }\n        if (previewRecoverTimer.current) {\n          clearTimeout(previewRecoverTimer.current);\n          previewRecoverTimer.current = null;\n        }\n        // Unmount the preview StreamPlayer on a real route blur so Media3/VLC\n        // cannot keep decoding behind Settings/Search/other tabs.\n        setPreviewId(null);\n        setViewportGuideChannelIds(null);\n        setPriorityMatchChannelIds([]);\n        releaseGuideSlidingCache();\n      };''',
)

# 3) Drawer-return reclaim: explicit retry only. Do not simultaneously pulse
# hasTVPreferredFocus, which can target a recycled logo while retry targets the
# registered current cell.
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''    setPreferFirstRow(true);\n    const clearPreferred = setTimeout(() => setPreferFirstRow(false), 700);\n    focusGuideSurfaceWhenMounted(restoreChannelId || rows[0]?.id, [0, 40, 120, 240, 420]);\n    return () => clearTimeout(clearPreferred);''',
    '''    focusGuideSurfaceWhenMounted(restoreChannelId || rows[0]?.id, [0, 40, 120, 240, 420, 700]);''',
)
replace_once(
    "frontend/src/components/BoxGrid.tsx",
    '''    setPreferFirst(true);\n    const clearPreferred = setTimeout(() => setPreferFirst(false), 700);\n    focusGuideSurfaceWhenMounted(restoreChannelId || rows[0]?.id, [0, 40, 120, 240, 420]);\n    return () => clearTimeout(clearPreferred);''',
    '''    focusGuideSurfaceWhenMounted(restoreChannelId || rows[0]?.id, [0, 40, 120, 240, 420, 700]);''',
)

# 4) Timeline horizontal model: channel identity and programmes share one pan
# track. This makes the channel rail slide naturally off-screen as later times
# are explored, without a second independent scroll state.
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''  const [panBucket, setPanBucket] = useState(0);''',
    '''  const [panBucket, setPanBucket] = useState(0);\n  // One coarse visibility transition: once the rail is fully off-screen, stop\n  // mounting logo images until navigation returns to the channel edge.\n  const [channelRailVisible, setChannelRailVisible] = useState(true);''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''      const next = Math.max(0, target);\n      scrollXRef.current = next;\n      const bucket = Math.floor(next / PAN_BUCKET_PX) * PAN_BUCKET_PX;\n      setPanBucket((prev) => (prev === bucket ? prev : bucket));''',
    '''      const next = Math.max(0, target);\n      scrollXRef.current = next;\n      setChannelRailVisible((prev) => {\n        const visible = next < Math.max(1, LOGO_W - 4);\n        return prev === visible ? prev : visible;\n      });\n      // Programme culling uses timeline-local coordinates; scrollX includes the\n      // channel rail because both now live in the same horizontal track.\n      const timelineOffset = Math.max(0, next - LOGO_W);\n      const bucket = Math.floor(timelineOffset / PAN_BUCKET_PX) * PAN_BUCKET_PX;\n      setPanBucket((prev) => (prev === bucket ? prev : bucket));''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''    const leftEdge = prepared.left;\n    const rightEdge = prepared.left + prepared.width;''',
    '''    const leftEdge = LOGO_W + prepared.left;\n    const rightEdge = LOGO_W + prepared.left + prepared.width;''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''    const maxX = Math.max(0, timelineWidth - programViewportW);''',
    '''    const maxX = Math.max(0, LOGO_W + timelineWidth - programViewportW);''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''  }, [programViewportW, setHorizontalOffset, timelineWidth]);''',
    '''  }, [LOGO_W, programViewportW, setHorizontalOffset, timelineWidth]);''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''      focusRegionRef.current = "channel";\n      focusedProgramKeyRef.current = null;\n      reportFocusedRow(rowIndex);''',
    '''      focusRegionRef.current = "channel";\n      focusedProgramKeyRef.current = null;\n      // Returning to the channel identity edge reveals the rail again, like a\n      // traditional cable guide, and prevents Android focusing an off-screen logo.\n      if (scrollXRef.current > 4) setHorizontalOffset(0, true);\n      reportFocusedRow(rowIndex);''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''    [onBackTargetChange, onChannelFocus, reportFocusedRow],''',
    '''    [onBackTargetChange, onChannelFocus, reportFocusedRow, setHorizontalOffset],''',
)

# Replace the row render subtree so channel rail + timeline are siblings inside
# one translated track rather than a fixed rail beside a translated timeline.
sub_once(
    "frontend/src/components/TimelineGrid.tsx",
    r'''  return \(\n    <View style=\{\[styles\.row, \{ height: rowHeight \}\]\}>.*?\n  \);\n\}\);\n\nexport const TimelineGrid''',
    '''  return (\n    <View style={[styles.row, { height: rowHeight }]}>\n      <View style={styles.rowViewport}>\n        <Animated.View\n          style={[\n            styles.rowPanTrack,\n            {\n              width: logoWidth + timelineWidth,\n              height: rowHeight,\n              transform: [{ translateX: negScrollX }],\n            },\n          ]}\n        >\n          <View\n            style={[\n              styles.logoCol,\n              {\n                width: logoWidth,\n                minWidth: logoWidth,\n                maxWidth: logoWidth,\n                height: rowHeight,\n              },\n            ]}\n          >\n            <Pressable\n              ref={setLogoRef}\n              style={({ focused }: any) => [\n                styles.logoCell,\n                { paddingHorizontal: horizontalPadding, gap: itemGap },\n                focused && styles.logoCellFocused,\n              ]}\n              focusable\n              hasTVPreferredFocus={preferInitialFocus}\n              onFocus={handleChannelFocus}\n              onPress={handleChannelPress}\n              onLongPress={handleChannelLongPress}\n              delayLongPress={450}\n              testID={`epg-channel-${item.id}`}\n            >\n              {showChannelNumbers && (\n                <Text style={[styles.channelNumber, { width: numberWidth, minWidth: numberWidth }]}>\n                  {channelNumberById?.[item.id] || index + 1}\n                </Text>\n              )}\n              <ChannelLogo name={item.name} logo={item.logo} disabled={!showChannelLogos} size={logoSize} />\n              <Text\n                numberOfLines={nameMaxLines}\n                adjustsFontSizeToFit\n                minimumFontScale={0.82}\n                style={[styles.logoName, { fontSize: nameFontSize, lineHeight: nameLineHeight }]}\n              >\n                {item.name}\n              </Text>\n            </Pressable>\n          </View>\n\n          <View style={[styles.timelineTrack, { width: timelineWidth, height: rowHeight }]}>\n            {renderedPrograms.map(({ item: prepared, sourceIndex: programIndex }) => {\n              const near = programNearViewport(prepared, panBucket, programViewportW);\n              const isPreferred = prepared.key === preferred?.key;\n              const keepFocused = getFocusedProgramKey?.() === prepared.key;\n              return (\n                <ProgramCell\n                  key={prepared.key}\n                  prepared={prepared}\n                  programIndex={programIndex}\n                  channel={item}\n                  isPreferred={isPreferred}\n                  hasReminder={!!reminderKeys?.has(reminderKey(item.id, prepared.program.start))}\n                  tvFocusable={near || keepFocused}\n                  extraCompact={nameMaxLines === 1}\n                  lockFocusDown={lockFocusDown}\n                  capturePreferred={capturePreferred}\n                  onFocusNode={onFocusNode}\n                  onProgramFocus={handleProgramFocus}\n                  onProgramBlur={handleProgramBlur}\n                  onProgramPress={onProgramPress}\n                  onChannelLongPress={onChannelLongPress}\n                />\n              );\n            })}\n            {(preparedPrograms.length === 0 || preservePendingFocus) && (\n              <Pressable\n                ref={setPendingRef}\n                focusable\n                onFocus={handlePendingFocus}\n                onBlur={handlePendingBlur}\n                onPress={handleChannelPress}\n                onLongPress={handleChannelLongPress}\n                delayLongPress={450}\n                style={({ focused }: any) => [\n                  styles.progCell,\n                  styles.pendingProgramCell,\n                  preparedPrograms.length > 0\n                    ? styles.pendingProgramCellHidden\n                    : { left: 0, width: Math.max(24, timelineWidth - 6) },\n                  focused && preparedPrograms.length === 0 && styles.programCellFocused,\n                ]}\n                testID={`epg-pending-${item.id}`}\n              >\n                {preparedPrograms.length === 0 ? (\n                  <Text style={styles.noData}>\n                    {programRowState === "loading"\n                      ? "Loading programme data"\n                      : !channelHasEpgMatch(item)\n                        ? "Channel not matched to XMLTV"\n                        : "No programme supplied"}\n                  </Text>\n                ) : null}\n              </Pressable>\n            )}\n          </View>\n        </Animated.View>\n      </View>\n    </View>\n  );\n});\n\nexport const TimelineGrid''',
)

# Only mount decoded logos while the rail is actually on-screen.
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''        showChannelLogos={showChannelLogos}\n        reminderKeys={reminderKeys}''',
    '''        showChannelLogos={showChannelLogos && channelRailVisible}\n        reminderKeys={reminderKeys}''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''showChannelNumberById, showChannelLogos, reminderKeys,''',
    '''showChannelNumberById, showChannelLogos, channelRailVisible, reminderKeys,''',
) if False else None
# Dependency list uses channelNumberById, not showChannelNumberById.
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''showChannelNumbers, channelNumberById, showChannelLogos, reminderKeys,''',
    '''showChannelNumbers, channelNumberById, showChannelLogos, channelRailVisible, reminderKeys,''',
)

# Header and NOW indicator ride the same pan coordinate as the rows.
sub_once(
    "frontend/src/components/TimelineGrid.tsx",
    r'''      <View style=\{styles\.headerRow\}>.*?      </View>\n\n      \{/\*\n        No horizontal ScrollView around the body\..*?\*/\}''',
    '''      <View style={styles.headerRow}>\n        <View\n          style={styles.headerViewport}\n          onLayout={(event) => setProgramViewportW(event.nativeEvent.layout.width)}\n        >\n          <Animated.View\n            style={[\n              styles.headerPanTrack,\n              { width: LOGO_W + timelineWidth, transform: [{ translateX: negScrollX }] },\n            ]}\n          >\n            <View style={[styles.corner, { width: LOGO_W }]}>\n              <Text style={styles.cornerText}>{dayjs(windowStart).format("MMM D")}</Text>\n            </View>\n            <View style={[styles.headerTrack, { width: timelineWidth }]}>\n              {ticks.map((tick) => (\n                <Text key={tick.key} style={[styles.tickLabel, { left: tick.left }]}>{tick.label}</Text>\n              ))}\n              {showNow ? (\n                <View style={[styles.nowHeaderMark, { left: Math.max(0, nowOffset - 14) }]} pointerEvents="none">\n                  <Text style={styles.nowHeaderText}>NOW</Text>\n                  <View style={styles.nowHeaderCaret} />\n                </View>\n              ) : null}\n            </View>\n          </Animated.View>\n        </View>\n      </View>\n\n      {/* Channel identity and programme cells share one horizontal pan track. */}''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''          <View\n            style={[styles.nowOverlay, { left: LOGO_W }]}'''.replace('\\n', '\n'),
    '''          <View\n            style={styles.nowOverlay}'''.replace('\\n', '\n'),
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''                width: timelineWidth,\n                height: bodyH,''',
    '''                width: LOGO_W + timelineWidth,\n                height: bodyH,''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''              <View style={[styles.nowLineTrack, { left: Math.max(0, nowOffset - 1) }]}>''',
    '''              <View style={[styles.nowLineTrack, { left: Math.max(0, LOGO_W + nowOffset - 1) }]}>''',
)

# Profile-sized FlashList render runway: enough native rows for held D-pad, not
# a fixed 2200px+ blanket on weak Fire TV sticks.
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''  const lastRowIndex = Math.max(0, channels.length - 1);''',
    '''  const renderDrawDistance = cacheProfile === "weak"\n    ? Math.max(900, ROW_H * 18)\n    : cacheProfile === "max_preview"\n      ? Math.max(1800, ROW_H * 32)\n      : Math.max(1400, ROW_H * 24);\n\n  const lastRowIndex = Math.max(0, channels.length - 1);''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''            drawDistance={Math.max(2200, ROW_H * 36)}''',
    '''            drawDistance={renderDrawDistance}''',
)

# Styles for the shared horizontal tracks.
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''  headerRow: {\n    flexDirection: "row",\n    borderBottomWidth: 1,''',
    '''  headerRow: {\n    flexDirection: "row",\n    overflow: "hidden",\n    borderBottomWidth: 1,''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''  cornerText: { color: ACCENT_SOFT, fontFamily: fonts.bold, fontSize: 11 },\n  headerTrack: { flex: 1, height: HEADER_H, overflow: "hidden" },''',
    '''  cornerText: { color: ACCENT_SOFT, fontFamily: fonts.bold, fontSize: 11 },\n  headerViewport: { flex: 1, height: HEADER_H, overflow: "hidden" },\n  headerPanTrack: { flexDirection: "row", height: HEADER_H, flexShrink: 0 },\n  headerTrack: { height: HEADER_H, overflow: "hidden", flexShrink: 0 },''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.055)", overflow: "hidden" },\n  logoCol: {''',
    '''  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.055)", overflow: "hidden" },\n  rowViewport: { flex: 1, height: "100%", overflow: "hidden" },\n  rowPanTrack: { flexDirection: "row", flexShrink: 0 },\n  logoCol: {''',
)
replace_once(
    "frontend/src/components/TimelineGrid.tsx",
    '''  timelineTrack: {\n    position: "relative",\n  },''',
    '''  timelineTrack: {\n    position: "relative",\n    flexShrink: 0,\n  },''',
)

# 5) Memory pressure: critical pressure cancels stale patch generations and
# strictly evicts off-keep JS/native rows so in-flight work cannot immediately
# repopulate memory after cleanup.
replace_once(
    "frontend/src/store.tsx",
    '''      const keepLimit = critical ? 24 : 48;\n      const keep = pickKeepIdsAroundFocus(source, keepLimit, lastChannelIdRef.current);\n      trimGuideProgramRows(keep, critical);\n      trimProgrammeWindowCacheForMemoryPressure(keep, critical);\n      clearChannelLogoMemory();''',
    '''      const keepLimit = critical\n        ? powerProfile === "weak" ? 8 : powerProfile === "max_preview" ? 16 : 12\n        : powerProfile === "weak" ? 16 : powerProfile === "max_preview" ? 48 : 32;\n      const keep = pickKeepIdsAroundFocus(source, keepLimit, lastChannelIdRef.current);\n      if (critical) {\n        runwayGenerationRef.current += 1;\n        pendingPatchGenerationRef.current = runwayGenerationRef.current;\n        pendingPatchIdsRef.current.clear();\n        pendingPatchPriorityIdsRef.current = [];\n        if (patchTimerRef.current) {\n          clearTimeout(patchTimerRef.current);\n          patchTimerRef.current = null;\n        }\n        retainGuidePrograms(keep, { force: true });\n        retainProgrammeWindowCache(keep);\n      }\n      trimGuideProgramRows(keep, critical);\n      trimProgrammeWindowCacheForMemoryPressure(keep, critical);\n      clearChannelLogoMemory();''',
)
replace_once(
    "frontend/src/store.tsx",
    '''    [],\n  );\n  const [epgGuideFilter,''',
    '''    [powerProfile],\n  );\n  const [epgGuideFilter,''',
)
replace_once(
    "frontend/src/store.tsx",
    '''    const keepLimit = powerProfile === "weak" ? 48 : powerProfile === "max_preview" ? 128 : 96;''',
    '''    const keepLimit = powerProfile === "weak" ? 24 : powerProfile === "max_preview" ? 72 : 48;''',
)

# Backup cache ceilings should never be large enough to retain a full 2k-channel
# playlist if a future path misses strict conveyor eviction.
replace_once(
    "frontend/src/core/devicePowerProfile.ts",
    '''    programmeRowCacheLimit: 2400,''',
    '''    programmeRowCacheLimit: 720,''',
)
replace_once(
    "frontend/src/core/devicePowerProfile.ts",
    '''    programmeRowCacheLimit: 1200,''',
    '''    programmeRowCacheLimit: 320,''',
)
replace_once(
    "frontend/src/core/devicePowerProfile.ts",
    '''    programmeRowCacheLimit: 3200,''',
    '''    programmeRowCacheLimit: 960,''',
)

# 6) Regression tests for the new single focus owner, sliding rail and strict
# critical cleanup.
replace_once(
    "frontend/tests/guideEliteArchitecture.test.mjs",
    '''  assert.match(shell, /focusGuideSurfaceWhenMounted/);\n  // Shell must not reclaim Guide on every drawer close (races focusClaimNonce).\n  assert.doesNotMatch(\n    shell,\n    /if \\(active === "\\/guide" && !activeProgram\\) \\{\\s*focusGuideSurfaceWhenMounted/,\n  );\n  assert.match(shell, /if \\(route === "\\/guide"\\) \\{\\s*focusGuideSurfaceWhenMounted/);''',
    '''  // Shell never reaches behind the drawer to claim Guide focus.\n  assert.doesNotMatch(shell, /focusGuideSurfaceWhenMounted/);''',
)
replace_once(
    "frontend/tests/guideEliteArchitecture.test.mjs",
    '''  assert.match(timeline, /recentlyOwned/);''',
    '''  assert.match(timeline, /recentlyOwned/);\n  assert.match(timeline, /styles\\.rowPanTrack/);\n  assert.match(timeline, /width: logoWidth \\+ timelineWidth/);\n  assert.match(timeline, /showChannelLogos && channelRailVisible/);\n  assert.match(timeline, /const timelineOffset = Math\\.max\\(0, next - LOGO_W\\)/);''',
)
replace_once(
    "frontend/tests/guideCacheLifecycle.test.mjs",
    '''  assert.match(store, /pickKeepIdsAroundFocus\\(source, keepLimit, lastChannelIdRef\\.current\\)/);''',
    '''  assert.match(store, /pickKeepIdsAroundFocus\\(source, keepLimit, lastChannelIdRef\\.current\\)/);\n  assert.match(store, /retainGuidePrograms\\(keep, \\{ force: true \\}\\)/);\n  assert.match(store, /pendingPatchIdsRef\\.current\\.clear\\(\\)/);''',
)
replace_once(
    "frontend/tests/guideCacheLifecycle.test.mjs",
    '''  assert.match(box, /\\[focusClaimNonce, restoreChannelId\\]/);''',
    '''  assert.match(box, /\\[focusClaimNonce, restoreChannelId\\]/);\n  assert.doesNotMatch(timeline, /setPreferFirstRow\\(true\\);\\s*const clearPreferred = setTimeout\\(\\(\\) => setPreferFirstRow\\(false\\), 700\\)/);\n  assert.doesNotMatch(box, /setPreferFirst\\(true\\);\\s*const clearPreferred = setTimeout\\(\\(\\) => setPreferFirst\\(false\\), 700\\)/);''',
)

print("Guide focus/memory surgery applied successfully")
