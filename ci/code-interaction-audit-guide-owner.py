from pathlib import Path

path = Path("frontend/app/(tabs)/guide.tsx")
text = path.read_text(encoding="utf-8")

old_import = 'import { setGuideNavigationActive, setGuideRepeatInterval, setRemoteContext } from "@/src/utils/tvRemote";'
new_import = 'import { resetRemoteContextIfOwned, setGuideNavigationActive, setGuideRepeatInterval, setRemoteContext } from "@/src/utils/tvRemote";'
if new_import not in text:
    if text.count(old_import) != 1:
        raise SystemExit("Guide remote ownership import anchor not found")
    text = text.replace(old_import, new_import, 1)

old_cleanup = '''        setGuideScreenActive(false);\n        setGuideNavigationActive(false);\n        setRemoteContext("default");'''
new_cleanup = '''        setGuideScreenActive(false);\n        setGuideNavigationActive(false);\n        // A route/modal/drawer may already own the remote by the time Guide\n        // blur cleanup runs. Release only our own ownership so stale cleanup\n        // cannot clobber the newer focus context.\n        resetRemoteContextIfOwned("guide", "default");'''
if new_cleanup not in text:
    if text.count(old_cleanup) != 1:
        raise SystemExit("Guide remote cleanup anchor not found")
    text = text.replace(old_cleanup, new_cleanup, 1)

path.write_text(text, encoding="utf-8")
