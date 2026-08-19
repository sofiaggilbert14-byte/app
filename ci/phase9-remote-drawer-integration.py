from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:140]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# Guide screen owns the closed-guide Back transition. The shell must not bypass
# the Phase 9 Guide -> Groups -> Main navigation ladder.
replace(
    'frontend/src/components/PurpleTvShell.tsx',
    '''        if (active === "/guide" && !drawerOpen && !activeProgram) {\n          reopenArmedAtRef.current = 0;\n          openDrawer();\n          return true;\n        }''',
    '''        if (active === "/guide" && !drawerOpen && !activeProgram) {\n          // PurpleGuideScreen owns closed-guide Back so it can enter the\n          // dedicated Groups drawer first. Never skip directly to main nav.\n          reopenArmedAtRef.current = 0;\n          return false;\n        }''',
)

# A drawer that owns focus must also make the native Guide canvas inactive.
replace(
    'frontend/app/(tabs)/guide.tsx',
    '                active={isFocused && !activeProgram && !drawerOpen}\n',
    '                active={isFocused && !activeProgram && !drawerOpen && !groupDrawerOpen}\n',
)

# Do not mirror ordinary D-pad navigation into JS on every default screen.
# Native focus owns those keys. JS raw-key delivery is reserved for pointer mode
# and fullscreen player overlays; drawer boundary keys are handled above.
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt',
    '''    if (key != null && (!TvRemoteModule.guideNavigationActive || TvRemoteModule.pointerActive)) {\n      emitRemoteEvent("TvRemoteKey", key)\n      // Pointer mode owns the D-pad entirely. Guide Up/Down must NOT be consumed —\n      // Android's focus engine moves between guide cells; JS only handles boundaries\n      // (Up → group tabs, bottom lock). Consuming Up/Down freezes guide surfing.\n      if (TvRemoteModule.pointerActive) return true\n    }''',
    '''    val mirrorToJs = TvRemoteModule.pointerActive || TvRemoteModule.remoteContext == "player"\n    if (key != null && mirrorToJs) {\n      emitRemoteEvent("TvRemoteKey", key)\n      // Pointer mode owns the D-pad entirely. Ordinary TV pages use Android's\n      // native focus engine and must not receive a duplicate JS copy of the\n      // same physical arrow; that duplicate was a source of focus drift.\n      if (TvRemoteModule.pointerActive) return true\n    }''',
)

# Fullscreen explicitly owns raw player remote events; release ownership on exit.
replace(
    'frontend/app/player.tsx',
    'import { addTvKeyListener, addTvLongPressListener } from "@/src/utils/tvRemote";\n',
    'import { addTvKeyListener, addTvLongPressListener, setRemoteContext } from "@/src/utils/tvRemote";\n',
)
replace(
    'frontend/app/player.tsx',
    '  const isTV = Platform.OS !== "web" && Platform.isTV;\n',
    '''  const isTV = Platform.OS !== "web" && Platform.isTV;\n  useEffect(() => {\n    if (!isTV) return;\n    setRemoteContext("player");\n    return () => setRemoteContext("default");\n  }, [isTV]);\n''',
)

print('phase9 remote/drawer integration patched')
