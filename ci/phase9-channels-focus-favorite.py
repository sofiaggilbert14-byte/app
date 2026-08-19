from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:180]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

replace(
    'frontend/app/(tabs)/channels.tsx',
    'import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";\n',
    'import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";\n',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    'import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";\n',
    'import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";\nimport { addTvLongPressListener } from "@/src/utils/tvRemote";\n',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''  onMove,\n  preferredFocus,\n}: {''',
    '''  onMove,\n  onFocusChannel,\n  preferredFocus,\n}: {''',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''  onMove: (id: string, direction: -1 | 1) => void;\n  preferredFocus?: boolean;\n''',
    '''  onMove: (id: string, direction: -1 | 1) => void;\n  onFocusChannel: (id: string) => void;\n  preferredFocus?: boolean;\n''',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''        onPress={() => { if (!editMode) onPlay(channel); }}\n        onLongPress={() => { if (!editMode) onFavorite(channel.id); }}\n        delayLongPress={450}\n''',
    '''        onFocus={() => onFocusChannel(channel.id)}\n        onPress={() => { if (!editMode) onPlay(channel); }}\n        onLongPress={Platform.isTV ? undefined : () => { if (!editMode) onFavorite(channel.id); }}\n        delayLongPress={450}\n''',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''function byName(a: Channel, b: Channel) {\n  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });\n}\n\n''',
    '',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''  const customize = useChannelCustomize();\n  const alphabetical = useMemo(() => [...channels].sort(byName), [channels]);\n  const alphabeticalIds = useMemo(() => alphabetical.map((channel) => channel.id), [alphabetical]);\n''',
    '''  const customize = useChannelCustomize();\n  // Native source/cache rows are already name-sorted. Reuse the authoritative\n  // array instead of cloning/sorting 6k+ channels every Channels-screen render.\n  const alphabetical = channels;\n  const alphabeticalIds = useMemo(() => channels.map((channel) => channel.id), [channels]);\n''',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''  const [preferInitialFocus, setPreferInitialFocus] = useState(true);\n  const [editMode, setEditMode] = useState(false);\n''',
    '''  const [preferInitialFocus, setPreferInitialFocus] = useState(true);\n  const [editMode, setEditMode] = useState(false);\n  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(null);\n''',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''      const timer = setTimeout(() => setPreferInitialFocus(false), 700);\n''',
    '''      const timer = setTimeout(() => setPreferInitialFocus(false), 180);\n''',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''  const favorite = useCallback((id: string) => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    toggleFavorite(id);\n  }, [toggleFavorite]);\n''',
    '''  const favorite = useCallback((id: string) => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    toggleFavorite(id);\n  }, [toggleFavorite]);\n\n  useEffect(() => {\n    if (!isFocused || editMode || !Platform.isTV) return;\n    return addTvLongPressListener((key) => {\n      if (key !== "SELECT") return;\n      const id = focusedChannelId;\n      if (id) favorite(id);\n    });\n  }, [editMode, favorite, focusedChannelId, isFocused]);\n''',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''  const clearOrder = useCallback(() => {\n''',
    '''  const listExtraData = useMemo(\n    () => ({ favorites, editMode, order: customize.customOrder }),\n    [customize.customOrder, editMode, favorites],\n  );\n\n  const clearOrder = useCallback(() => {\n''',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '            extraData={[favorites, editMode, customize.customOrder]}\n',
    '            extraData={listExtraData}\n',
)
replace(
    'frontend/app/(tabs)/channels.tsx',
    '''                onMove={move}\n                preferredFocus={preferInitialFocus && index === 0}\n''',
    '''                onMove={move}\n                onFocusChannel={setFocusedChannelId}\n                preferredFocus={preferInitialFocus && index === 0}\n''',
)

print('phase9 Channels focus/long-OK patched')
