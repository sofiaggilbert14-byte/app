from pathlib import Path


ROUTES = {
    "frontend/app/(tabs)/index.tsx": "LiveTvHomeScreen",
    "frontend/app/(tabs)/guide.tsx": "PurpleGuideScreen",
    "frontend/app/(tabs)/channels.tsx": "ChannelsScreen",
    "frontend/app/(tabs)/movies.tsx": "MoviesScreen",
    "frontend/app/(tabs)/series.tsx": "SeriesScreen",
    "frontend/app/(tabs)/favorites.tsx": "FavoritesScreen",
    "frontend/app/(tabs)/reminders.tsx": "RemindersScreen",
    "frontend/app/(tabs)/search.tsx": "SearchScreen",
    "frontend/app/(tabs)/settings.tsx": "SettingsScreen",
    "frontend/app/(tabs)/epg-sources.tsx": "EpgSourcesScreen",
}


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")


def write_focus_gate() -> None:
    path = Path("frontend/src/components/FocusedTabMount.tsx")
    path.write_text(
        '''import React from "react";\nimport { useIsFocused } from "@react-navigation/native";\n\n/**\n * Expo Router tab routes stay mounted after navigation. Mount the real screen\n * subtree only while its tab owns focus so hidden lists, Guide subscriptions,\n * settings listeners and search/database state cannot compete with fullscreen\n * playback or remain resident in RAM.\n */\nexport function FocusedTabMount({ children }: { children: React.ReactNode }) {\n  const isFocused = useIsFocused();\n  return isFocused ? <>{children}</> : null;\n}\n''',
        encoding="utf-8",
    )


def patch_route(path_string: str, name: str) -> None:
    path = Path(path_string)
    text = path.read_text(encoding="utf-8")
    import_line = 'import { FocusedTabMount } from "@/src/components/FocusedTabMount";\n'
    if import_line not in text:
        react_end = text.find('\n', text.find('from "react";'))
        if react_end < 0:
            raise SystemExit(f"{path_string}: React import anchor missing")
        react_end += 1
        text = text[:react_end] + import_line + text[react_end:]

    content_decl = f"function {name}Content() {{"
    original_decl = f"export default function {name}() {{"
    if content_decl not in text:
        text = replace_once(text, original_decl, content_decl, f"{name} content split")

    wrapper = f'''\n\nexport default function {name}() {{\n  return (\n    <FocusedTabMount>\n      <{name}Content />\n    </FocusedTabMount>\n  );\n}}\n'''
    if wrapper.strip() not in text:
        text = text.rstrip() + wrapper
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


write_focus_gate()
for route, component in ROUTES.items():
    patch_route(route, component)
patch_root_maintenance()
print("persistent tab content unmount/player isolation repair applied")
