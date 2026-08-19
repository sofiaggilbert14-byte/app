from pathlib import Path

settings = Path('frontend/app/(tabs)/settings.tsx')
s = settings.read_text(encoding='utf-8')
old1 = 'const timer = setTimeout(() => setPreferTileFocus(false), 700);'
new1 = 'const timer = setTimeout(() => setPreferTileFocus(false), 180);'
old2 = 'const timer = setTimeout(() => setPreferBackFocus(false), 700);'
new2 = 'const timer = setTimeout(() => setPreferBackFocus(false), 180);'
if old1 not in s or old2 not in s:
    raise SystemExit('guard failed: expected Settings focus timers not found')
s = s.replace(old1, new1, 1).replace(old2, new2, 1)
settings.write_text(s, encoding='utf-8')

groups = Path('frontend/app/group-settings.tsx')
g = groups.read_text(encoding='utf-8')
old3 = 'const timer = setTimeout(() => setPreferBackFocus(false), 360);'
new3 = 'const timer = setTimeout(() => setPreferBackFocus(false), 180);'
if old3 not in g:
    raise SystemExit('guard failed: expected Group Settings focus timer not found')
g = g.replace(old3, new3, 1)
groups.write_text(g, encoding='utf-8')
