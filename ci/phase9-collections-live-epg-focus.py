from pathlib import Path

p = Path('frontend/src/components/PurpleChannelCollection.tsx')
s = p.read_text(encoding='utf-8')
old = 'import { useStore } from "@/src/store";\n'
new = 'import { useStore } from "@/src/store";\nimport { useGuidePrograms } from "@/src/core/guideProgramsStore";\n'
if old not in s:
    raise SystemExit('guard failed: store import not found')
s = s.replace(old, new, 1)
old = '  const current = nowNext(channel.programs, now).current;\n'
new = '  const programs = useGuidePrograms(channel.id);\n  const current = nowNext(programs, now).current;\n'
if old not in s:
    raise SystemExit('guard failed: legacy embedded programme read not found')
s = s.replace(old, new, 1)
old = '      const timer = setTimeout(() => setPreferInitialFocus(false), 700);\n'
new = '      const timer = setTimeout(() => setPreferInitialFocus(false), 180);\n'
if old not in s:
    raise SystemExit('guard failed: collection preferred-focus timer not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
