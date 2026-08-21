from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")


def patch_tabs() -> None:
    path = Path("frontend/app/(tabs)/_layout.tsx")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '        sceneStyle: { backgroundColor: "#070711" },',
        '        sceneStyle: { backgroundColor: "#070711" },\n        freezeOnBlur: true,',
        "tab freeze guard",
    )
    path.write_text(text, encoding="utf-8")


def patch_search() -> None:
    path = Path("frontend/app/(tabs)/search.tsx")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '''  useEffect(() => {\n    const timer = setTimeout(() => setDebouncedQuery(query), 180);\n    return () => clearTimeout(timer);\n  }, [query]);''',
        '''  useEffect(() => {\n    if (!isFocused) {\n      setDebouncedQuery("");\n      return;\n    }\n    const timer = setTimeout(() => setDebouncedQuery(query), 180);\n    return () => clearTimeout(timer);\n  }, [isFocused, query]);''',
        "Search debounce focus gate",
    )
    text = replace_once(
        text,
        '''  useEffect(() => {\n    let cancelled = false;\n    const value = debouncedQuery.trim();''',
        '''  useEffect(() => {\n    let cancelled = false;\n    if (!isFocused) {\n      setNativePrograms([]);\n      return () => { cancelled = true; };\n    }\n    const value = debouncedQuery.trim();''',
        "Search native FTS focus gate",
    )
    text = replace_once(text, "  }, [channels, debouncedQuery]);", "  }, [channels, debouncedQuery, isFocused]);", "Search FTS focus dependency")
    path.write_text(text, encoding="utf-8")


def patch_settings() -> None:
    path = Path("frontend/app/(tabs)/settings.tsx")
    text = path.read_text(encoding="utf-8")
    if 'import { useIsFocused } from "@react-navigation/native";' not in text:
        text = replace_once(text, 'import { useRouter } from "expo-router";', 'import { useRouter } from "expo-router";\nimport { useIsFocused } from "@react-navigation/native";', "Settings focus import")
    old = "export default function SettingsScreen() {\n  const router = useRouter();"
    new = '''export default function SettingsScreen() {\n  const isFocused = useIsFocused();\n  return isFocused ? <SettingsScreenContent /> : null;\n}\n\nfunction SettingsScreenContent() {\n  const router = useRouter();'''
    text = replace_once(text, old, new, "Settings content blur unmount")
    path.write_text(text, encoding="utf-8")


def patch_epg_settings() -> None:
    path = Path("frontend/app/(tabs)/epg-sources.tsx")
    text = path.read_text(encoding="utf-8")
    if 'import { useIsFocused } from "@react-navigation/native";' not in text:
        text = replace_once(text, 'import { useFocusEffect, useRouter } from "expo-router";', 'import { useFocusEffect, useRouter } from "expo-router";\nimport { useIsFocused } from "@react-navigation/native";', "EPG Settings focus import")
    old = "export default function EpgSourcesScreen() {\n  const router = useRouter();"
    new = '''export default function EpgSourcesScreen() {\n  const isFocused = useIsFocused();\n  return isFocused ? <EpgSourcesContent /> : null;\n}\n\nfunction EpgSourcesContent() {\n  const router = useRouter();'''
    text = replace_once(text, old, new, "EPG Settings content blur unmount")
    path.write_text(text, encoding="utf-8")


def patch_root_maintenance() -> None:
    path = Path("frontend/app/_layout.tsx")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '''  useEffect(() => {\n    if (reminders.length === 0) return;\n    // Expire due reminders without hijacking an active player session.''',
        '''  useEffect(() => {\n    if (reminders.length === 0 || pathname?.startsWith("/player")) return;\n    // Expire due reminders only outside fullscreen playback. OS notification\n    // delivery remains independent; this cleanup is maintenance, not playback work.''',
        "reminder maintenance playback gate",
    )
    text = replace_once(
        text,
        '    const timer = setInterval(check, pathname?.startsWith("/player") ? 60000 : 30000);',
        '    const timer = setInterval(check, 30000);',
        "reminder cleanup idle cadence",
    )
    path.write_text(text, encoding="utf-8")


patch_tabs()
patch_search()
patch_settings()
patch_epg_settings()
patch_root_maintenance()
print("persistent tab lifecycle repair applied")
