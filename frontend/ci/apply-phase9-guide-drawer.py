from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one anchor, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


guide = ROOT / "app/(tabs)/guide.tsx"
replace_once(
    guide,
    'import { GuidePreviewRail } from "@/src/components/GuidePreviewRail";\n',
    'import { GuidePreviewRail } from "@/src/components/GuidePreviewRail";\nimport { GuideGroupDrawer } from "@/src/components/GuideGroupDrawer";\n',
)
replace_once(
    guide,
    '  resetGuideSelection,\n  setGuideFocusedProgram,\n  useGuideSelection,\n',
    '  getGuideSelection,\n  resetGuideSelection,\n  setGuideFocusedProgram,\n  useGuideSelection,\n',
)
replace_once(
    guide,
    'import { setGuideNavigationActive, setGuideRepeatInterval } from "@/src/utils/tvRemote";\n',
    'import { addTvLongPressListener, setGuideNavigationActive, setGuideRepeatInterval } from "@/src/utils/tvRemote";\nimport { claimRemoteOwner } from "@/src/core/remoteOwnership";\n',
)
replace_once(
    guide,
    '  useFocusEffect(\n    useCallback(() => {\n      setGuideScreenActive(true);\n      setGuideNavigationActive(true);\n      return () => {\n        setGuideScreenActive(false);\n        setGuideNavigationActive(false);\n      };\n    }, []),\n  );\n',
    '  useFocusEffect(\n    useCallback(() => {\n      setGuideScreenActive(true);\n      const releaseOwner = claimRemoteOwner("GUIDE");\n      return () => {\n        setGuideScreenActive(false);\n        setGuideNavigationActive(false);\n        releaseOwner();\n      };\n    }, []),\n  );\n',
)
replace_once(
    guide,
    '  const [group, setGroup] = useState(() => guideSessionGroup);\n',
    '  const [group, setGroup] = useState(() => guideSessionGroup);\n  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);\n',
)
replace_once(
    guide,
    '  useEffect(() => {\n    setGuideRepeatInterval(powerTuning.guideRepeatIntervalMs);\n  }, [powerTuning.guideRepeatIntervalMs]);\n',
    '  useEffect(() => {\n    setGuideRepeatInterval(powerTuning.guideRepeatIntervalMs);\n  }, [powerTuning.guideRepeatIntervalMs]);\n\n  // One navigation owner at a time: the native Guide only receives D-pad repeats\n  // while neither drawer owns focus.\n  useEffect(() => {\n    if (!isFocused) {\n      setGuideNavigationActive(false);\n      return;\n    }\n    setGuideNavigationActive(!drawerOpen && !groupDrawerOpen && !activeProgram);\n  }, [activeProgram, drawerOpen, groupDrawerOpen, isFocused]);\n\n  useEffect(() => {\n    if (!isFocused || !drawerOpen) return;\n    return claimRemoteOwner("MAIN_DRAWER");\n  }, [drawerOpen, isFocused]);\n',
)
replace_once(
    guide,
    '  const openGuideSources = useCallback(() => {\n    closeDrawer();\n    router.replace("/epg-sources" as any);\n  }, [closeDrawer, router]);\n',
    '  const openGuideSources = useCallback(() => {\n    setGroupDrawerOpen(false);\n    closeDrawer();\n    router.replace("/epg-sources" as any);\n  }, [closeDrawer, router]);\n\n  const closeGroupsToGuide = useCallback(() => {\n    setGroupDrawerOpen(false);\n  }, []);\n\n  const openMainDrawerFromGroups = useCallback(() => {\n    setGroupDrawerOpen(false);\n    requestAnimationFrame(() => openDrawer());\n  }, [openDrawer]);\n',
)
replace_once(
    guide,
    '  useTvBackHandler(\n    useCallback(() => {\n      if (drawerOpen || activeProgram) return false;\n      openDrawer();\n      return true;\n    }, [activeProgram, drawerOpen, openDrawer]),\n  );\n',
    '  useTvBackHandler(\n    useCallback(() => {\n      if (drawerOpen || groupDrawerOpen || activeProgram) return false;\n      setGroupDrawerOpen(true);\n      return true;\n    }, [activeProgram, drawerOpen, groupDrawerOpen]),\n  );\n\n  useEffect(() => {\n    if (!isFocused) return;\n    return addTvLongPressListener((key) => {\n      if (key !== "SELECT" || drawerOpen || groupDrawerOpen || activeProgram) return;\n      const focusedId = getGuideSelection().channelId || guideSessionChannelId;\n      if (!focusedId) return;\n      toggleFavorite(focusedId);\n      void Haptics.selectionAsync().catch(() => undefined);\n    });\n  }, [activeProgram, drawerOpen, groupDrawerOpen, isFocused, toggleFavorite]);\n',
)
replace_once(
    guide,
    '    setResetToken((value) => value + 1);\n    closeDrawer();\n  }, [closeDrawer, group]);\n',
    '    setResetToken((value) => value + 1);\n    setGroupDrawerOpen(false);\n    closeDrawer();\n  }, [closeDrawer, group]);\n',
)
replace_once(
    guide,
    '  const onGuideLeftBoundary = useCallback(() => {\n    // From the left-most channel/logo column, another Left enters the drawer.\n    // Do not focus the preview rail first: group navigation is the Guide\'s\n    // deterministic left boundary and the active group receives drawer focus.\n    if (!drawerOpen && !activeProgram) openDrawer();\n  }, [activeProgram, drawerOpen, openDrawer]);\n',
    '  const onGuideLeftBoundary = useCallback(() => {\n    // Guide -> Groups is the first left boundary. The main app drawer is one\n    // layer farther left and is opened from the dedicated Groups drawer.\n    if (!drawerOpen && !groupDrawerOpen && !activeProgram) setGroupDrawerOpen(true);\n  }, [activeProgram, drawerOpen, groupDrawerOpen]);\n',
)
replace_once(
    guide,
    '      watchingChannelId={lastChannelId}\n      guideGroups={drawerGroups}\n',
    '      watchingChannelId={lastChannelId}\n',
)
replace_once(
    guide,
    '    >\n      <View style={styles.page}>\n',
    '    >\n      <GuideGroupDrawer\n        open={groupDrawerOpen}\n        groups={drawerGroups}\n        onOpenMainDrawer={openMainDrawerFromGroups}\n        onCloseToGuide={closeGroupsToGuide}\n      />\n      <View style={styles.page}>\n',
)
replace_once(
    guide,
    '              previewId={safePreviewMode === "off" || drawerOpen || !!activeProgram || !isFocused ? null : previewId}\n',
    '              previewId={safePreviewMode === "off" || drawerOpen || groupDrawerOpen || !!activeProgram || !isFocused ? null : previewId}\n',
)
replace_once(
    guide,
    '                active={isFocused && !activeProgram && !drawerOpen}\n',
    '                active={isFocused && !activeProgram && !drawerOpen && !groupDrawerOpen}\n',
)

print("Phase 9 Guide drawer wiring applied")
