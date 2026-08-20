from pathlib import Path

branch_files = {
    Path('frontend/src/components/TvQuickActionsOverlay.tsx'): None,
    Path('frontend/src/components/ProgramModal.tsx'): None,
    Path('frontend/tests/quickActionsContext.test.mjs'): None,
}

quick = Path('frontend/src/components/TvQuickActionsOverlay.tsx')
s = quick.read_text(encoding='utf-8')
old = '  const [status, setStatus] = useState<string | null>(null);\n  const queryGeneration = useRef(0);'
new = '  const [status, setStatus] = useState<string | null>(null);\n  const [focusClaim, setFocusClaim] = useState(false);\n  const queryGeneration = useRef(0);'
if old not in s:
    raise SystemExit('quick focus state anchor missing')
s = s.replace(old, new, 1)

old = '  useEffect(() => {\n    if (!open) return;\n    const sub = BackHandler.addEventListener("hardwareBackPress", () => {'
new = '  useEffect(() => {\n    if (!open) return;\n    setFocusClaim(false);\n    const frame = requestAnimationFrame(() => setFocusClaim(true));\n    return () => cancelAnimationFrame(frame);\n  }, [open, mode, sourceChoice?.id]);\n\n  useEffect(() => {\n    if (!open) return;\n    const sub = BackHandler.addEventListener("hardwareBackPress", () => {'
if old not in s:
    raise SystemExit('quick focus effect anchor missing')
s = s.replace(old, new, 1)

old = '<Action icon={context === "guide" ? "play" : "heart-outline"} label={context === "guide" ? "Play channel" : (favoriteSet.has(channel.id) ? "Remove Favorite" : "Add Favorite")} onPress={context === "guide" ? play : favorite} />'
new = '<Action preferredFocus={focusClaim} icon={context === "guide" ? "play" : "heart-outline"} label={context === "guide" ? "Play channel" : (favoriteSet.has(channel.id) ? "Remove Favorite" : "Add Favorite")} onPress={context === "guide" ? play : favorite} />'
if old not in s:
    raise SystemExit('quick first action anchor missing')
s = s.replace(old, new, 1)

old = '              <Action\n                key={source.id}\n                icon="server-outline"'
new = '              <Action\n                key={source.id}\n                preferredFocus={focusClaim && source.id === sourceChoices[0]?.id}\n                icon="server-outline"'
if old not in s:
    raise SystemExit('epg source action anchor missing')
s = s.replace(old, new, 1)

old = '  disabled = false,\n}: {\n  icon: React.ComponentProps<typeof Ionicons>["name"];'
new = '  disabled = false,\n  preferredFocus = false,\n}: {\n  icon: React.ComponentProps<typeof Ionicons>["name"];'
if old not in s:
    raise SystemExit('Action args anchor missing')
s = s.replace(old, new, 1)

old = '  disabled?: boolean;\n}) {\n  return (\n    <Pressable\n      disabled={disabled}'
new = '  disabled?: boolean;\n  preferredFocus?: boolean;\n}) {\n  return (\n    <Pressable\n      disabled={disabled}\n      hasTVPreferredFocus={preferredFocus}'
if old not in s:
    raise SystemExit('Action prop anchor missing')
s = s.replace(old, new, 1)
quick.write_text(s, encoding='utf-8')

program = Path('frontend/src/components/ProgramModal.tsx')
s = program.read_text(encoding='utf-8')
old = '  const [optimisticReminded, setOptimisticReminded] = React.useState<boolean | null>(null);\n  // Ref-only busy guard'
new = '  const [optimisticReminded, setOptimisticReminded] = React.useState<boolean | null>(null);\n  const [focusClaim, setFocusClaim] = React.useState(false);\n  // Ref-only busy guard'
if old not in s:
    raise SystemExit('program focus state anchor missing')
s = s.replace(old, new, 1)

old = '  React.useEffect(() => {\n    setMsg(null);\n    setOptimisticReminded(null);\n  }, [activeProgram]);'
new = '  React.useEffect(() => {\n    setMsg(null);\n    setOptimisticReminded(null);\n    if (!activeProgram) {\n      setFocusClaim(false);\n      return;\n    }\n    setFocusClaim(false);\n    const frame = requestAnimationFrame(() => setFocusClaim(true));\n    return () => cancelAnimationFrame(frame);\n  }, [activeProgram]);'
if old not in s:
    raise SystemExit('program active effect anchor missing')
s = s.replace(old, new, 1)

old = '                hasTVPreferredFocus\n                onPress={watch}'
new = '                hasTVPreferredFocus={focusClaim}\n                onPress={watch}'
if old not in s:
    raise SystemExit('program preferred focus anchor missing')
s = s.replace(old, new, 1)
program.write_text(s, encoding='utf-8')

test = Path('frontend/tests/quickActionsContext.test.mjs')
s = test.read_text(encoding='utf-8')
insert = '''\n\ntest("Guide quick-action overlays explicitly take TV focus from the native Guide", async () => {\n  const [overlay, modal] = await Promise.all([\n    source("src/components/TvQuickActionsOverlay.tsx"),\n    source("src/components/ProgramModal.tsx"),\n  ]);\n  assert.match(overlay, /const \[focusClaim, setFocusClaim\] = useState\(false\)/);\n  assert.match(overlay, /requestAnimationFrame\(\(\) => setFocusClaim\(true\)\)/);\n  assert.match(overlay, /preferredFocus=\{focusClaim\}/);\n  assert.match(overlay, /hasTVPreferredFocus=\{preferredFocus\}/);\n  assert.match(modal, /const \[focusClaim, setFocusClaim\] = React\.useState\(false\)/);\n  assert.match(modal, /requestAnimationFrame\(\(\) => setFocusClaim\(true\)\)/);\n  assert.match(modal, /hasTVPreferredFocus=\{focusClaim\}/);\n});\n'''
if 'Guide quick-action overlays explicitly take TV focus' not in s:
    s += insert
test.write_text(s, encoding='utf-8')
