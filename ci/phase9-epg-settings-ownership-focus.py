from pathlib import Path

p = Path('frontend/app/(tabs)/epg-sources.tsx')
s = p.read_text()
s = s.replace('import { channelHasEpgMatch } from "@/src/core/epgUserOverrides";','import { channelHasOwnedEpgMatch } from "@/src/core/epgUserOverrides";\nimport { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";')
s = s.replace('  const guideUi = useGuideUiPreferences();','  const guideUi = useGuideUiPreferences();\n  const epgOwnership = useEpgSourcePreferences();')
s = s.replace('    const focusTimer = setTimeout(() => setPreferTopFocus(false), 700);','    const focusTimer = setTimeout(() => setPreferTopFocus(false), 180);')
s = s.replace('      if (channelHasEpgMatch(channel)) item.matched += 1;','      if (channelHasOwnedEpgMatch(channel, epgOwnership)) item.matched += 1;')
s = s.replace('  }, [channels]);','  }, [channels, epgOwnership.primaryEnabled, epgOwnership.userEnabled, epgOwnership.userOverrides]);',1)
if 'channelHasEpgMatch(channel)' in s:
    raise SystemExit('legacy EPG matcher still present')
if 'setPreferTopFocus(false), 700' in s:
    raise SystemExit('700ms focus window still present')
p.write_text(s)
