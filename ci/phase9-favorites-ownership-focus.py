from pathlib import Path

p = Path('frontend/app/(tabs)/favorites.tsx')
s = p.read_text(encoding='utf-8')
s2 = s.replace('const current = nowNext(programmes.length ? programmes : channel.programs, now).current;', 'const current = nowNext(programmes, now).current;', 1)
s2 = s2.replace('const timer = setTimeout(() => setPreferInitialFocus(false), 700);', 'const timer = setTimeout(() => setPreferInitialFocus(false), 180);', 1)
if s2 == s:
    raise SystemExit('guard failed: expected Favorites ownership/focus patterns not found')
if 'programmes.length ? programmes : channel.programs' in s2:
    raise SystemExit('guard failed: stale Favorites EPG fallback remains')
p.write_text(s2, encoding='utf-8')
