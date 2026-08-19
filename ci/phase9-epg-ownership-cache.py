from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:160]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# The primary RAM engine knows only primary playlist->XMLTV matches. Any custom
# ownership must use the ownership-aware native SQLite query instead of allowing
# stale primary RAM rows to win first.
replace(
    'frontend/src/nativeEpg.ts',
    'export const nativeEpgRamAvailable = Platform.OS === "android" && !!ramModule;\n',
    '''export const nativeEpgRamAvailable = Platform.OS === "android" && !!ramModule;\nlet ownershipRequiresSqlite = false;\n''',
)
replace(
    'frontend/src/nativeEpg.ts',
    '''  if (ramModule) {\n    const ramWindow = await ramModule.queryGuideWindow(startMs, endMs, uniqueIds);\n    if (ramWindow) return windowToPrograms(ramWindow, uniqueIds);\n  }\n''',
    '''  if (ramModule && !ownershipRequiresSqlite) {\n    const ramWindow = await ramModule.queryGuideWindow(startMs, endMs, uniqueIds);\n    if (ramWindow) return windowToPrograms(ramWindow, uniqueIds);\n  }\n''',
)
replace(
    'frontend/src/nativeEpg.ts',
    '''export async function configureNativeGuideOwnership(\n  primaryEnabled: boolean,\n  userEnabled: boolean,\n  userUrl: string,\n  userOverrides: Record<string, string>,\n): Promise<void> {\n  if (!nativeModule?.configureGuideOwnership) return;\n  await nativeModule.configureGuideOwnership(primaryEnabled, userEnabled, userUrl, userOverrides);\n}\n''',
    '''export async function configureNativeGuideOwnership(\n  primaryEnabled: boolean,\n  userEnabled: boolean,\n  userUrl: string,\n  userOverrides: Record<string, string>,\n): Promise<void> {\n  const hasUserBindings = userEnabled && !!userUrl.trim() && Object.keys(userOverrides).length > 0;\n  ownershipRequiresSqlite = !primaryEnabled || hasUserBindings;\n  if (ownershipRequiresSqlite && ramModule) {\n    // Primary-only RAM rows must not survive an ownership switch. SQLite remains\n    // bounded to the requested Guide runway and resolves exactly one source/channel.\n    await ramModule.clearMemory().catch(() => undefined);\n  }\n  if (!nativeModule?.configureGuideOwnership) return;\n  await nativeModule.configureGuideOwnership(primaryEnabled, userEnabled, userUrl, userOverrides);\n}\n''',
)

# Source-native always reapplies persisted ownership on cold load/refresh and
# excludes custom-bound channels from primary XMLTV parse work.
replace(
    'frontend/src/source.native.ts',
    '''  queryNativeGuideWindow,\n  refreshNativeEpg,\n  configureNativeEpgSource,\n''',
    '''  queryNativeGuideWindow,\n  refreshNativeEpg,\n  refreshNativeUserGuide,\n  configureNativeEpgSource,\n  configureNativeGuideOwnership,\n''',
)
replace(
    'frontend/src/source.native.ts',
    'import { getLogoPriority, type LogoPriority } from "@/src/core/logoPreferences";\n',
    'import { getLogoPriority, type LogoPriority } from "@/src/core/logoPreferences";\nimport { getEpgSourcePreferences, type EpgSourcePreferences } from "@/src/core/epgSourcePreferences";\n',
)
replace(
    'frontend/src/source.native.ts',
    '''function activeEpgBindings(channels: Channel[]): { ids: string[]; names: string[] } {\n  const ids = new Set<string>();\n  const names = new Set<string>();\n  for (const channel of channels) {\n    const id = (channel.raw_tvg_id || channel.tvg_id || "").trim();\n    const name = (channel.name || "").trim();\n    if (id) ids.add(id);\n    if (name) names.add(name);\n  }\n  return { ids: Array.from(ids), names: Array.from(names) };\n}\n''',
    '''function activeEpgBindings(\n  channels: Channel[],\n  excludedPlaylistIds: ReadonlySet<string> = new Set(),\n): { ids: string[]; names: string[] } {\n  const ids = new Set<string>();\n  const names = new Set<string>();\n  for (const channel of channels) {\n    if (excludedPlaylistIds.has(channel.id)) continue;\n    const id = (channel.raw_tvg_id || channel.tvg_id || "").trim();\n    const name = (channel.name || "").trim();\n    if (id) ids.add(id);\n    if (name) names.add(name);\n  }\n  return { ids: Array.from(ids), names: Array.from(names) };\n}\n\nasync function applyPersistedGuideOwnership(): Promise<EpgSourcePreferences> {\n  const prefs = await getEpgSourcePreferences();\n  await configureNativeGuideOwnership(\n    prefs.primaryEnabled,\n    prefs.userEnabled,\n    prefs.userUrl,\n    prefs.userOverrides,\n  );\n  return prefs;\n}\n''',
)

# Reapply persisted native ownership whenever cached source metadata is restored.
replace(
    'frontend/src/source.native.ts',
    '''    MEM = cached;\n    if (cached.epgError) {''',
    '''    MEM = cached;\n    void applyPersistedGuideOwnership().catch(() => undefined);\n    if (cached.epgError) {''',
)

# Primary refresh parses only channels still owned by primary; user EPG refresh
# is independent and primary can be completely disabled without a hidden download.
replace(
    'frontend/src/source.native.ts',
    '''      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");\n      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");\n      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);\n      const activeBindings = activeEpgBindings(channels);\n      const refreshPreferences = await getSourceRefreshPreferences();\n      await configureNativeEpgSource(sourceUrl(SOURCE_EPG), refreshPreferences.epgHours);\n      const epg = await refreshNativeEpg(\n        sourceUrl(SOURCE_EPG),\n        false,\n        activeBindings.ids,\n        activeBindings.names,\n        applyNativeImportProgress,\n      );\n''',
    '''      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");\n      const ownership = await applyPersistedGuideOwnership();\n      const userOverrideIds = ownership.userEnabled\n        ? new Set(Object.keys(ownership.userOverrides))\n        : new Set<string>();\n      const refreshPreferences = await getSourceRefreshPreferences();\n      if (ownership.userEnabled && ownership.userUrl) {\n        await refreshNativeUserGuide(ownership.userUrl);\n      }\n      if (!ownership.primaryEnabled) {\n        // Built-in EPG is truly off: no download, parse, match, or background\n        // refresh. User-bound channels are served solely from the user DB.\n        const guideRefreshedAt = Date.now();\n        clearProgrammeWindowCache();\n        MEM = {\n          ...MEM,\n          ts: guideRefreshedAt,\n          epgError: undefined,\n          guideEpoch: (MEM.guideEpoch || 0) + 1,\n          guideRefreshedAt,\n        };\n        await persistMeta(MEM);\n        emit();\n        setProgress({ phase: "ready", ratio: 1, etaSeconds: 0, message: null }, true);\n        return MEM;\n      }\n      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");\n      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);\n      const activeBindings = activeEpgBindings(channels, userOverrideIds);\n      await configureNativeEpgSource(sourceUrl(SOURCE_EPG), refreshPreferences.epgHours);\n      const epg = await refreshNativeEpg(\n        sourceUrl(SOURCE_EPG),\n        false,\n        activeBindings.ids,\n        activeBindings.names,\n        applyNativeImportProgress,\n      );\n''',
)

print('phase9 epg ownership/cache integration patched')
