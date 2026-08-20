from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:150]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# Avoid cloning/sanitizing the whole 10k override map for scalar preference changes,
# and avoid a second full clone for a single channel assignment.
path = 'frontend/src/core/epgSourcePreferences.ts'
replace(path,
'''function commit(value: EpgSourcePreferences) {\n  cached = normalize(value);\n  loaded = true;\n  emit();\n  pendingWrite = cached;\n  void flush();\n}''',
'''function commitPrepared(value: EpgSourcePreferences) {\n  cached = value;\n  loaded = true;\n  emit();\n  pendingWrite = cached;\n  void flush();\n}''')
replace(path,
'''  const update = useCallback((patch: Partial<EpgSourcePreferences>) => {\n    const next = normalize({ ...cached, ...patch });\n    setValue(next);\n    commit(next);\n  }, []);\n\n  const setUserOverride = useCallback((channelId: string, xmltvId: string | null) => {\n    const next = { ...cached.userOverrides };\n    if (xmltvId?.trim()) next[channelId] = xmltvId.trim();\n    else delete next[channelId];\n    update({ userOverrides: next });\n  }, [update]);''',
'''  const update = useCallback((patch: Partial<EpgSourcePreferences>) => {\n    const next: EpgSourcePreferences = {\n      primaryEnabled: patch.primaryEnabled === undefined ? cached.primaryEnabled : patch.primaryEnabled !== false,\n      userEnabled: patch.userEnabled === undefined ? cached.userEnabled : patch.userEnabled === true,\n      userUrl: patch.userUrl === undefined ? cached.userUrl : cleanUrl(patch.userUrl),\n      // Scalar toggles/URL edits retain the existing mapping object; do not walk\n      // 10k bindings unless a bulk override replacement was explicitly requested.\n      userOverrides: patch.userOverrides === undefined ? cached.userOverrides : cleanOverrides(patch.userOverrides),\n    };\n    setValue(next);\n    commitPrepared(next);\n  }, []);\n\n  const setUserOverride = useCallback((channelId: string, xmltvId: string | null) => {\n    const id = String(channelId || "").trim().slice(0, 180);\n    const sourceId = String(xmltvId || "").trim().slice(0, 180);\n    if (!id || id.includes("://")) return;\n    if (sourceId.includes("://")) return;\n    const existing = cached.userOverrides[id] || "";\n    if (existing === sourceId || (!sourceId && !existing)) return;\n    const overrides = { ...cached.userOverrides };\n    if (sourceId) overrides[id] = sourceId; else delete overrides[id];\n    const next = { ...cached, userOverrides: overrides };\n    setValue(next);\n    commitPrepared(next);\n  }, []);''')

# The UI now pages XMLTV metadata directly from SQLite. Do not materialize and
# bridge thousands of names/IDs after every custom-guide refresh.
path = 'frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt'
replace(path,
'''        val names = Arguments.createMap()\n        for ((channelId, name) in channelNames) names.putString(channelId, name)\n        val ids = Arguments.createArray()\n        for (channelId in channelIdsWithPrograms) ids.pushString(channelId)\n        promise.resolve(Arguments.createMap().apply {\n          putDouble("count", userDatabase.count().toDouble())\n          putMap("channelNames", names)\n          putArray("channelIdsWithPrograms", ids)\n        })''',
'''        // Phase 9 UI reads the XMLTV directory through paged native queries.\n        // Returning every channel name/id here duplicates a potentially huge\n        // directory across the React Native bridge for no consumer.\n        promise.resolve(Arguments.createMap().apply {\n          putDouble("count", userDatabase.count().toDouble())\n        })''')

print('phase9 custom EPG preference and bridge memory optimized')
