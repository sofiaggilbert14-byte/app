from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")


path = Path("frontend/src/components/TvQuickActionsOverlay.tsx")
text = path.read_text(encoding="utf-8")

text = replace_once(
    text,
    'import { addTvQuickActionsListener, emitPlayerQuickCommand, setRemoteContext, type PlayerQuickCommand, type TvQuickActionsContext } from "@/src/utils/tvRemote";',
    'import { addTvQuickActionsListener, emitPlayerQuickCommand, resetRemoteContextIfOwned, setRemoteContext, type PlayerQuickCommand, type TvQuickActionsContext } from "@/src/utils/tvRemote";',
    "Quick Actions owner-safe import",
)

text = replace_once(
    text,
    '''  const [focusClaim, setFocusClaim] = useState(false);\n  const queryGeneration = useRef(0);''',
    '''  const [focusClaim, setFocusClaim] = useState(false);\n  const queryGeneration = useRef(0);\n  const openPathRef = useRef<string | null>(null);''',
    "Quick Actions route-owner ref",
)

text = replace_once(
    text,
    '''  const close = useCallback(() => {\n    setOpen(false);\n    setMode("main");\n    setSourceChoice(null);\n    setEpgRows([]);\n    setEpgTotal(0);\n    setEpgQuery("");\n    setStatus(null);\n    setGuideProgram(null);\n    setBusy(false);\n    setRemoteContext(pathname?.startsWith("/player") ? "player" : pathname?.startsWith("/guide") ? "guide" : "default");\n  }, [pathname]);''',
    '''  const close = useCallback(() => {\n    setOpen(false);\n    setMode("main");\n    setSourceChoice(null);\n    setEpgRows([]);\n    setEpgTotal(0);\n    setEpgQuery("");\n    setStatus(null);\n    setGuideProgram(null);\n    setBusy(false);\n    openPathRef.current = null;\n    const restore = pathname?.startsWith("/player") ? "player" : pathname?.startsWith("/guide") ? "guide" : "default";\n    // A route can claim its new owner before a stale modal close runs. Release\n    // only if Quick Actions still owns the remote context so modal teardown can\n    // never overwrite the player/Guide/drawer that replaced it.\n    resetRemoteContextIfOwned("modal", restore);\n  }, [pathname]);''',
    "Quick Actions owner-safe close",
)

text = replace_once(
    text,
    '''    setMode("main");\n    setStatus(null);\n    setSourceChoice(null);\n    setOpen(true);\n    setRemoteContext("modal");\n  }), [channelById, openProgram, resolvePlayerChannelId]);''',
    '''    setMode("main");\n    setStatus(null);\n    setSourceChoice(null);\n    openPathRef.current = pathname || "";\n    setOpen(true);\n    setRemoteContext("modal");\n  }), [channelById, openProgram, pathname, resolvePlayerChannelId]);''',
    "Quick Actions origin route capture",
)

route_effect = '''\n  useEffect(() => {\n    if (!open) return;\n    const openedPath = openPathRef.current;\n    if (openedPath == null || openedPath === (pathname || "")) return;\n    // Automatic navigation (sleep timer, player recovery exit, etc.) must not\n    // leave a stale modal/focus layer running over the next screen.\n    close();\n  }, [close, open, pathname]);\n'''
anchor = '''\n  useEffect(() => {\n    if (!open) return;\n    setFocusClaim(false);'''
if route_effect not in text:
    if anchor not in text:
        raise SystemExit("Quick Actions route-change insertion point not found")
    text = text.replace(anchor, route_effect + anchor, 1)

path.write_text(text, encoding="utf-8")


test_path = Path("frontend/tests/quickActionsContext.test.mjs")
test = test_path.read_text(encoding="utf-8")
case = '''\ntest("Quick Actions releases modal ownership safely and closes on route replacement", async () => {\n  const overlay = await source("src/components/TvQuickActionsOverlay.tsx");\n  assert.match(overlay, /resetRemoteContextIfOwned\\("modal", restore\\)/);\n  assert.match(overlay, /const openPathRef = useRef<string \\| null>\\(null\\)/);\n  assert.match(overlay, /openPathRef\\.current = pathname \\|\\| ""/);\n  assert.match(overlay, /openedPath !== \\(pathname \\|\\| ""\\)/);\n  assert.match(overlay, /if \\(openedPath == null \\|\\| openedPath === \\(pathname \\|\\| ""\\)\\) return;[\\s\\S]{0,180}close\\(\\)/);\n  assert.doesNotMatch(overlay, /setRemoteContext\\(pathname\\?\\.startsWith/);\n});\n'''
if case not in test:
    test += case
test_path.write_text(test, encoding="utf-8")
