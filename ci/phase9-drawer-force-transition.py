from pathlib import Path

path = Path('frontend/src/components/PurpleTvShell.tsx')
text = path.read_text()

text = text.replace(
    '  closeDrawer: () => void;\n',
    '  closeDrawer: (options?: { force?: boolean }) => void;\n',
    1,
)

old = '''  const closeDrawer = useCallback(() => {\n    if (!drawerOpenRef.current) return;\n    if (Date.now() - openedAtRef.current < PURPLE_DRAWER_ANIMATION_MS + 70) return;\n    drawerOpenRef.current = false;\n    setFocusDrawerTop(false);\n    setDrawerOpen(false);\n  }, []);'''
new = '''  const closeDrawer = useCallback((options?: { force?: boolean }) => {\n    if (!drawerOpenRef.current) return;\n    if (!options?.force && Date.now() - openedAtRef.current < PURPLE_DRAWER_ANIMATION_MS + 70) return;\n    drawerOpenRef.current = false;\n    setFocusDrawerTop(false);\n    setDrawerOpen(false);\n  }, []);'''
assert old in text, 'closeDrawer implementation anchor missing'
text = text.replace(old, new, 1)

old = '''          if (key !== "RIGHT") return;\n          closeDrawer();\n          DeviceEventEmitter.emit("CharmGuideGroupsRequestOpen");'''
new = '''          if (key !== "RIGHT") return;\n          // This is an intentional drawer-to-drawer boundary transition, not an\n          // accidental close during animation. Main must be gone before Groups\n          // becomes remote owner or both focus trees can be live at once.\n          closeDrawer({ force: true });\n          requestAnimationFrame(() => DeviceEventEmitter.emit("CharmGuideGroupsRequestOpen"));'''
assert old in text, 'main-to-groups transition anchor missing'
text = text.replace(old, new, 1)

path.write_text(text)
print('Applied deterministic main-drawer to groups-drawer transition repair')
