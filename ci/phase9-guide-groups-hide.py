from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:140]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# ----- Guide: dedicated group drawer + custom groups + long OK favorite. -----
replace(
    'frontend/app/(tabs)/guide.tsx',
    '  ActivityIndicator,\n  Pressable,',
    '  ActivityIndicator,\n  DeviceEventEmitter,\n  Pressable,',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    'import { NativeGuideCanvas } from "@/src/components/NativeGuideCanvas";\n',
    'import { NativeGuideCanvas } from "@/src/components/NativeGuideCanvas";\nimport { PurpleGuideGroupDrawer } from "@/src/components/PurpleGuideGroupDrawer";\n',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '  resetGuideSelection,\n  setGuideFocusedProgram,\n  useGuideSelection,\n} from "@/src/core/guideSelectionStore";',
    '  getGuideSelection,\n  resetGuideSelection,\n  setGuideFocusedProgram,\n  useGuideSelection,\n} from "@/src/core/guideSelectionStore";',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    'import { GUIDE_START_LAST_USED, useGuideUiPreferences } from "@/src/core/guideUiPreferences";\n',
    'import { GUIDE_START_LAST_USED, useGuideUiPreferences } from "@/src/core/guideUiPreferences";\nimport { useCustomGuideGroups } from "@/src/core/customGuideGroups";\n',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    'import { setGuideNavigationActive, setGuideRepeatInterval } from "@/src/utils/tvRemote";',
    'import { addTvLongPressListener, setGuideNavigationActive, setGuideRepeatInterval, setRemoteContext } from "@/src/utils/tvRemote";',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '  const { drawerOpen, openDrawer, closeDrawer } = usePurpleTvDrawer();\n',
    '  const { drawerOpen, openDrawer, closeDrawer } = usePurpleTvDrawer();\n  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);\n',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '    setMutePreview,\n  } = useGuideUiPreferences();\n  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();',
    '    setMutePreview,\n    showProviderGroups,\n    hiddenGroups,\n  } = useGuideUiPreferences();\n  const customGuideGroups = useCustomGuideGroups();\n  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '      setGuideScreenActive(true);\n      setGuideNavigationActive(true);',
    '      setGuideScreenActive(true);\n      setRemoteContext("guide");\n      setGuideNavigationActive(true);',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '        setGuideScreenActive(false);\n        setGuideNavigationActive(false);',
    '        setGuideScreenActive(false);\n        setGuideNavigationActive(false);\n        setRemoteContext("default");',
)

old_back = '''  // Guide Back behavior: when the Guide owns the remote and no\n  // modal is blocking, one Back opens the group/navigation drawer immediately.\n  // The drawer itself consumes the next Back to close and Guide focus is restored\n  // through the native logical session-channel restoration path.\n  useTvBackHandler(\n    useCallback(() => {\n      if (drawerOpen || activeProgram) return false;\n      openDrawer();\n      return true;\n    }, [activeProgram, drawerOpen, openDrawer]),\n  );'''
new_back = '''  // Phase 9 navigation ladder: Guide -> Groups drawer -> Main drawer.\n  // Native remote ownership consumes group-drawer boundary keys, so the Guide\n  // cannot also move underneath the drawer.\n  useTvBackHandler(\n    useCallback(() => {\n      if (drawerOpen || activeProgram) return false;\n      if (groupDrawerOpen) {\n        setGroupDrawerOpen(false);\n        openDrawer();\n        return true;\n      }\n      setGroupDrawerOpen(true);\n      return true;\n    }, [activeProgram, drawerOpen, groupDrawerOpen, openDrawer]),\n  );\n\n  useEffect(() => {\n    if (!isFocused) return;\n    const sub = DeviceEventEmitter.addListener("CharmGuideGroupsRequestOpen", () => {\n      closeDrawer();\n      setGroupDrawerOpen(true);\n    });\n    return () => sub.remove();\n  }, [closeDrawer, isFocused]);\n\n  useEffect(() => {\n    if (!isFocused || drawerOpen || groupDrawerOpen || activeProgram) return;\n    return addTvLongPressListener((key) => {\n      if (key !== "SELECT") return;\n      const channelId = getGuideSelection().channelId || guideSessionChannelId;\n      if (channelId) toggleFavorite(channelId);\n    });\n  }, [activeProgram, drawerOpen, groupDrawerOpen, isFocused, toggleFavorite]);'''
replace('frontend/app/(tabs)/guide.tsx', old_back, new_back)

replace(
    'frontend/app/(tabs)/guide.tsx',
    '        hiddenIds: hiddenIdSet,\n      }),',
    '        hiddenIds: hiddenIdSet,\n        customGroups: customGuideGroups.byName,\n      }),',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '    [channels, favoriteSet, recentIdSet, hiddenIdSet, failedCount, epgGuideFilter],',
    '    [channels, favoriteSet, recentIdSet, hiddenIdSet, failedCount, epgGuideFilter, customGuideGroups.byName],',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '''      buildVisibleGroups({\n        counts: groupCounts,\n        pinned: pinnedGroups,\n        playlistGroups,\n        maxPlaylistTabs: 10,\n      }),\n    [groupCounts, pinnedGroups, playlistGroups],''',
    '''      buildVisibleGroups({\n        counts: groupCounts,\n        pinned: pinnedGroups,\n        playlistGroups,\n        customGroups: customGuideGroups.groups.map((item) => item.name),\n        hiddenGroups: new Set(hiddenGroups),\n        showProviderGroups,\n        maxPlaylistTabs: 10,\n      }),\n    [customGuideGroups.groups, groupCounts, hiddenGroups, pinnedGroups, playlistGroups, showProviderGroups],''',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '      customOrder,\n    });',
    '      customOrder,\n      customGroups: customGuideGroups.byName,\n    });',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '  }, [channels, customOrder, epgGuideFilter, favoriteSet, group, hiddenIdSet, recent, recentIdSet]);',
    '  }, [channels, customGuideGroups.byName, customOrder, epgGuideFilter, favoriteSet, group, hiddenIdSet, recent, recentIdSet]);',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '    setPreviewId(null);\n    setResetToken((value) => value + 1);\n    closeDrawer();',
    '    setPreviewId(null);\n    setResetToken((value) => value + 1);\n    setGroupDrawerOpen(false);\n    closeDrawer();',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '''  const onGuideLeftBoundary = useCallback(() => {\n    // From the left-most channel/logo column, another Left enters the drawer.\n    // Do not focus the preview rail first: group navigation is the Guide's\n    // deterministic left boundary and the active group receives drawer focus.\n    if (!drawerOpen && !activeProgram) openDrawer();\n  }, [activeProgram, drawerOpen, openDrawer]);''',
    '''  const onGuideLeftBoundary = useCallback(() => {\n    // Guide -> dedicated groups drawer. The main application drawer is one\n    // additional Left/Back away and never shares focus ownership with the grid.\n    if (!drawerOpen && !groupDrawerOpen && !activeProgram) setGroupDrawerOpen(true);\n  }, [activeProgram, drawerOpen, groupDrawerOpen]);''',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '      guideGroups={drawerGroups}\n',
    '',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '      <View style={styles.page}>\n        <EpgProgressBar />',
    '''      <View style={styles.page}>\n        <PurpleGuideGroupDrawer\n          open={groupDrawerOpen}\n          groups={drawerGroups}\n          onCloseToGuide={() => setGroupDrawerOpen(false)}\n          onOpenMainDrawer={() => {\n            setGroupDrawerOpen(false);\n            openDrawer();\n          }}\n        />\n        <EpgProgressBar />''',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '              previewId={safePreviewMode === "off" || drawerOpen || !!activeProgram || !isFocused ? null : previewId}',
    '              previewId={safePreviewMode === "off" || drawerOpen || groupDrawerOpen || !!activeProgram || !isFocused ? null : previewId}',
)

# ----- Main drawer remote ownership / Right returns to Guide Groups. -----
replace(
    'frontend/src/components/PurpleTvShell.tsx',
    'import { useTvCalibration } from "@/src/tvCalibration";\n',
    'import { useTvCalibration } from "@/src/tvCalibration";\nimport { addTvKeyListener, setGuideNavigationActive, setRemoteContext } from "@/src/utils/tvRemote";\n',
)
anchor = '''  const [drawerAutoFocus, setDrawerAutoFocus] = useState(drawerOpen);\n  const [drawerPreferredRoute, setDrawerPreferredRoute] = useState<Route | null>(drawerOpen ? active : null);\n'''
insert = anchor + '''\n  useEffect(() => {\n    if (!drawerOpen) return;\n    setRemoteContext("main_drawer");\n    if (active === "/guide") setGuideNavigationActive(false);\n    const off = active === "/guide"\n      ? addTvKeyListener((key) => {\n          if (key !== "RIGHT") return;\n          closeDrawer();\n          DeviceEventEmitter.emit("CharmGuideGroupsRequestOpen");\n        })\n      : () => undefined;\n    return () => {\n      off();\n      if (active === "/guide") {\n        setRemoteContext("guide");\n        setGuideNavigationActive(true);\n      } else {\n        setRemoteContext("default");\n      }\n    };\n  }, [active, closeDrawer, drawerOpen]);\n'''
replace('frontend/src/components/PurpleTvShell.tsx', anchor, insert)

# ----- Settings: every channel reachable, bounded 100-row pages, group manager link. -----
replace(
    'frontend/app/(tabs)/settings.tsx',
    '  const [focusedCustomizeId, setFocusedCustomizeId] = useState<string | null>(null);',
    '  const [focusedCustomizeId, setFocusedCustomizeId] = useState<string | null>(null);\n  const [channelEditPage, setChannelEditPage] = useState(0);',
)
replace(
    'frontend/app/(tabs)/settings.tsx',
    '  const customizeChannels = useMemo(() => channels.slice(0, 30), [channels]);',
    '  const channelEditPageCount = Math.max(1, Math.ceil(channels.length / 100));\n  const customizeChannels = useMemo(() => channels.slice(channelEditPage * 100, channelEditPage * 100 + 100), [channelEditPage, channels]);',
)
replace(
    'frontend/app/(tabs)/settings.tsx',
    '                  Cap of 30 rows for TV memory. Focus a channel, then Hide, Move, or set a custom number. Clear custom order resets sort.',
    '                  All channels are available in 100-row pages so very large playlists stay memory-safe. Focus a channel, then Hide, Move, or set a custom number.',
)
replace(
    'frontend/app/(tabs)/settings.tsx',
    '''                <Action\n                  label="Clear custom order"''',
    '''                <Action label="Manage Guide groups & tabs" icon="albums-outline" onPress={() => router.push("/group-settings" as any)} />\n                <View style={styles.backupActions}>\n                  <Action label="Previous 100" icon="chevron-up-outline" disabled={channelEditPage <= 0} onPress={() => { setFocusedCustomizeId(null); setChannelEditPage((value) => Math.max(0, value - 1)); }} />\n                  <InfoRow label="Channel page" value={`${channelEditPage + 1} / ${channelEditPageCount}`} />\n                  <Action label="Next 100" icon="chevron-down-outline" disabled={channelEditPage + 1 >= channelEditPageCount} onPress={() => { setFocusedCustomizeId(null); setChannelEditPage((value) => Math.min(channelEditPageCount - 1, value + 1)); }} />\n                </View>\n                <Action\n                  label="Clear custom order"''',
)
replace(
    'frontend/app/(tabs)/settings.tsx',
    '                  const displayNumber = customNumber || index + 1;',
    '                  const displayNumber = customNumber || channelEditPage * 100 + index + 1;',
)

# ----- EPG/Guide settings entry for group manager/provider visibility. -----
replace(
    'frontend/app/(tabs)/epg-sources.tsx',
    '              <Text style={styles.help}>Choose which Guide group opens first on a normal Guide entry. Last used keeps your previous Guide tab. Search and returning from fullscreen always open on the requested/current channel instead.</Text>',
    '              <Text style={styles.help}>Choose which Guide group opens first on a normal Guide entry. Last used keeps your previous Guide tab. Search and returning from fullscreen always open on the requested/current channel instead.</Text>\n              <ToggleRow label="Show raw provider/M3U groups" value={guideUi.showProviderGroups} onChange={guideUi.setShowProviderGroups} />\n              <Text style={styles.help}>Off keeps provider categories hidden while Charm still uses their names internally to classify channels into Sports, News, Movies, Kids, Entertainment and Miscellaneous.</Text>\n              <Action label="Manage Guide groups & custom tabs" icon="albums-outline" onPress={() => router.push("/group-settings" as any)} />',
)

print('phase9 guide groups/hide patch complete')
