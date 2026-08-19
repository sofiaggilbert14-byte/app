from pathlib import Path

path = Path('frontend/app/(tabs)/guide.tsx')
text = path.read_text()

old = '  const [restoreTimeMs, setRestoreTimeMs] = useState<number | null>(null);\n'
new = old + '  // Explicit Search/player jumps may target a channel hidden by the saved Matched/Unmatched filter.\n  // Keep one session-only bypass row until the user manually navigates away; never rewrite the saved filter.\n  const [jumpFilterBypassId, setJumpFilterBypassId] = useState<string | null>(null);\n'
assert old in text, 'restoreTimeMs anchor missing'
text = text.replace(old, new, 1)

old = '''    if (epgGuideFilter === "all") return list;\n    if (epgGuideFilter === "matched") {\n      return list.filter(hasOwnedEpgMatch);\n    }\n    return list.filter((c) => !hasOwnedEpgMatch(c));\n  }, [channels, customGuideGroups.byName, customOrder, epgGuideFilter, favoriteSet, group, hiddenIdSet, recent, recentIdSet]);'''
new = '''    if (epgGuideFilter === "all") return list;\n    const filteredList = epgGuideFilter === "matched"\n      ? list.filter(hasOwnedEpgMatch)\n      : list.filter((c) => !hasOwnedEpgMatch(c));\n    if (!jumpFilterBypassId || filteredList.some((channel) => channel.id === jumpFilterBypassId)) {\n      return filteredList;\n    }\n    const target = list.find((channel) => channel.id === jumpFilterBypassId);\n    if (!target) return filteredList;\n    // Preserve the selected group's existing order while temporarily admitting only the requested row.\n    const visibleIds = new Set(filteredList.map((channel) => channel.id));\n    visibleIds.add(target.id);\n    return list.filter((channel) => visibleIds.has(channel.id));\n  }, [channels, customGuideGroups.byName, customOrder, epgGuideFilter, favoriteSet, group, hiddenIdSet, jumpFilterBypassId, recent, recentIdSet]);'''
assert old in text, 'filteredMeta block missing'
text = text.replace(old, new, 1)

old = '''  const onFocusChannel = useCallback((channel: Channel, settled = true) => {\n    guideSessionChannelId = channel.id;\n    rememberGuideGroupChannel(group, channel.id);'''
new = '''  const onFocusChannel = useCallback((channel: Channel, settled = true) => {\n    guideSessionChannelId = channel.id;\n    if (jumpFilterBypassId && channel.id !== jumpFilterBypassId) setJumpFilterBypassId(null);\n    rememberGuideGroupChannel(group, channel.id);'''
assert old in text, 'onFocusChannel anchor missing'
text = text.replace(old, new, 1)
text = text.replace('  }, [armPreviewForChannel, group]);\n\n  const onFocusProgram', '  }, [armPreviewForChannel, group, jumpFilterBypassId]);\n\n  const onFocusProgram', 1)

old = '''  const onFocusProgram = useCallback((program: Program, channel: Channel, settled = true) => {\n    guideSessionChannelId = channel.id;\n    rememberGuideGroupChannel(group, channel.id);'''
new = '''  const onFocusProgram = useCallback((program: Program, channel: Channel, settled = true) => {\n    guideSessionChannelId = channel.id;\n    if (jumpFilterBypassId && channel.id !== jumpFilterBypassId) setJumpFilterBypassId(null);\n    rememberGuideGroupChannel(group, channel.id);'''
assert old in text, 'onFocusProgram anchor missing'
text = text.replace(old, new, 1)
text = text.replace('  }, [armPreviewForChannel, group]);\n\n  const openGuideProgram', '  }, [armPreviewForChannel, group, jumpFilterBypassId]);\n\n  const openGuideProgram', 1)

old = '    setGroup(next);\n    resetGuideSelection(rememberedChannelId);\n'
new = '    setGroup(next);\n    setJumpFilterBypassId(null);\n    resetGuideSelection(rememberedChannelId);\n'
assert old in text, 'applyGroup anchor missing'
text = text.replace(old, new, 1)

old = '      guideSessionGroup = nextGroup;\n      guideSessionChannelId = jump.channelId;\n'
new = '      guideSessionGroup = nextGroup;\n      guideSessionChannelId = jump.channelId;\n      setJumpFilterBypassId(jump.channelId);\n'
assert old in text, 'guide jump anchor missing'
text = text.replace(old, new, 1)

path.write_text(text)
print('Applied Phase 9 explicit Guide jump filter bypass repair')
