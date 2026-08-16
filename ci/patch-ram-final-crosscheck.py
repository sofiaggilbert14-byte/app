from pathlib import Path
import re

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: pattern not found')
    return text.replace(old, new, 1)

# 1) Guide: keep the broad retained runway, but query a compact data runway while a hold is active.
p = 'frontend/app/(tabs)/guide.tsx'
t = read(p)
t = t.replace('import { markGuideSurfing } from "@/src/utils/guideSurfGate";', 'import { isGuideSurfing, markGuideSurfing } from "@/src/utils/guideSurfGate";')
old = '''  const onViewportChannelIds = useCallback((ids: string[], priorityIds: string[] = [], pageSize = 8) => {\n    lastRunwayRef.current = { ids, priority: priorityIds, pageSize };\n    setViewportGuideChannelIds(ids);'''
new = '''  const onViewportChannelIds = useCallback((ids: string[], priorityIds: string[] = [], pageSize = 8) => {\n    const focusIndex = Math.max(0, ids.indexOf(priorityIds[0] || ""));\n    const dataIds = isGuideSurfing()\n      ? ids.slice(\n          Math.max(0, focusIndex - pageSize * 2),\n          Math.min(ids.length, focusIndex + pageSize * 4 + 1),\n        )\n      : ids;\n    lastRunwayRef.current = { ids: dataIds, priority: priorityIds, pageSize };\n    setViewportGuideChannelIds(ids);'''
t = replace_once(t, old, new, 'guide compact runway header')
t = replace_once(
    t,
    '    void patchProgramsForChannelIds(ids, priorityIds);\n  }, [',
    '    // Retain the wider focus runway for reverse movement, but query only a compact\n    // data runway during a sustained hold. The settled pass expands it again.\n    void patchProgramsForChannelIds(dataIds, priorityIds);\n  }, [',
    'guide compact runway query',
)
# Decoder must not stay alive behind drawer/modal or when Guide tab is hidden.
t = t.replace(
    'previewId={safePreviewMode === "off" ? null : previewId}',
    'previewId={safePreviewMode === "off" || drawerOpen || !!activeProgram || !isFocused ? null : previewId}',
)
write(p, t)

# 2) Focus registry: recycled programme nodes must never remain the active restoration target.
p = 'frontend/src/utils/tvGuideFocusLock.ts'
t = read(p)
old = '''  if (node) guideProgramNodes.set(key, node);\n  else guideProgramNodes.delete(key);'''
new = '''  if (node) {\n    guideProgramNodes.set(key, node);\n  } else {\n    const removed = guideProgramNodes.get(key);\n    guideProgramNodes.delete(key);\n    if (activeGuideFocusNode === removed) activeGuideFocusNode = null;\n  }'''
t = replace_once(t, old, new, 'stale programme focus cleanup')
write(p, t)

# 3) Shell: Guide gets deterministic one-Back drawer ownership even if shell listener fires first.
p = 'frontend/src/components/PurpleTvShell.tsx'
t = read(p)
t = t.replace('// Always boot closed — content is full-bleed; double-Back opens the drawer.', '// Always boot closed — content is full-bleed; Guide can open the drawer with one Back.')
needle = '''      const sub = BackHandler.addEventListener("hardwareBackPress", () => {\n        const decision = evaluateDrawerBack({'''
replacement = '''      const sub = BackHandler.addEventListener("hardwareBackPress", () => {\n        // Guide owns a TiViMate-style single-Back drawer transition. Keep the\n        // generic double-Back policy for other full-bleed tabs only.\n        if (active === "/guide" && !drawerOpen && !activeProgram) {\n          reopenArmedAtRef.current = 0;\n          openDrawer();\n          return true;\n        }\n        const decision = evaluateDrawerBack({'''
t = replace_once(t, needle, replacement, 'guide shell Back arbitration')
t = t.replace('    }, [activeProgram, closeDrawer, drawerOpen, openDrawer]),', '    }, [active, activeProgram, closeDrawer, drawerOpen, openDrawer]),')
write(p, t)

# 4) Logo-only refresh must honor the selected playlist-vs-EPG priority.
p = 'frontend/src/core/epgMatching.ts'
t = read(p)
t = replace_once(
    t,
    '''  previousFingerprint: string | undefined,\n  nextFingerprint: string,\n): Channel[] | null {''',
    '''  previousFingerprint: string | undefined,\n  nextFingerprint: string,\n  logoPriority: "playlist" | "epg" = "playlist",\n): Channel[] | null {''',
    'logo-only priority signature',
)
t = replace_once(
    t,
    '    const nextLogo = playlistLogo || xmltvLogo || channel.logo || "";',
    '''    const nextLogo = logoPriority === "epg"\n      ? (xmltvLogo || playlistLogo || channel.logo || "")\n      : (playlistLogo || xmltvLogo || channel.logo || "");''',
    'logo-only priority selection',
)
write(p, t)

p = 'frontend/src/source.native.ts'
t = read(p)
# First path already has a local logoPriority.
t = t.replace(
    '''          indexes.fingerprint,\n          indexes.fingerprint,\n        );''',
    '''          indexes.fingerprint,\n          indexes.fingerprint,\n          logoPriority,\n        );''',
    1,
)
# EPG-only path: resolve current user preference inline.
t = t.replace(
    'applyLogoOnlyUpdates(cached.channels, epgLogos, indexes.fingerprint, indexes.fingerprint) ||',
    'applyLogoOnlyUpdates(cached.channels, epgLogos, indexes.fingerprint, indexes.fingerprint, await getLogoPriority()) ||',
    1,
)
write(p, t)

# 5) Update obsolete tests to assert the intentionally changed RAM/TiViMate behavior.
p = 'frontend/tests/playerAndFocus.test.mjs'
t = read(p).replace('assert.equal(preferredEngine("transport"), "vlc");', 'assert.equal(preferredEngine("transport"), "media3");')
write(p, t)

p = 'frontend/tests/playbackSession.test.mjs'
t = read(p)
t = t.replace('capability-based engine selection still prefers Media3 for HLS and VLC for TS', 'default engine selection prefers Media3 for HLS and TS with VLC fallback')
t = t.replace('assert.equal(preferredEngine("transport"), "vlc");', 'assert.equal(preferredEngine("transport"), "media3");')
t = t.replace('assert.match(playerComp, /surfaceType=\\{Platform\\.OS === "android" \\? "textureView"/);', 'assert.match(playerComp, /mode === "preview" \\? "textureView" : "surfaceView"/);')
write(p, t)

p = 'frontend/tests/drawerNavigation.test.mjs'
t = read(p)
t = t.replace('assert.match(shell, /requestNativeFocusWithRetry\\(\\s*navRefs\\.current\\.get\\(preferredRoute\\)/);', 'assert.match(shell, /requestNativeFocusWithRetry\\(\\s*preferredNode/);')
start = t.index('test("guide tabs reclaim the left edge and top-row Up restores the active tab"')
end = t.index('test("grids never open the drawer from D-pad Left"', start)
new_test = '''test("Guide drawer owns groups and deterministic Back/Left entry", async () => {\n  const [guide, shell, focusLock] = await Promise.all([\n    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),\n    readFile(join(root, "src/components/PurpleTvShell.tsx"), "utf8"),\n    readFile(join(root, "src/utils/tvGuideFocusLock.ts"), "utf8"),\n  ]);\n  assert.match(shell, /guideGroups\\?\\.length/);\n  assert.match(shell, />Groups</);\n  assert.match(shell, /preferredGuideGroup/);\n  assert.match(shell, /active === "\\/guide" && !drawerOpen && !activeProgram/);\n  assert.match(guide, /onLeftBoundary=\\{onGuideLeftBoundary\\}/);\n  assert.match(guide, /another Left enters the drawer/);\n  assert.match(guide, /openDrawer\\(\\)/);\n  assert.match(guide, /useTvBackHandler/);\n  assert.match(guide, /one Back opens the group\\/navigation drawer immediately/);\n  assert.doesNotMatch(guide, /groupSlideX|guide-more-groups-overlay|onBackTargetChange/);\n  assert.match(guide, /active=\\{isFocused && !activeProgram && !drawerOpen\\}/);\n  assert.match(guide, /lockLeftEdge=\\{false\\}/);\n  assert.match(guide, /expandRunwayKeepSet/);\n  assert.match(guide, /retainGuideSlidingCache/);\n  assert.match(focusLock, /activeGuideFocusNode === removed/);\n  assert.match(guide, /openFullscreenPlayer/);\n  assert.match(guide, /guideSessionChannelByGroup/);\n});\n\n'''
t = t[:start] + new_test + t[end:]
write(p, t)

p = 'frontend/tests/guideShellPolish.test.mjs'
t = read(p)
t = t.replace('assert.match(guide, /focusGuidePreviewSurface\\(\\)/);', 'assert.match(guide, /another Left enters the drawer/);\n  assert.match(guide, /openDrawer\\(\\)/);\n  assert.doesNotMatch(guide, /focusGuidePreviewSurface\\(\\)/);')
write(p, t)

p = 'frontend/tests/guideEliteArchitecture.test.mjs'
t = read(p).replace('assert.match(guide, /guide-more-groups-overlay/);', 'assert.doesNotMatch(guide, /guide-more-groups-overlay/);\n  assert.match(guide, /type PurpleGuideGroup/);')
write(p, t)

p = 'frontend/tests/playerSettingsHotApply.test.mjs'
t = read(p).replace('assert.match(player, /maxBufferBytes: 48 \\* 1024 \\* 1024/);', 'assert.match(player, /maxBufferBytes: \\(lowRam \\? 28 : 48\\) \\* 1024 \\* 1024/);')
write(p, t)

p = 'frontend/tests/rc1Hardening.test.mjs'
t = read(p).replace('assert.match(sourceNative, /parseM3UWithStats/);', 'assert.match(sourceNative, /fetchNativePlaylist/);\n  assert.doesNotMatch(sourceNative, /parseM3UWithStats/);')
write(p, t)

p = 'frontend/tests/epgMatching.test.mjs'
t = read(p)
t = t.replace(
    'applyLogoOnlyUpdates(channels, { tv1: "new.png" }, fingerprint, fingerprint)',
    'applyLogoOnlyUpdates(channels, { tv1: "new.png" }, fingerprint, fingerprint, "epg")',
)
write(p, t)

# 6) Extend architecture verifier with final cross-check invariants.
p = 'frontend/scripts/verify-overhaul-architecture.mjs'
t = read(p)
checks = '''\n// Final RAM cross-check: PR24-compatible hardening without restoring its old navigation model.\nrequireText("app/(tabs)/guide.tsx", "const dataIds = isGuideSurfing()", "held Guide surfing no longer uses compact EPG data runway");\nrequireText("app/(tabs)/guide.tsx", "drawerOpen || !!activeProgram || !isFocused", "Guide preview decoder can survive behind drawer/modal/hidden tab");\nrequireText("src/utils/tvGuideFocusLock.ts", "activeGuideFocusNode === removed", "recycled programme focus ref cleanup is missing");\nrequireText("src/components/PurpleTvShell.tsx", "active === "/guide" && !drawerOpen && !activeProgram", "Guide shell single-Back drawer arbitration is missing");\nforbidText("app/(tabs)/guide.tsx", "guide-more-groups-overlay", "retired More Groups overlay returned");\n'''
marker = '\nconsole.log("TiViMate architecture-overhaul conflict scan passed.");\n'
if 'held Guide surfing no longer uses compact EPG data runway' not in t:
    t = replace_once(t, marker, checks + marker, 'architecture verifier marker')
write(p, t)

print('RAM final TiViMate/PR24 cross-check patch applied.')
