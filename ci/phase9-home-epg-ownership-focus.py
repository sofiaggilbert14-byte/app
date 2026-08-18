from pathlib import Path

p = Path('frontend/app/(tabs)/index.tsx')
s = p.read_text(encoding='utf-8')
old = '  const current = nowNext(programs.length ? programs : channel.programs, now).current;\n'
new = '  const current = nowNext(programs, now).current;\n'
if old not in s:
    raise SystemExit('guard failed: recent-card legacy EPG fallback not found')
s = s.replace(old, new, 1)
old = '    () => (heroChannel ? nowNext(heroPrograms.length ? heroPrograms : heroChannel.programs, now).current : undefined),\n'
new = '    () => (heroChannel ? nowNext(heroPrograms, now).current : undefined),\n'
if old not in s:
    raise SystemExit('guard failed: hero legacy EPG fallback not found')
s = s.replace(old, new, 1)
old = '      const timer = setTimeout(() => setPreferInitialFocus(false), 700);\n'
new = '      const timer = setTimeout(() => setPreferInitialFocus(false), 180);\n'
if old not in s:
    raise SystemExit('guard failed: Live TV preferred-focus timer not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
