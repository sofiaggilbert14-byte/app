from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")


def patch_quick_actions() -> None:
    path = Path("frontend/src/components/TvQuickActionsOverlay.tsx")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "  BackHandler,\n  Pressable,",
        "  BackHandler,\n  DeviceEventEmitter,\n  Pressable,",
        "Quick Actions visibility emitter import",
    )
    text = replace_once(
        text,
        "    setBusy(false);\n    openPathRef.current = null;",
        "    setBusy(false);\n    DeviceEventEmitter.emit(\"CharmQuickActionsVisibility\", false);\n    openPathRef.current = null;",
        "Quick Actions close visibility",
    )
    text = replace_once(
        text,
        "    openPathRef.current = pathname || \"\";\n    setOpen(true);\n    setRemoteContext(\"modal\");",
        "    openPathRef.current = pathname || \"\";\n    DeviceEventEmitter.emit(\"CharmQuickActionsVisibility\", true);\n    setOpen(true);\n    setRemoteContext(\"modal\");",
        "Quick Actions open visibility",
    )
    cleanup = '''\n  useEffect(() => () => {\n    DeviceEventEmitter.emit("CharmQuickActionsVisibility", false);\n  }, []);\n'''
    anchor = '''\n  useEffect(() => {\n    if (!open) return;\n    const openedPath = openPathRef.current;'''
    if cleanup not in text:
        text = replace_once(text, anchor, cleanup + anchor, "Quick Actions visibility unmount cleanup")
    path.write_text(text, encoding="utf-8")


def patch_guide() -> None:
    path = Path("frontend/app/(tabs)/guide.tsx")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);\n  const { width: screenWidth, height: screenHeight } = useWindowDimensions();",
        "  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);\n  const [quickActionsOpen, setQuickActionsOpen] = useState(false);\n  const { width: screenWidth, height: screenHeight } = useWindowDimensions();",
        "Guide Quick Actions visibility state",
    )
    text = replace_once(
        text,
        "  const modalOriginRef = useRef<{ channelId: string; programStart: string } | null>(null);\n  const orderedFilteredIdsRef",
        "  const modalOriginRef = useRef<{ channelId: string; programStart: string } | null>(null);\n  const pinModalOwnedRef = useRef(false);\n  const orderedFilteredIdsRef",
        "Guide PIN modal ownership ref",
    )

    effect = '''\n  useEffect(() => {\n    if (!isFocused) {\n      setQuickActionsOpen(false);\n      return;\n    }\n    const sub = DeviceEventEmitter.addListener("CharmQuickActionsVisibility", (open: boolean) => {\n      setQuickActionsOpen(!!open);\n    });\n    return () => {\n      sub.remove();\n      setQuickActionsOpen(false);\n    };\n  }, [isFocused]);\n'''
    anchor = '''\n  useEffect(() => {\n    if (!isFocused) return;\n    const sub = DeviceEventEmitter.addListener("CharmGuideGroupsRequestOpen", () => {'''
    if effect not in text:
        text = replace_once(text, anchor, effect + anchor, "Guide Quick Actions visibility listener")

    modal_input_effect = '''\n  useEffect(() => {\n    // TiViMate-style window ownership: an overlay that is visually on top must\n    // also be the only semantic key owner. Otherwise Channel/Page keys can move\n    // the hidden native Guide and held Select can reopen Guide actions underneath.\n    if (!isFocused) {\n      setGuideNavigationActive(false);\n      if (pinModalOwnedRef.current) {\n        pinModalOwnedRef.current = false;\n        resetRemoteContextIfOwned("modal", "default");\n      }\n      return;\n    }\n\n    if (quickActionsOpen || activeProgram || pinPromptGroup) {\n      setGuideNavigationActive(false);\n    }\n\n    if (pinPromptGroup) {\n      pinModalOwnedRef.current = true;\n      if (previewTimer.current) {\n        clearTimeout(previewTimer.current);\n        previewTimer.current = null;\n      }\n      if (previewRecoverTimer.current) {\n        clearTimeout(previewRecoverTimer.current);\n        previewRecoverTimer.current = null;\n      }\n      if (surfReleaseTimer.current) {\n        clearTimeout(surfReleaseTimer.current);\n        surfReleaseTimer.current = null;\n      }\n      setPreviewId(null);\n      setPreviewActionsFocused(false);\n      setRemoteContext("modal");\n      return;\n    }\n\n    if (pinModalOwnedRef.current) {\n      pinModalOwnedRef.current = false;\n      if (!quickActionsOpen && !activeProgram) {\n        const fallback = groupDrawerOpen ? "guide_groups" : drawerOpen ? "main_drawer" : "guide";\n        const restored = resetRemoteContextIfOwned("modal", fallback);\n        if (restored && fallback === "guide") setGuideNavigationActive(true);\n      }\n      return;\n    }\n\n    if (!quickActionsOpen && !activeProgram && !drawerOpen && !groupDrawerOpen) {\n      setGuideNavigationActive(true);\n    }\n  }, [activeProgram, drawerOpen, groupDrawerOpen, isFocused, pinPromptGroup, quickActionsOpen]);\n'''
    if modal_input_effect not in text:
        text = replace_once(text, anchor, modal_input_effect + anchor, "Guide modal input ownership")

    text = replace_once(
        text,
        'previewId={safePreviewMode === "off" || drawerOpen || groupDrawerOpen || !!activeProgram || !isFocused ? null : previewId}',
        'previewId={safePreviewMode === "off" || drawerOpen || groupDrawerOpen || !!activeProgram || !!pinPromptGroup || quickActionsOpen || !isFocused ? null : previewId}',
        "Guide modal preview disarm",
    )
    text = replace_once(
        text,
        'active={isFocused && !activeProgram && !drawerOpen && !groupDrawerOpen && !previewActionsFocused}',
        'active={isFocused && !activeProgram && !pinPromptGroup && !quickActionsOpen && !drawerOpen && !groupDrawerOpen && !previewActionsFocused}',
        "Guide modal native input disarm",
    )
    path.write_text(text, encoding="utf-8")


patch_quick_actions()
patch_guide()
print("Guide modal/preview/input ownership repair applied")
