from pathlib import Path


def patch(path_str: str, old: str, new: str, label: str) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"{label}: anchor not found in {path_str}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

patch(
    "frontend/src/core/localLogoFolder.ts",
    '''export function useLocalLogo(channelName: string): string | undefined {\n  const [, setVersion] = useState(0);\n  useEffect(() => {\n    let cancelled = false;\n    void loadLocalLogoFolder().then(() => {\n      if (!cancelled) setVersion((value) => value + 1);\n    });\n    const listener = () => {\n      if (!cancelled) setVersion((value) => value + 1);\n    };\n    listeners.add(listener);\n    return () => {\n      cancelled = true;\n      listeners.delete(listener);\n    };\n  }, []);\n  return resolveLocalLogo(channelName);\n}\n''',
    '''export function useLocalLogo(channelName: string): string | undefined {\n  const [, setVersion] = useState(0);\n  const active = !!channelName;\n  useEffect(() => {\n    if (!active) return;\n    let cancelled = false;\n    void loadLocalLogoFolder().then(() => {\n      if (!cancelled) setVersion((value) => value + 1);\n    });\n    const listener = () => {\n      if (!cancelled) setVersion((value) => value + 1);\n    };\n    listeners.add(listener);\n    return () => {\n      cancelled = true;\n      listeners.delete(listener);\n    };\n  }, [active]);\n  return active ? resolveLocalLogo(channelName) : undefined;\n}\n''',
    "suppressed local logo listener",
)

patch(
    "frontend/tests/epgMatching.test.mjs",
    '''  assert.match(native, /Never mutate EMPTY_PROGRAMS/);\n''',
    '''  assert.match(native, /const EMPTY_PROGRAMS: Program\\[\\] = \\[\\]/);\n  assert.doesNotMatch(native, /EMPTY_PROGRAMS\\.(?:push|pop|shift|unshift|splice|sort|reverse)\\(/);\n''',
    "EMPTY_PROGRAMS behavioral invariant",
)
