from pathlib import Path

p = Path('frontend/app/(tabs)/search.tsx')
s = p.read_text(encoding='utf-8')
old = s

s = s.replace('const clearPreferred = setTimeout(() => setPreferKeyFocus(false), 700);', 'const clearPreferred = setTimeout(() => setPreferKeyFocus(false), 180);')
s = s.replace('''  useEffect(() => {\n    if (!isTV) return;\n    return addTvKeyListener((key) => {''', '''  useEffect(() => {\n    if (!isTV || !isFocused) return;\n    return addTvKeyListener((key) => {''')
s = s.replace('''  }, [isTV, openDrawer]);''', '''  }, [isFocused, isTV, openDrawer]);''', 1)
s = s.replace('''        group: channel.group || "All",''', '''        // Provider/M3U groups can be hidden in Phase 9. Anchor the exact\n        // channel through All so Search never targets an invisible raw group.\n        group: "All",''')

if s == old:
    raise SystemExit('No Search replacements applied; source drifted')

required = [
    'setPreferKeyFocus(false), 180',
    'if (!isTV || !isFocused) return;',
    'group: "All"',
]
for token in required:
    if token not in s:
        raise SystemExit(f'missing expected token: {token}')

p.write_text(s, encoding='utf-8')
