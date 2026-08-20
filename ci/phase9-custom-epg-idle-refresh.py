from pathlib import Path

path = Path('frontend/src/source.native.ts')
text = path.read_text(encoding='utf-8')

# Repair the partially-applied full-refresh guard. refreshInternal() names the
# custom-owned set userOverrideIds, not overrideIds.
bad_full = '''      // The custom source manager performs a deliberate full XMLTV index when\n      // the user presses Refresh Custom EPG. Background/scheduled refreshes only\n      // need to spend network/CPU/disk when at least one playlist channel is\n      // actually owned by the custom source.\n      if (ownership.userEnabled && ownership.userUrl && overrideIds.size > 0) {\n        await refreshNativeUserGuide(ownership.userUrl);\n      }\n'''
good_full = '''      // The custom source manager performs a deliberate full XMLTV index when\n      // the user presses Refresh Custom EPG. Background/scheduled refreshes only\n      // need to spend network/CPU/disk when at least one playlist channel is\n      // actually owned by the custom source.\n      if (ownership.userEnabled && ownership.userUrl && userOverrideIds.size > 0) {\n        await refreshNativeUserGuide(ownership.userUrl);\n      }\n'''
if bad_full in text:
    text = text.replace(bad_full, good_full, 1)
elif good_full not in text:
    raise SystemExit('expected refreshInternal custom EPG guard not found')

# Scope the EPG-only replacement to refreshEpgOnly() so the first similar block
# elsewhere in the file can never be patched by accident again.
marker = 'export async function refreshEpgOnly(): Promise<SourceStatus> {'
idx = text.find(marker)
if idx < 0:
    raise SystemExit('refreshEpgOnly function not found')
head, tail = text[:idx], text[idx:]
old_epg_only = '''      if (ownership.userEnabled && ownership.userUrl) {\n        await refreshNativeUserGuide(ownership.userUrl);\n      }\n'''
new_epg_only = '''      // Scheduled/background custom-guide work is only useful when at least one\n      // playlist channel is explicitly owned by the custom XMLTV source. Manual\n      // refresh in the Custom EPG manager still performs a full source index so\n      // users can discover XMLTV channels before creating assignments.\n      if (ownership.userEnabled && ownership.userUrl && overrideIds.size > 0) {\n        await refreshNativeUserGuide(ownership.userUrl);\n      }\n'''
if old_epg_only in tail:
    tail = tail.replace(old_epg_only, new_epg_only, 1)
elif new_epg_only not in tail:
    raise SystemExit('expected refreshEpgOnly custom EPG block not found')

path.write_text(head + tail, encoding='utf-8')
