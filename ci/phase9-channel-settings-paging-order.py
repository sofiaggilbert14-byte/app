from pathlib import Path

p = Path('frontend/app/(tabs)/settings.tsx')
s = p.read_text(encoding='utf-8')
old = '''  const channelEditPageCount = Math.max(1, Math.ceil(channels.length / 100));
  const customizeChannels = useMemo(() => channels.slice(channelEditPage * 100, channelEditPage * 100 + 100), [channelEditPage, channels]);
  const hiddenSet = useMemo(() => new Set(channelCustomize.hiddenIds), [channelCustomize.hiddenIds]);'''
new = '''  const channelEditPageCount = Math.max(1, Math.ceil(channels.length / 100));
  const channelEditIds = useMemo(
    () => section === "channels" ? channels.map((channel) => channel.id) : [],
    [channels, section],
  );
  const customizeChannels = useMemo(() => channels.slice(channelEditPage * 100, channelEditPage * 100 + 100), [channelEditPage, channels]);
  const hiddenSet = useMemo(() => new Set(channelCustomize.hiddenIds), [channelCustomize.hiddenIds]);

  useEffect(() => {
    if (section !== "channels") return;
    setChannelEditPage((current) => Math.max(0, Math.min(channelEditPageCount - 1, current)));
    setFocusedCustomizeId(null);
  }, [channelEditPageCount, channels, section]);'''
if old not in s:
    raise SystemExit('guard failed: channel paging declaration block not found')
s = s.replace(old, new, 1)
old = '''onPress={() => channelCustomize.moveInCustomOrder(channel.id, -1)}'''
new = '''onPress={() => channelCustomize.moveInCustomOrder(channel.id, -1, channelEditIds)}'''
if old not in s:
    raise SystemExit('guard failed: settings move-up handler not found')
s = s.replace(old, new, 1)
old = '''onPress={() => channelCustomize.moveInCustomOrder(channel.id, 1)}'''
new = '''onPress={() => channelCustomize.moveInCustomOrder(channel.id, 1, channelEditIds)}'''
if old not in s:
    raise SystemExit('guard failed: settings move-down handler not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
