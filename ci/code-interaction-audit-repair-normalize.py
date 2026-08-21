#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

player = ROOT / "frontend/app/player.tsx"
text = player.read_text(encoding="utf-8")
# The OSD consolidation pass removes `moreOpen` from hook dependencies before
# deleting the old local-More focus effect. On a fresh repair working tree that
# can leave the now-dead effect with an undefined `moreOpen`/`frame`. Remove only
# that exact obsolete owner; Quick Actions is now the single Actions/More owner.
stale_more_focus = '''\n  useEffect(() => {\n    if (!moreOpen || !isTV) return;\n    const frame = requestAnimationFrame(() => requestNativeFocus(moreFirstActionRef.current));\n    return () => cancelAnimationFrame(frame);\n  }, [isTV]);\n'''
if stale_more_focus in text:
    text = text.replace(stale_more_focus, "\n", 1)
player.write_text(text, encoding="utf-8")

calibration = ROOT / "frontend/src/tvCalibration.tsx"
text = calibration.read_text(encoding="utf-8")
# The hydration repair's insertion anchor is a prefix of its repaired form, so a
# second audit cycle can insert the same mutation ref twice. Collapse only exact
# adjacent duplicates; the newest-user-action-wins guard remains intact.
dupe = '''  const hydrationMutationRef = useRef(0);\n  const hydrationMutationRef = useRef(0);'''
while dupe in text:
    text = text.replace(dupe, '  const hydrationMutationRef = useRef(0);', 1)
calibration.write_text(text, encoding="utf-8")

print("Normalized idempotent audit repair output")
