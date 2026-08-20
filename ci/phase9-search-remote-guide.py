from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:140]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

path = 'frontend/app/(tabs)/search.tsx'

replace(
    path,
    '''  useEffect(() => {\n    if (!isTV) return;\n    return addTvKeyListener((key) => {\n      if (key !== "LEFT") return;''',
    '''  useEffect(() => {\n    if (!isTV || !isFocused) return;\n    return addTvKeyListener((key) => {\n      if (key !== "LEFT") return;''',
)
replace(
    path,
    '''  }, [isTV, openDrawer]);''',
    '''  }, [isFocused, isTV, openDrawer]);''',
)
replace(
    path,
    '''    }, [router],\n  );''',
    '''    }, [router],\n  );''',
)
replace(
    path,
    '''        group: channel.group || "All",''',
    '''        // Provider/M3U groups may be intentionally hidden in Phase 9.\n        // Anchor Search jumps through All; the Guide restores the exact channel\n        // without depending on a raw provider category being visible.\n        group: "All",''',
)

# A hidden persistent Search tab must never retain keyboard ownership state.
anchor = '''  useEffect(() => {\n    const timer = setTimeout(() => setDebouncedQuery(query), 180);\n    return () => clearTimeout(timer);\n  }, [query]);\n'''
insert = anchor + '''\n  useEffect(() => {\n    if (!isFocused) focusZoneRef.current = null;\n  }, [isFocused]);\n'''
replace(path, anchor, insert)

print('phase9 Search remote ownership and Guide jump repaired')
