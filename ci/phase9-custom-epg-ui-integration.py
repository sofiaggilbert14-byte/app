from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str, count: int = 1):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:180]!r}')
    p.write_text(s.replace(old, new, count), encoding='utf-8')

# Shared non-destructive ownership cache invalidation. Never wipe databases just
# because one channel changes EPG owner.
replace(
    'frontend/src/source.native.ts',
    '''export async function clearGuideCache(): Promise<void> {\n''',
    '''export function invalidateGuideOwnershipCaches(): void {\n  clearProgrammeWindowCache();\n  clearGuidePrograms();\n  if (MEM) MEM = { ...MEM, guideEpoch: (MEM.guideEpoch || 0) + 1 };\n  emit();\n}\n\nexport async function clearGuideCache(): Promise<void> {\n''',
)
replace(
    'frontend/src/source.ts',
    '''export function trimProgrammeWindowCacheForMemoryPressure(\n  _keepIds: string[] = [],\n  _critical = false,\n): void {\n  /* native-only */\n}\n''',
    '''export function trimProgrammeWindowCacheForMemoryPressure(\n  _keepIds: string[] = [],\n  _critical = false,\n): void {\n  /* native-only */\n}\nexport function invalidateGuideOwnershipCaches(): void {\n  /* native ownership is Android-only; shared export keeps settings type-safe. */\n}\n''',
)

# EPG Settings entry point.
replace(
    'frontend/app/(tabs)/epg-sources.tsx',
    '''              <Action label="Manage Guide groups & custom tabs" icon="albums-outline" onPress={() => router.push("/group-settings" as any)} />\n''',
    '''              <Action label="Manage Guide groups & custom tabs" icon="albums-outline" onPress={() => router.push("/group-settings" as any)} />\n              <Action label="Custom EPG & channel assignments" icon="git-compare-outline" onPress={() => router.push("/epg-custom" as any)} />\n''',
)

# Correct Phase 9 screen theme tokens and make Back deterministic.
replace(
    'frontend/app/epg-custom.tsx',
    'import { useRouter } from "expo-router";\n',
    'import { useRouter } from "expo-router";\nimport { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";\n',
)
replace(
    'frontend/app/epg-custom.tsx',
    '''  const queryGeneration = useRef(0);\n\n  useEffect(() => {''',
    '''  const queryGeneration = useRef(0);\n\n  useTvBackHandler(useCallback(() => {\n    router.replace("/epg-sources" as any);\n    return true;\n  }, [router]));\n\n  useEffect(() => {''',
)
for old, new in [
    ('tvColors.background', 'tvColors.canvas'),
    ('tvColors.card', 'tvColors.panel'),
    ('tvColors.border', 'tvColors.line'),
]:
    p = ROOT / 'frontend/app/epg-custom.tsx'
    s = p.read_text(encoding='utf-8')
    if old in s:
        p.write_text(s.replace(old, new), encoding='utf-8')

print('phase9 custom EPG UI integration patched')
