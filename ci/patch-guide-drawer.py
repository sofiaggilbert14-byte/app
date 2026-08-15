from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def sub_once(text, pattern, repl, label, flags=0):
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 replacement, got {count}")
    return out

# PurpleTvShell: expose a Guide-specific group list inside the drawer and focus the active group.
path = "frontend/src/components/PurpleTvShell.tsx"
text = read(path)
text = text.replace("  Pressable,\n  StyleSheet,", "  Pressable,\n  ScrollView,\n  StyleSheet,")
text = text.replace(
    "export type PurpleRecentChannel = {\n",
    "export type PurpleGuideGroup = {\n  name: string;\n  count?: number;\n  active?: boolean;\n  pinned?: boolean;\n  onPress: () => void;\n  onLongPress?: () => void;\n};\n\nexport type PurpleRecentChannel = {\n",
)
text = text.replace("  contextActions,\n  watchingChannelId,", "  contextActions,\n  guideGroups,\n  watchingChannelId,")
text = text.replace("  contextActions?: PurpleContextAction[];\n  watchingChannelId?:", "  contextActions?: PurpleContextAction[];\n  guideGroups?: PurpleGuideGroup[];\n  watchingChannelId?:")
text = text.replace("  const navRefs = useRef(new Map<Route, unknown>());", "  const navRefs = useRef(new Map<Route, unknown>());\n  const guideGroupRefs = useRef(new Map<string, unknown>());")
old = '''    setContentAutoFocus(false);\n    const preferredRoute: Route = focusDrawerTop ? NAV[0].route : active;\n    if (focusDrawerTop) consumeFocusDrawerTop();\n    setDrawerPreferredRoute(preferredRoute);\n    setDrawerAutoFocus(true);\n    const clearPreferred = setTimeout(() => {\n      setDrawerAutoFocus(false);\n      setDrawerPreferredRoute(null);\n    }, 700);\n    const cancelFocus = requestNativeFocusWithRetry(\n      navRefs.current.get(preferredRoute),\n      [0, PURPLE_DRAWER_ANIMATION_MS, 280, 420, 650],\n    );'''
new = '''    setContentAutoFocus(false);\n    const preferredGuideGroup =\n      !focusDrawerTop && active === "/guide" ? guideGroups?.find((item) => item.active) : undefined;\n    const preferredRoute: Route | null = preferredGuideGroup\n      ? null\n      : focusDrawerTop\n        ? NAV[0].route\n        : active;\n    if (focusDrawerTop) consumeFocusDrawerTop();\n    setDrawerPreferredRoute(preferredRoute);\n    setDrawerAutoFocus(true);\n    const clearPreferred = setTimeout(() => {\n      setDrawerAutoFocus(false);\n      setDrawerPreferredRoute(null);\n    }, 700);\n    const preferredNode = preferredGuideGroup\n      ? guideGroupRefs.current.get(preferredGuideGroup.name)\n      : preferredRoute\n        ? navRefs.current.get(preferredRoute)\n        : null;\n    const cancelFocus = requestNativeFocusWithRetry(\n      preferredNode,\n      [0, PURPLE_DRAWER_ANIMATION_MS, 280, 420, 650],\n    );'''
if old not in text:
    raise SystemExit("PurpleTvShell focus block not found")
text = text.replace(old, new)
text = text.replace(
    "  }, [active, activeProgram, consumeFocusDrawerTop, drawerOpen, focusDrawerTop]);",
    "  }, [active, activeProgram, consumeFocusDrawerTop, drawerOpen, focusDrawerTop, guideGroups]);",
)
marker = '''          {recentStrip.length > 0 ? (\n            <View style={styles.recentStrip}>'''
insert = '''          {active === "/guide" && guideGroups?.length ? (\n            <View style={styles.guideGroupSection}>\n              <Text style={styles.guideGroupLabel}>Groups</Text>\n              <ScrollView\n                style={styles.guideGroupList}\n                contentContainerStyle={styles.guideGroupListContent}\n                showsVerticalScrollIndicator={false}\n              >\n                {guideGroups.map((item) => (\n                  <Pressable\n                    key={item.name}\n                    ref={(node) => {\n                      if (node) guideGroupRefs.current.set(item.name, node);\n                      else guideGroupRefs.current.delete(item.name);\n                    }}\n                    focusable={drawerOpen}\n                    hasTVPreferredFocus={drawerAutoFocus && drawerPreferredRoute === null && !!item.active}\n                    onPress={item.onPress}\n                    onLongPress={item.onLongPress}\n                    delayLongPress={420}\n                    style={({ focused }: any) => [\n                      styles.guideGroupRow,\n                      item.active && styles.guideGroupRowActive,\n                      item.pinned && styles.guideGroupRowPinned,\n                      focused && styles.navRowFocused,\n                    ]}\n                    testID={`purple-guide-group-${item.name.toLowerCase().replace(/\\s+/g, "-")}`}\n                  >\n                    <Text numberOfLines={1} style={[styles.guideGroupText, item.active && styles.guideGroupTextActive]}>\n                      {item.name}\n                    </Text>\n                    {item.count ? <Text style={styles.guideGroupCount}>{item.count}</Text> : null}\n                  </Pressable>\n                ))}\n              </ScrollView>\n            </View>\n          ) : null}\n          {recentStrip.length > 0 ? (\n            <View style={styles.recentStrip}>'''
if marker not in text:
    raise SystemExit("PurpleTvShell recent marker not found")
text = text.replace(marker, insert)
style_marker = '''  recentStrip: {\n    marginBottom: 8,'''
style_insert = '''  guideGroupSection: {\n    maxHeight: "38%",\n    marginBottom: 8,\n    paddingBottom: 6,\n    borderBottomWidth: 1,\n    borderBottomColor: tvColors.line,\n  },\n  guideGroupLabel: {\n    color: tvColors.textMuted,\n    fontFamily: fonts.semibold,\n    fontSize: 8,\n    letterSpacing: 0.6,\n    paddingHorizontal: 6,\n    paddingBottom: 4,\n    textTransform: "uppercase",\n  },\n  guideGroupList: { maxHeight: 190 },\n  guideGroupListContent: { gap: 2 },\n  guideGroupRow: {\n    minHeight: 30,\n    borderRadius: radius.sm,\n    borderWidth: 2,\n    borderColor: "transparent",\n    flexDirection: "row",\n    alignItems: "center",\n    gap: 6,\n    paddingHorizontal: 9,\n  },\n  guideGroupRowActive: { backgroundColor: tvColors.purple },\n  guideGroupRowPinned: { borderLeftColor: tvColors.purpleBright },\n  guideGroupText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10, flex: 1 },\n  guideGroupTextActive: { color: "#fff", fontFamily: fonts.semibold },\n  guideGroupCount: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },\n  recentStrip: {\n    marginBottom: 8,'''
if style_marker not in text:
    raise SystemExit("PurpleTvShell style marker not found")
text = text.replace(style_marker, style_insert)
write(path, text)

# Guide: remove the header/vertical group bar and More Groups overlay; feed groups to the drawer.
path = "frontend/app/(tabs)/guide.tsx"
text = read(path)
text = text.replace("import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from \"react\";", "import React, { useCallback, useEffect, useMemo, useRef, useState } from \"react\";")
text = text.replace("  Animated,\n", "")
text = text.replace("  ScrollView,\n", "")
text = text.replace(
    '''import {\n  PurpleTvShell,\n  PURPLE_DRAWER_ANIMATION_MS,\n  usePurpleTvDrawer,\n} from "@/src/components/PurpleTvShell";''',
    '''import {\n  PurpleTvShell,\n  usePurpleTvDrawer,\n  type PurpleGuideGroup,\n} from "@/src/components/PurpleTvShell";''',
)
text = text.replace("  registerGuideTopEntry,\n", "")
text = text.replace("let guideSessionChannelId: string | null = null;", "let guideSessionChannelId: string | null = null;\nconst guideSessionChannelByGroup = new Map<string, string>();")
text = sub_once(
    text,
    r'\nfunction chipLabel\(name: string\): string \{.*?\n\}\);\n\n/\*\*\n \* The only Guide subtree',
    '\n/**\n * The only Guide subtree',
    "remove GuideGroupChip",
    flags=re.S,
)
text = text.replace("    groupLayout,\n", "")
text = text.replace("  const [moreGroupsOpen, setMoreGroupsOpen] = useState(false);\n", "")
text = sub_once(
    text,
    r'  const groupChipRefs = useRef\(new Map<string, any>\(\)\);\n  const moreGroupsChipRef = useRef<any>\(null\);\n  const setMoreGroupsChipRef = useCallback\(\(node: any\) => \{.*?\n  const focusMoreGroupsChip = useCallback\(\(\) => \{.*?\n  \}, \[\]\);\n',
    '',
    "remove group refs",
    flags=re.S,
)
text = text.replace("  const previousDrawerOpenRef = useRef(drawerOpen);\n", "")
text = text.replace("  const headerTitleProgress = useRef(new Animated.Value(drawerOpen ? 1 : 0)).current;\n", "")
text = text.replace("  const groupSlideX = useRef(new Animated.Value(0)).current;\n", "")
text = text.replace("      headerTitleProgress.stopAnimation();\n      groupSlideX.stopAnimation();\n", "")
text = text.replace("    [groupSlideX, headerTitleProgress],\n", "    [],\n")
text = sub_once(
    text,
    r'\n  useEffect\(\(\) => \{\n    if \(previousDrawerOpenRef\.current !== drawerOpen\).*?\n  \}, \[drawerOpen, groupSlideX, headerTitleProgress, instantGuide\]\);\n',
    '\n',
    "remove group header animation",
    flags=re.S,
)
old_apply = '''  const applyGroup = useCallback((next: string) => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    if (previewTimer.current) clearTimeout(previewTimer.current);\n    groupChangedAt.current = Date.now();\n    guideSessionGroup = next;\n    guideSessionChannelId = null;\n    setGroup(next);\n    resetGuideSelection(null);\n    setPreviewId(null);\n    setMoreGroupsOpen(false);\n    // Scroll/filter reset only — never reclaim grid preferred focus (keeps chip focused).\n    setResetToken((value) => value + 1);\n    // Re-assert focus on the chip the user pressed after the list swaps.\n    requestAnimationFrame(() => {\n      const chip = groupChipRefs.current.get(next);\n      if (chip) requestNativeFocus(chip);\n    });\n  }, []);'''
new_apply = '''  const applyGroup = useCallback((next: string) => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    if (previewTimer.current) clearTimeout(previewTimer.current);\n    groupChangedAt.current = Date.now();\n    if (guideSessionChannelId) guideSessionChannelByGroup.set(group, guideSessionChannelId);\n    const rememberedChannelId = guideSessionChannelByGroup.get(next) || null;\n    guideSessionGroup = next;\n    guideSessionChannelId = rememberedChannelId;\n    setGroup(next);\n    resetGuideSelection(rememberedChannelId);\n    setPreviewId(null);\n    setResetToken((value) => value + 1);\n  }, [group]);'''
if old_apply not in text:
    raise SystemExit("applyGroup block not found")
text = text.replace(old_apply, new_apply)
text = text.replace(
    '''  const onFocusChannel = useCallback((channel: Channel) => {\n    // Logo/card focus represents the live row rather than a previously selected\n    // programme. Only the preview subtree subscribes to this external update.\n    resetGuideSelection(channel.id);\n    armPreviewForChannel(channel);\n  }, [armPreviewForChannel]);''',
    '''  const onFocusChannel = useCallback((channel: Channel) => {\n    guideSessionChannelId = channel.id;\n    guideSessionChannelByGroup.set(group, channel.id);\n    resetGuideSelection(channel.id);\n    armPreviewForChannel(channel);\n  }, [armPreviewForChannel, group]);''',
)
text = text.replace(
    '''  const onFocusProgram = useCallback((program: Program, channel: Channel) => {\n    guideSessionChannelId = channel.id;\n    setGuideFocusedProgram(channel.id, program);\n    armPreviewForChannel(channel);\n  }, [armPreviewForChannel]);''',
    '''  const onFocusProgram = useCallback((program: Program, channel: Channel) => {\n    guideSessionChannelId = channel.id;\n    guideSessionChannelByGroup.set(group, channel.id);\n    setGuideFocusedProgram(channel.id, program);\n    armPreviewForChannel(channel);\n  }, [armPreviewForChannel, group]);''',
)
text = sub_once(
    text,
    r'\n  const onGuideUpBoundary = useCallback\(\(\) => \{.*?\n  \}, \[group\]\);',
    '\n  const onGuideUpBoundary = useCallback(() => {\n    // No top group bar anymore; keep focus in the guide instead of jumping upward.\n  }, []);',
    "replace up boundary",
    flags=re.S,
)
text = sub_once(
    text,
    r'\n  const rememberGroupChipNode = useCallback\(.*?\n  \);\n\n  return \(',
    '''\n  const drawerGroups = useMemo<PurpleGuideGroup[]>(() => {\n    const names = Array.from(new Set([...groups, ...overflowGroups]));\n    return names.map((name) => ({\n      name,\n      count: groupCounts[name] || 0,\n      active: group === name,\n      pinned: pinnedGroups.includes(name),\n      onPress: () => chooseGroup(name),\n      onLongPress: () => togglePinGroup(name),\n    }));\n  }, [chooseGroup, group, groupCounts, groups, overflowGroups, pinnedGroups, togglePinGroup]);\n\n  return (''',
    "replace group render helpers",
    flags=re.S,
)
text = text.replace(
    '''    <PurpleTvShell\n      active="/guide"\n      watchingChannelId={lastChannelId}\n    >''',
    '''    <PurpleTvShell\n      active="/guide"\n      watchingChannelId={lastChannelId}\n      guideGroups={drawerGroups}\n    >''',
)
text = sub_once(
    text,
    r'\n        <View style=\{styles\.header\}>.*?\n        </View>\n\n        <EpgProgressBar />',
    '\n        <EpgProgressBar />',
    "remove guide header group bar",
    flags=re.S,
)
text = sub_once(
    text,
    r'\n            \{groupLayout === "vertical" \? \(.*?\n            \) : null\}\n\n            <GuideSelectionPreview',
    '\n            <GuideSelectionPreview',
    "remove vertical groups",
    flags=re.S,
)
text = sub_once(
    text,
    r'\n        \{moreGroupsOpen \? \(.*?\n        \) : null\}\n\n        \{pinPromptGroup \?',
    '\n        {pinPromptGroup ?',
    "remove more groups overlay",
    flags=re.S,
)
# Remove obsolete style entries for the deleted bar/overlay. Keep overlay + overlayTitle for PIN.
for key in [
    "header", "guideTitleBlock", "groupScroller", "kicker", "title", "groupRow", "groupChip", "groupChipVertical",
    "groupChipActive", "groupChipPinned", "groupText", "groupTextActive", "verticalHeaderHint", "verticalGroups",
    "verticalGroupList", "overlayCard", "overlayHeader", "overlayClose", "overlayList", "overlayLetter", "overlayRow", "overlayRowText",
]:
    text = re.sub(rf'\n  {key}: \{{.*?\n  \}},', '', text, count=1, flags=re.S)
# Reclaim the header space: tighter page padding/gap while retaining safe shell insets.
text = text.replace('  page: { flex: 1, padding: 12, gap: 5 },', '  page: { flex: 1, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 3 },')
write(path, text)

# Guide UI prefs: group layout is no longer a user setting because groups live in the drawer.
path = "frontend/src/core/guideUiPreferences.ts"
text = read(path)
text = text.replace('export type GuideGroupLayout = "horizontal" | "vertical";\n\n', '')
text = text.replace('const LAYOUT_KEY = "gs_guide_group_layout";\n', '')
text = text.replace('  groupLayout: GuideGroupLayout;\n', '')
text = text.replace('  groupLayout: "horizontal",\n', '')
text = text.replace('    const layout = await storage.getItem<GuideGroupLayout>(LAYOUT_KEY, "horizontal");\n', '')
text = text.replace('      groupLayout: layout === "vertical" ? "vertical" : "horizontal",\n', '')
text = sub_once(text, r'\nexport async function setGuideGroupLayout\(.*?\n\}\n', '\n', 'remove setGuideGroupLayout', flags=re.S)
text = text.replace('  setGroupLayout: (next: GuideGroupLayout) => void;\n', '')
text = sub_once(text, r'\n    setGroupLayout: useCallback\(.*?\n    \}, \[\]\),', '', 'remove hook setGroupLayout', flags=re.S)
write(path, text)

# Settings: delete the obsolete group-layout choice.
path = "frontend/app/(tabs)/settings.tsx"
text = read(path)
text = sub_once(
    text,
    r'\n                <ChoiceRow<"horizontal" \| "vertical">\n                  label="Group layout".*?\n                />',
    '',
    'remove settings group layout',
    flags=re.S,
)
write(path, text)

# Drawer should be group-centric, not a Recent pseudo-group. Recent channels remain available elsewhere.
path = "frontend/src/core/guideGroups.ts"
text = read(path)
text = text.replace('  "Recently Watched",\n', '')
write(path, text)
