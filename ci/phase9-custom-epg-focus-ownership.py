from pathlib import Path

p = Path('frontend/app/epg-custom.tsx')
s = p.read_text(encoding='utf-8')

old = '''  const [xmltvRows, setXmltvRows] = useState<XmltvRow[]>([]);
  const [xmltvTotal, setXmltvTotal] = useState(0);
  const queryGeneration = useRef(0);
'''
new = '''  const [xmltvRows, setXmltvRows] = useState<XmltvRow[]>([]);
  const [xmltvTotal, setXmltvTotal] = useState(0);
  const [preferBackFocus, setPreferBackFocus] = useState(true);
  const queryGeneration = useRef(0);
'''
if old not in s:
    raise SystemExit('guard failed: state block not found')
s = s.replace(old, new, 1)

old = '''  useEffect(() => {
    if (!urlTouched) setUrlDraft(prefs.userUrl);
  }, [prefs.userUrl, urlTouched]);
'''
new = '''  useEffect(() => {
    if (!urlTouched) setUrlDraft(prefs.userUrl);
  }, [prefs.userUrl, urlTouched]);

  useEffect(() => {
    const timer = setTimeout(() => setPreferBackFocus(false), 550);
    return () => clearTimeout(timer);
  }, []);
'''
if old not in s:
    raise SystemExit('guard failed: url sync effect not found')
s = s.replace(old, new, 1)

old = '''      prefs.setUserOverride(channel.id, xmltvId);
      await setNativeGuideChannelBinding(channel.id, xmltvId);
      invalidateGuideOwnershipCaches();
'''
new = '''      const overrides = { ...prefs.userOverrides, [channel.id]: xmltvId };
      prefs.setUserOverride(channel.id, xmltvId);
      await setNativeGuideChannelBinding(channel.id, xmltvId);
      await configureNativeGuideOwnership(
        prefs.primaryEnabled,
        prefs.userEnabled,
        prefs.userUrl,
        overrides,
      );
      invalidateGuideOwnershipCaches();
'''
if old not in s:
    raise SystemExit('guard failed: assign block not found')
s = s.replace(old, new, 1)

old = '''      prefs.setUserOverride(channel.id, null);
      await setNativeGuideChannelBinding(channel.id, null);
      invalidateGuideOwnershipCaches();
'''
new = '''      const overrides = { ...prefs.userOverrides };
      delete overrides[channel.id];
      prefs.setUserOverride(channel.id, null);
      await setNativeGuideChannelBinding(channel.id, null);
      await configureNativeGuideOwnership(
        prefs.primaryEnabled,
        prefs.userEnabled,
        prefs.userUrl,
        overrides,
      );
      invalidateGuideOwnershipCaches();
'''
if old not in s:
    raise SystemExit('guard failed: clear block not found')
s = s.replace(old, new, 1)

old = '''          <Pressable hasTVPreferredFocus onPress={() => router.replace("/epg-sources" as any)} style={({ focused }: any) => [styles.back, focused && styles.focused]}>
'''
new = '''          <Pressable hasTVPreferredFocus={preferBackFocus} onPress={() => router.replace("/epg-sources" as any)} style={({ focused }: any) => [styles.back, focused && styles.focused]}>
'''
if old not in s:
    raise SystemExit('guard failed: back button not found')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
