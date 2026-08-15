from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing anchor in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))

# Remove retired guide group-layout preference from Settings.
replace_once(
    "frontend/app/(tabs)/settings.tsx",
    '''                <ChoiceRow<"horizontal" | "vertical">\n                  label="Guide group layout"\n                  value={guideUi.groupLayout}\n                  options={[\n                    { label: "Horizontal", value: "horizontal" },\n                    { label: "Vertical", value: "vertical" },\n                  ]}\n                  onChange={guideUi.setGroupLayout}\n                />\n''',
    "",
)

# Restore styles still used by the expanded guide after the old group UI was removed.
replace_once(
    "frontend/app/(tabs)/guide.tsx",
    '''  page: { flex: 1, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 3 },\n''',
    '''  page: { flex: 1, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 3 },\n  body: { flex: 1, minHeight: 0, flexDirection: "row", gap: 8 },\n  gridPanel: { flex: 1, minWidth: 0, minHeight: 0 },\n  pinCard: { width: 340, maxWidth: "100%", borderRadius: 10, backgroundColor: tvColors.panel, padding: 16, gap: 10 },\n  overlayTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 16, textAlign: "center" },\n''',
)

# Move semantic long-press listener below goGuide so its callback is initialized first.
player = Path("frontend/app/player.tsx")
text = player.read_text()
block = '''  useEffect(() => {\n    if (!isTV) return;\n    // TiViMate-style semantic long presses, limited to actions Charm already owns.\n    // Long Down exposes channel browsing without triggering a stream reload;\n    // Long Select simply wakes the controls/quick-action surface.\n    return addTvLongPressListener((key) => {\n      if (key === "DOWN") {\n        if (remoteShortcuts.longDown === "guide") {\n          goGuide();\n          return;\n        }\n        if (remoteShortcuts.longDown === "channels") {\n          controlsRef.current = true;\n          setControls(true);\n          setMoreOpen(false);\n          setTracksOpen(false);\n          setChannelsOpen(true);\n          scheduleHide();\n        }\n        return;\n      }\n      if (key === "SELECT") {\n        if (remoteShortcuts.longSelect === "guide") {\n          goGuide();\n          return;\n        }\n        if (remoteShortcuts.longSelect === "controls") revealControls({ claimChannelsFocus: true });\n      }\n    });\n  }, [goGuide, isTV, remoteShortcuts.longDown, remoteShortcuts.longSelect, revealControls, scheduleHide]);\n\n'''
if block not in text:
    raise SystemExit("missing long-press block")
text = text.replace(block, "", 1)
anchor = '''  const goGuide = useCallback(() => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    if (zapTimer.current) clearTimeout(zapTimer.current);\n    if (previewTimer.current) clearTimeout(previewTimer.current);\n    if (retryTimer.current) clearTimeout(retryTimer.current);\n    generationRef.current += 1;\n    setDecoderArmed(false);\n    stopFullscreenSession();\n    router.replace("/guide" as any);\n  }, [router]);\n\n'''
if anchor not in text:
    raise SystemExit("missing goGuide anchor")
text = text.replace(anchor, anchor + block, 1)
player.write_text(text)

# Supply explicit logo priority before the partial-match callback.
replace_once(
    "frontend/src/source.native.ts",
    '''        const applied = await matchChannelsWithPhases(cached.channels, indexes, epgLogos, async (partial, partialQuality) => {\n''',
    '''        const applied = await matchChannelsWithPhases(cached.channels, indexes, epgLogos, getLogoPriority(), async (partial, partialQuality) => {\n''',
)

print("Overhaul typecheck blockers patched.")
