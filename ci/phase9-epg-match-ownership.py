from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:180]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

replace(
    'frontend/src/core/epgUserOverrides.ts',
    '''export function channelHasEpgMatch(channel: { tvg_id?: string; id: string; programs?: unknown[] }): boolean {\n''',
    '''export function channelHasOwnedEpgMatch(\n  channel: { tvg_id?: string; id: string; programs?: unknown[] },\n  ownership: { primaryEnabled: boolean; userEnabled: boolean; userOverrides: Record<string, string> },\n): boolean {\n  if (ownership.userEnabled && !!ownership.userOverrides[channel.id]) return true;\n  if (!ownership.primaryEnabled) return false;\n  return channelHasEpgMatch(channel);\n}\n\nexport function channelHasEpgMatch(channel: { tvg_id?: string; id: string; programs?: unknown[] }): boolean {\n''',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    'import { channelHasEpgMatch } from "@/src/core/epgUserOverrides";\n',
    'import { channelHasOwnedEpgMatch } from "@/src/core/epgUserOverrides";\nimport { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";\n',
)
replace(
    'frontend/app/(tabs)/guide.tsx',
    '''  const customGuideGroups = useCustomGuideGroups();\n  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();\n''',
    '''  const customGuideGroups = useCustomGuideGroups();\n  const epgOwnership = useEpgSourcePreferences();\n  const hasOwnedEpgMatch = useCallback(\n    (channel: Channel) => channelHasOwnedEpgMatch(channel, epgOwnership),\n    [epgOwnership.primaryEnabled, epgOwnership.userEnabled, epgOwnership.userOverrides],\n  );\n  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();\n''',
)
# Replace Guide-local predicate references only; no source/database behavior changes.
p = ROOT / 'frontend/app/(tabs)/guide.tsx'
s = p.read_text(encoding='utf-8')
if 'channelHasEpgMatch' in s:
    s = s.replace('channelHasEpgMatch', 'hasOwnedEpgMatch')
p.write_text(s, encoding='utf-8')

print('phase9 ownership-aware EPG match filters patched')
