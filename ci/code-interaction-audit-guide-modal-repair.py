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
        'import { addTvQuickActionsListener, emitPlayerQuickCommand, resetRemoteContextIfOwned, setRemoteContext, type PlayerQuickCommand, type TvQuickActionsContext } from "@/src/utils/tvRemote";',
        'import { addTvQuickActionsListener, emitPlayerQuickCommand, resetRemoteContextIfOwned, setGuideNavigationActive, setRemoteContext, type PlayerQuickCommand, type TvQuickActionsContext } from "@/src/utils/tvRemote";',
        "Quick Actions Guide navigation ownership import",
    )
    text = replace_once(
        text,
        "    setBusy(false);\n    openPathRef.current = null;",
        "    setBusy(false);\n    DeviceEventEmitter.emit(\"CharmQuickActionsVisibility\", false);\n    openPathRef.current = null;",
        "Quick Actions close visibility",
    )
    text = replace_once(
        text,
        '    resetRemoteContextIfOwned("modal", restore);',
        '    const restored = resetRemoteContextIfOwned("modal", restore);\n    if (restored && restore === "guide") setGuideNavigationActive(true);',
        "Quick Actions Guide page-key restore",
    )
    text = replace_once(
        text,
        "    openPathRef.current = pathname || \"\";\n    setOpen(true);\n    setRemoteContext(\"modal\");",
        "    openPathRef.current = pathname || \"\";\n    DeviceEventEmitter.emit(\"CharmQuickActionsVisibility\", true);\n    setOpen(true);\n    if (nextContext === \"guide\") setGuideNavigationActive(false);\n    setRemoteContext(\"modal\");",
        "Quick Actions open visibility and Guide page-key disarm",
    )
    cleanup = '''\n  useEffect(() => () => {\n    DeviceEventEmitter.emit("CharmQuickActionsVisibility", false);\n  }, []);\n'''
    anchor = '''\n  useEffect(() => {\n    if (!open) return;\n    const openedPath = openPathRef.current;'''
    if cleanup not in text:
        text = replace_once(text, anchor, cleanup + anchor, "Quick Actions visibility unmount cleanup")
    path.write_text(text, encoding="utf-8")


def patch_program_modal() -> None:
    path = Path("frontend/src/components/ProgramModal.tsx")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";',
        'import { resetRemoteContextIfOwned, setGuideNavigationActive, setRemoteContext } from "@/src/utils/tvRemote";',
        "Program modal Guide navigation ownership import",
    )
    text = replace_once(
        text,
        '''  React.useEffect(() => {\n    if (!activeProgram) return;\n    setRemoteContext("modal");\n    return () => {\n      const restore = pathname?.startsWith("/player")\n        ? "player"\n        : pathname?.startsWith("/guide")\n          ? "guide"\n          : "default";\n      resetRemoteContextIfOwned("modal", restore);\n    };\n  }, [activeProgram, pathname]);''',
        '''  React.useEffect(() => {\n    if (!activeProgram) return;\n    if (pathname?.startsWith("/guide")) setGuideNavigationActive(false);\n    setRemoteContext("modal");\n    return () => {\n      const restore = pathname?.startsWith("/player")\n        ? "player"\n        : pathname?.startsWith("/guide")\n          ? "guide"\n          : "default";\n      const restored = resetRemoteContextIfOwned("modal", restore);\n      if (restored && restore === "guide") setGuideNavigationActive(true);\n    };\n  }, [activeProgram, pathname]);''',
        "Program Details modal Guide page-key ownership",
    )
    path.write_text(text, encoding="utf-8")


def patch_guide() -> None:
    path = Path("frontend/app/(tabs)/guide.tsx")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "  ActivityIndicator,\n  DeviceEventEmitter,",
        "  ActivityIndicator,\n  BackHandler,\n  DeviceEventEmitter,",
        "Guide PIN BackHandler import",
    )
    text = replace_once(
        text,
        "  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);\n  const { width: screenWidth, height: screenHeight } = useWindowDimensions();",
        "  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);\n  const [quickActionsOpen, setQuickActionsOpen] = useState(false);\n  const { width: screenWidth, height: screenHeight } = useWindowDimensions();",
        "Guide Quick Actions visibility state",
    )
    text = replace_once(
        text,
        "  const modalOriginRef = useRef<{ channelId: string; programStart: string } | null>(null);\n  const orderedFilteredIdsRef",
        "  const modalOriginRef = useRef<{ channelId: string; programStart: string } | null>(null);\n  const pinModalOwnedRef = useRef(false);\n  const pinReturnToGroupsRef = useRef(false);\n  const orderedFilteredIdsRef",
        "Guide PIN modal ownership refs",
    )

    effect = '''\n  useEffect(() => {\n    if (!isFocused) {\n      setQuickActionsOpen(false);\n      return;\n    }\n    const sub = DeviceEventEmitter.addListener("CharmQuickActionsVisibility", (open: boolean) => {\n      setQuickActionsOpen(!!open);\n    });\n    return () => {\n      sub.remove();\n      setQuickActionsOpen(false);\n    };\n  }, [isFocused]);\n'''
    anchor = '''\n  useEffect(() => {\n    if (!isFocused) return;\n    const sub = DeviceEventEmitter.addListener("CharmGuideGroupsRequestOpen", () => {'''
    if effect not in text:
        text = replace_once(text, anchor, effect + anchor, "Guide Quick Actions visibility listener")

    modal_input_effect = '''\n  useEffect(() => {\n    // TiViMate-style window ownership: an overlay that is visually on top must\n    // also be the only semantic key owner. Otherwise Channel/Page keys can move\n    // the hidden native Guide and held Select can reopen Guide actions underneath.\n    if (!isFocused) {\n      setGuideNavigationActive(false);\n      if (pinModalOwnedRef.current) {\n        pinModalOwnedRef.current = false;\n        pinReturnToGroupsRef.current = false;\n        resetRemoteContextIfOwned("modal", "default");\n      }\n      return;\n    }\n\n    if (quickActionsOpen || activeProgram || pinPromptGroup) {\n      setGuideNavigationActive(false);\n    }\n\n    if (pinPromptGroup) {\n      pinModalOwnedRef.current = true;\n      setRemoteContext("modal");\n      return;\n    }\n\n    if (!quickActionsOpen && !activeProgram && !drawerOpen && !groupDrawerOpen) {\n      setGuideNavigationActive(true);\n    }\n  }, [activeProgram, drawerOpen, groupDrawerOpen, isFocused, pinPromptGroup, quickActionsOpen]);\n'''
    if modal_input_effect not in text:
        text = replace_once(text, anchor, modal_input_effect + anchor, "Guide modal input ownership")

    old_group_block = '''  const chooseGroup = useCallback(\n    (next: string) => {\n      if (hasPin && isGroupLocked(next)) {\n        setPinPromptGroup(next);\n        setPinDigits("");\n        setPinError(false);\n        return;\n      }\n      applyGroup(next);\n    },\n    [applyGroup, hasPin, isGroupLocked],\n  );\n\n  const submitPin = useCallback(() => {\n    if (!pinPromptGroup) return;\n    if (!verifyPin(pinDigits)) {\n      setPinError(true);\n      setPinDigits("");\n      return;\n    }\n    unlockGroup(pinPromptGroup);\n    const next = pinPromptGroup;\n    setPinPromptGroup(null);\n    setPinDigits("");\n    setPinError(false);\n    applyGroup(next);\n  }, [applyGroup, pinDigits, pinPromptGroup, unlockGroup, verifyPin]);'''
    new_group_block = '''  const openPinPrompt = useCallback((next: string, returnToGroups: boolean) => {\n    // Claim the modal synchronously with the key action. The old group drawer\n    // must not stay mounted with a second FocusGuide underneath the PIN.\n    pinModalOwnedRef.current = true;\n    pinReturnToGroupsRef.current = returnToGroups;\n    setGuideNavigationActive(false);\n    setRemoteContext("modal");\n    if (previewTimer.current) {\n      clearTimeout(previewTimer.current);\n      previewTimer.current = null;\n    }\n    if (previewRecoverTimer.current) {\n      clearTimeout(previewRecoverTimer.current);\n      previewRecoverTimer.current = null;\n    }\n    if (surfReleaseTimer.current) {\n      clearTimeout(surfReleaseTimer.current);\n      surfReleaseTimer.current = null;\n    }\n    setPreviewId(null);\n    setPreviewActionsFocused(false);\n    if (returnToGroups) setGroupDrawerOpen(false);\n    setPinPromptGroup(next);\n    setPinDigits("");\n    setPinError(false);\n  }, []);\n\n  const closePinPrompt = useCallback((restoreGroups: boolean) => {\n    const returnToGroups = restoreGroups && pinReturnToGroupsRef.current;\n    pinReturnToGroupsRef.current = false;\n    pinModalOwnedRef.current = false;\n    setPinPromptGroup(null);\n    setPinDigits("");\n    setPinError(false);\n    if (returnToGroups) {\n      setGuideNavigationActive(false);\n      setRemoteContext("guide_groups");\n      setGroupDrawerOpen(true);\n      return;\n    }\n    const restored = resetRemoteContextIfOwned("modal", "guide");\n    if (restored) setGuideNavigationActive(true);\n  }, []);\n\n  useEffect(() => {\n    if (!pinPromptGroup) return;\n    const sub = BackHandler.addEventListener("hardwareBackPress", () => {\n      closePinPrompt(true);\n      return true;\n    });\n    return () => sub.remove();\n  }, [closePinPrompt, pinPromptGroup]);\n\n  const chooseGroup = useCallback(\n    (next: string) => {\n      if (hasPin && isGroupLocked(next)) {\n        openPinPrompt(next, groupDrawerOpen);\n        return;\n      }\n      applyGroup(next);\n    },\n    [applyGroup, groupDrawerOpen, hasPin, isGroupLocked, openPinPrompt],\n  );\n\n  const submitPin = useCallback(() => {\n    if (!pinPromptGroup) return;\n    if (!verifyPin(pinDigits)) {\n      setPinError(true);\n      setPinDigits("");\n      return;\n    }\n    unlockGroup(pinPromptGroup);\n    const next = pinPromptGroup;\n    closePinPrompt(false);\n    applyGroup(next);\n  }, [applyGroup, closePinPrompt, pinDigits, pinPromptGroup, unlockGroup, verifyPin]);'''
    text = replace_once(text, old_group_block, new_group_block, "Guide PIN focus-owner handoff")

    text = replace_once(
        text,
        '''      if (hasPin && isGroupLocked(nextGroup)) {\n        setPinPromptGroup(nextGroup);\n        setPinDigits("");\n        setPinError(false);\n        guideSessionChannelId = jump.channelId;\n        return;\n      }''',
        '''      if (hasPin && isGroupLocked(nextGroup)) {\n        openPinPrompt(nextGroup, false);\n        guideSessionChannelId = jump.channelId;\n        return;\n      }''',
        "Guide jump PIN modal handoff",
    )
    text = replace_once(
        text,
        '[channelById, hasPin, isGroupLocked, previewDelay, schedulePreview, surfSettleExtraMs]',
        '[channelById, hasPin, isGroupLocked, openPinPrompt, previewDelay, schedulePreview, surfSettleExtraMs]',
        "Guide jump PIN callback dependencies",
    )
    text = replace_once(
        text,
        '    }, [activeProgram, drawerOpen, groupDrawerOpen, openDrawer]),\n  );',
        '    }, [activeProgram, drawerOpen, groupDrawerOpen, openDrawer]),\n    !pinPromptGroup,\n  );',
        "disable generic Guide Back hierarchy while PIN owns Back",
    )
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
    text = replace_once(
        text,
        '<Pressable onPress={() => { setPinPromptGroup(null); setPinDigits(""); setPinError(false); }} style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}>',
        '<Pressable onPress={() => closePinPrompt(true)} style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}>',
        "Guide PIN cancel handoff",
    )
    text = replace_once(
        text,
        'overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", zIndex: 20, padding: 24 },',
        'overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", zIndex: 120, elevation: 120, padding: 24 },',
        "Guide PIN top-layer stacking",
    )
    path.write_text(text, encoding="utf-8")


patch_quick_actions()
patch_program_modal()
patch_guide()
print("Guide Quick Actions/PIN/Program Details modal ownership repair applied")
