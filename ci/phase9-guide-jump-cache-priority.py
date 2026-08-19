from pathlib import Path

path = Path('frontend/app/(tabs)/guide.tsx')
text = path.read_text()
old = '''      const last = lastRunwayRef.current;\n      if (last.ids.length) {\n'''
new = '''      const last = lastRunwayRef.current;\n      // Search/fullscreen jumps own re-entry. Do not spend SQLite/bridge/cache\n      // work rewarming the old Guide runway first; the jump reset will seed the\n      // requested channel immediately and avoids wrong-row contention/black return.\n      if (!peekGuideJump() && last.ids.length) {\n'''
if old not in text:
    raise SystemExit('Guide focus runway anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)
