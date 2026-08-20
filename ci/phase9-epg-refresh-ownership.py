from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:160]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

replace(
    'frontend/src/source.native.ts',
    '''      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");\n      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");\n      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);\n      await syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0);\n      const activeBindings = activeEpgBindings(cached.channels);\n      const refreshPreferences = await getSourceRefreshPreferences();\n      await configureNativeEpgSource(sourceUrl(SOURCE_EPG), refreshPreferences.epgHours);\n      const epg = await refreshNativeEpg(\n        sourceUrl(SOURCE_EPG),\n        true,\n        activeBindings.ids,\n        activeBindings.names,\n        applyNativeImportProgress,\n      );\n''',
    '''      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");\n      await syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0);\n      const ownership = await applyPersistedGuideOwnership();\n      const overrideIds = ownership.userEnabled\n        ? new Set(Object.keys(ownership.userOverrides))\n        : new Set<string>();\n      const refreshPreferences = await getSourceRefreshPreferences();\n\n      if (ownership.userEnabled && ownership.userUrl) {\n        await refreshNativeUserGuide(ownership.userUrl);\n      }\n\n      if (!ownership.primaryEnabled) {\n        // A disabled primary source is not downloaded, parsed, rematched, or\n        // scheduled in disguise. Advance the logical Guide epoch so every\n        // consumer drops old row caches and re-queries the selected ownership.\n        const checkedAt = Date.now();\n        clearProgrammeWindowCache();\n        MEM = {\n          ...cached,\n          ...MEM,\n          ts: checkedAt,\n          epgError: undefined,\n          guideEpoch: (cached.guideEpoch || 0) + 1,\n          guideRefreshedAt: checkedAt,\n        };\n        await persistMeta(MEM);\n        emit();\n        setProgress({ phase: "ready", ratio: 1, etaSeconds: 0, message: null }, true);\n        return MEM;\n      }\n\n      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");\n      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);\n      const activeBindings = activeEpgBindings(cached.channels, overrideIds);\n      await configureNativeEpgSource(sourceUrl(SOURCE_EPG), refreshPreferences.epgHours);\n      const epg = await refreshNativeEpg(\n        sourceUrl(SOURCE_EPG),\n        true,\n        activeBindings.ids,\n        activeBindings.names,\n        applyNativeImportProgress,\n      );\n''',
)

print('phase9 EPG refresh ownership patched')
