from pathlib import Path

p = Path(__file__).resolve().parents[1] / "app/(tabs)/settings.tsx"
text = p.read_text(encoding="utf-8")

def rep(old: str, new: str):
    global text
    c = text.count(old)
    if c != 1:
        raise SystemExit(f"anchor mismatch {c}: {old[:100]!r}")
    text = text.replace(old, new, 1)

rep(
    'const ADULT_GROUP_RE = /adult|xxx|porn/i;\n',
    'const ADULT_GROUP_RE = /adult|xxx|porn/i;\nconst CHANNEL_CUSTOMIZE_PAGE_SIZE = 100;\n',
)
rep(
    '  const [focusedCustomizeId, setFocusedCustomizeId] = useState<string | null>(null);\n',
    '  const [focusedCustomizeId, setFocusedCustomizeId] = useState<string | null>(null);\n  const [channelCustomizePage, setChannelCustomizePage] = useState(0);\n',
)
rep(
    '  const customizeChannels = useMemo(() => channels.slice(0, 30), [channels]);\n  const hiddenSet = useMemo(() => new Set(channelCustomize.hiddenIds), [channelCustomize.hiddenIds]);\n',
    '  const allChannelIds = useMemo(() => channels.map((channel) => channel.id).filter(Boolean), [channels]);\n  const channelCustomizePageCount = Math.max(1, Math.ceil(channels.length / CHANNEL_CUSTOMIZE_PAGE_SIZE));\n  const boundedCustomizePage = Math.min(channelCustomizePage, channelCustomizePageCount - 1);\n  const customizeStartIndex = boundedCustomizePage * CHANNEL_CUSTOMIZE_PAGE_SIZE;\n  const customizeChannels = useMemo(\n    () => channels.slice(customizeStartIndex, customizeStartIndex + CHANNEL_CUSTOMIZE_PAGE_SIZE),\n    [channels, customizeStartIndex],\n  );\n  const hiddenSet = useMemo(() => new Set(channelCustomize.hiddenIds), [channelCustomize.hiddenIds]);\n',
)
rep(
    '  const choose = useCallback((id: Section) => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    setBackupStatus(null);\n    setClearFavoritesArmed(false);\n',
    '  const choose = useCallback((id: Section) => {\n    void Haptics.selectionAsync().catch(() => undefined);\n    setBackupStatus(null);\n    setClearFavoritesArmed(false);\n    if (id === "channels") {\n      setChannelCustomizePage(0);\n      setFocusedCustomizeId(null);\n    }\n',
)
rep(
    '                <Text style={styles.help}>\n                  Cap of 30 rows for TV memory. Focus a channel, then Hide, Move, or set a custom number. Clear custom order resets sort.\n                </Text>\n',
    '                <Text style={styles.help}>\n                  All playlist channels are available in bounded pages of 100 so large providers stay memory-safe. Focus a channel, then Hide, Move, or set a custom number.\n                </Text>\n                <InfoRow label="Channel page" value={`${boundedCustomizePage + 1} / ${channelCustomizePageCount} · ${channels.length} total`} />\n                <View style={styles.channelEditActions}>\n                  <Pressable\n                    disabled={boundedCustomizePage <= 0}\n                    onPress={() => {\n                      setFocusedCustomizeId(null);\n                      setChannelCustomizePage((value) => Math.max(0, value - 1));\n                    }}\n                    style={({ focused: btnFocused }: any) => [styles.miniAction, boundedCustomizePage <= 0 && styles.actionDisabled, btnFocused && styles.focused]}\n                    testID="settings-channels-prev-page"\n                  >\n                    <Text style={styles.miniActionText}>Previous 100</Text>\n                  </Pressable>\n                  <Pressable\n                    disabled={boundedCustomizePage >= channelCustomizePageCount - 1}\n                    onPress={() => {\n                      setFocusedCustomizeId(null);\n                      setChannelCustomizePage((value) => Math.min(channelCustomizePageCount - 1, value + 1));\n                    }}\n                    style={({ focused: btnFocused }: any) => [styles.miniAction, boundedCustomizePage >= channelCustomizePageCount - 1 && styles.actionDisabled, btnFocused && styles.focused]}\n                    testID="settings-channels-next-page"\n                  >\n                    <Text style={styles.miniActionText}>Next 100</Text>\n                  </Pressable>\n                </View>\n',
)
rep(
    '                  const displayNumber = customNumber || index + 1;\n',
    '                  const providerIndex = customizeStartIndex + index;\n                  const displayNumber = customNumber || providerIndex + 1;\n',
)
rep(
    '                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, -1)}\n',
    '                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, -1, allChannelIds)}\n',
)
rep(
    '                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, 1)}\n',
    '                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, 1, allChannelIds)}\n',
)

p.write_text(text, encoding="utf-8")
print("Phase 9 channel customization pagination applied")
