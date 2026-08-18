from pathlib import Path

path = Path('frontend/src/source.native.ts')
text = path.read_text(encoding='utf-8')
old = '''      if (ownership.userEnabled && ownership.userUrl) {\n        await refreshNativeUserGuide(ownership.userUrl);\n      }\n'''
new = '''      // The custom source manager performs a deliberate full XMLTV index when\n      // the user presses Refresh Custom EPG. Background/scheduled refreshes only\n      // need to spend network/CPU/disk when at least one playlist channel is\n      // actually owned by the custom source.\n      if (ownership.userEnabled && ownership.userUrl && overrideIds.size > 0) {\n        await refreshNativeUserGuide(ownership.userUrl);\n      }\n'''
if old not in text:
    raise SystemExit('expected custom EPG refresh block not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
