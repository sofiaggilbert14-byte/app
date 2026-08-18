from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / 'frontend/app/group-settings.tsx'
s = p.read_text(encoding='utf-8')

def rep(old: str, new: str):
    global s
    if old not in s:
        raise SystemExit(f'group settings anchor missing: {old[:140]!r}')
    s = s.replace(old, new, 1)

rep('import React, { useMemo, useState } from "react";', 'import React, { useCallback, useEffect, useMemo, useState } from "react";')
rep('import { fonts, radius, tvColors } from "@/src/theme";', 'import { fonts, radius, tvColors } from "@/src/theme";\nimport { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";')
rep('  const [page, setPage] = useState(0);', '''  const [page, setPage] = useState(0);\n  const [preferBackFocus, setPreferBackFocus] = useState(true);\n\n  useEffect(() => {\n    const timer = setTimeout(() => setPreferBackFocus(false), 360);\n    return () => clearTimeout(timer);\n  }, []);\n\n  const returnToSettings = useCallback(() => {\n    router.replace("/settings" as any);\n  }, [router]);\n\n  useTvBackHandler(useCallback(() => {\n    returnToSettings();\n    return true;\n  }, [returnToSettings]));''')
rep('          <Pressable hasTVPreferredFocus onPress={() => router.replace("/settings" as any)}', '          <Pressable hasTVPreferredFocus={preferBackFocus} onPress={returnToSettings}')
rep('  page: { flex: 1, backgroundColor: tvColors.background, padding: 18 },', '  page: { flex: 1, backgroundColor: tvColors.canvas, padding: 18 },')
rep('borderColor: tvColors.border', 'borderColor: tvColors.line')
s = s.replace('backgroundColor: tvColors.card', 'backgroundColor: tvColors.panel')
s = s.replace('borderColor: tvColors.border', 'borderColor: tvColors.line')

# Keep selected group valid after deleting it or after persisted groups change.
anchor = '  const selected = custom.groups.find((group) => group.id === selectedId) || null;\n'
insert = anchor + '''  useEffect(() => {\n    if (selectedId && !custom.groups.some((group) => group.id === selectedId)) {\n      setSelectedId(custom.groups[0]?.id || null);\n      setPage(0);\n    }\n  }, [custom.groups, selectedId]);\n'''
rep(anchor, insert)

p.write_text(s, encoding='utf-8')
print('phase9 group settings theme/focus/back integration repaired')
