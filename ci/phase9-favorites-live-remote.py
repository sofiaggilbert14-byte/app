from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:150]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

path = 'frontend/app/(tabs)/favorites.tsx'
replace(path,
    'import React, { memo, useCallback, useEffect, useMemo, useState } from "react";\nimport { FlatList, Pressable, StyleSheet, Text, View } from "react-native";',
    'import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";\nimport { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";')
replace(path,
    'import { nextFavoriteFolderName } from "@/src/core/favoriteFolders";',
    'import { nextFavoriteFolderName } from "@/src/core/favoriteFolders";\nimport { useGuidePrograms } from "@/src/core/guideProgramsStore";\nimport { addTvLongPressListener } from "@/src/utils/tvRemote";')
replace(path,
    '  onLongPress,\n}: {',
    '  onLongPress,\n  onFocusChannel,\n}: {')
replace(path,
    '  onLongPress: (id: string) => void;\n}) {\n  const current = nowNext(channel.programs, now).current;',
    '  onLongPress: (id: string) => void;\n  onFocusChannel: (id: string | null) => void;\n}) {\n  const programmes = useGuidePrograms(channel.id);\n  const current = nowNext(programmes.length ? programmes : channel.programs, now).current;\n  const isTV = Platform.OS !== "web" && Platform.isTV;')
replace(path,
    '      onPress={() => onPlay(channel)}\n      onLongPress={() => onLongPress(channel.id)}\n      delayLongPress={450}',
    '      onFocus={() => onFocusChannel(channel.id)}\n      onBlur={() => onFocusChannel(null)}\n      onPress={() => onPlay(channel)}\n      onLongPress={isTV ? undefined : () => onLongPress(channel.id)}\n      delayLongPress={450}')
replace(path,
    '  const [preferInitialFocus, setPreferInitialFocus] = useState(true);',
    '  const [preferInitialFocus, setPreferInitialFocus] = useState(true);\n  const focusedChannelIdRef = useRef<string | null>(null);\n  const isTV = Platform.OS !== "web" && Platform.isTV;')
replace(path,
    '  const onLongPress = useCallback((id: string) => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    if (folderMode) toggleFavoriteFolderChannel(folderId, id);\n    else toggleFavorite(id);\n  }, [folderId, folderMode, toggleFavorite, toggleFavoriteFolderChannel]);',
    '''  const onLongPress = useCallback((id: string) => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    if (folderMode) toggleFavoriteFolderChannel(folderId, id);\n    else toggleFavorite(id);\n  }, [folderId, folderMode, toggleFavorite, toggleFavoriteFolderChannel]);\n\n  const noteChannelFocus = useCallback((id: string | null) => {\n    focusedChannelIdRef.current = id;\n  }, []);\n\n  useEffect(() => {\n    if (!isTV || !isFocused) return;\n    return addTvLongPressListener((key) => {\n      if (key !== "SELECT") return;\n      const id = focusedChannelIdRef.current;\n      if (id) onLongPress(id);\n    });\n  }, [isFocused, isTV, onLongPress]);''')
replace(path,
    '                onLongPress={onLongPress}\n              />',
    '                onLongPress={onLongPress}\n                onFocusChannel={noteChannelFocus}\n              />')

print('phase9 Favorites live EPG and centralized long-OK repaired')
