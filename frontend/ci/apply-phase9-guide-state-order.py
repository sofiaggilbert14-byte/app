from pathlib import Path

p = Path(__file__).resolve().parents[1] / "app/(tabs)/guide.tsx"
text = p.read_text(encoding="utf-8")
old = '  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();\n  const hiddenIdSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);\n  const { isGroupLocked, unlockGroup, verifyPin, hasPin } = useParentalPin();\n'
new = '  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();\n  const hiddenIdSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);\n  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);\n  const { isGroupLocked, unlockGroup, verifyPin, hasPin } = useParentalPin();\n'
if text.count(old) != 1:
    raise SystemExit('state insertion anchor mismatch')
text = text.replace(old, new, 1)
old2 = '  const [now, setNow] = useState(() => new Date().toISOString());\n  const [group, setGroup] = useState(() => guideSessionGroup);\n  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);\n'
new2 = '  const [now, setNow] = useState(() => new Date().toISOString());\n  const [group, setGroup] = useState(() => guideSessionGroup);\n'
if text.count(old2) != 1:
    raise SystemExit('state removal anchor mismatch')
p.write_text(text.replace(old2, new2, 1), encoding='utf-8')
print('Guide drawer state order repaired')
