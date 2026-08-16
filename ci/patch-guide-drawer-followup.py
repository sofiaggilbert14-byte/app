from pathlib import Path

path = Path("frontend/app/(tabs)/guide.tsx")
text = path.read_text()
text = text.replace(
    '  const { drawerOpen, openDrawer } = usePurpleTvDrawer();',
    '  const { drawerOpen, openDrawer, closeDrawer } = usePurpleTvDrawer();',
)
old = '''    setGroup(next);\n    resetGuideSelection(rememberedChannelId);\n    setPreviewId(null);\n    setResetToken((value) => value + 1);\n  }, [group]);'''
new = '''    setGroup(next);\n    resetGuideSelection(rememberedChannelId);\n    setPreviewId(null);\n    setResetToken((value) => value + 1);\n    closeDrawer();\n  }, [closeDrawer, group]);'''
if old not in text:
    raise SystemExit("applyGroup follow-up pattern not found")
text = text.replace(old, new)
old = '''      guideSessionGroup = nextGroup;\n      guideSessionChannelId = jump.channelId;\n      setGroup(nextGroup);'''
new = '''      guideSessionGroup = nextGroup;\n      guideSessionChannelId = jump.channelId;\n      guideSessionChannelByGroup.set(nextGroup, jump.channelId);\n      setGroup(nextGroup);'''
if old not in text:
    raise SystemExit("search jump follow-up pattern not found")
text = text.replace(old, new)
path.write_text(text)
