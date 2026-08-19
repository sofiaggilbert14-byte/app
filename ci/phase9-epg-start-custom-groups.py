from pathlib import Path

p = Path('frontend/app/(tabs)/epg-sources.tsx')
s = p.read_text()
if 'useCustomGuideGroups' not in s:
    s = s.replace('import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";','import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";\nimport { useCustomGuideGroups } from "@/src/core/customGuideGroups";')
s = s.replace('  const epgOwnership = useEpgSourcePreferences();','  const epgOwnership = useEpgSourcePreferences();\n  const customGuideGroups = useCustomGuideGroups();')
s = s.replace('      ...guideUi.pinnedGroups,\n      guideUi.startGroup !== GUIDE_START_LAST_USED ? guideUi.startGroup : "",','      ...guideUi.pinnedGroups,\n      ...customGuideGroups.groups.map((item) => item.name),\n      guideUi.startGroup !== GUIDE_START_LAST_USED ? guideUi.startGroup : "",')
old = '      !!name &&\n      (name === "All" || name === "Favorites" || actualGroups.has(name) || STANDARD_GUIDE_GROUPS.includes(name as any)),\n    );'
new = '      !!name &&\n      !guideUi.hiddenGroups.includes(name) &&\n      (name === "All" || name === "Favorites" || customGuideGroups.byName.has(name) || actualGroups.has(name) || STANDARD_GUIDE_GROUPS.includes(name as any)),\n    );'
if old not in s:
    raise SystemExit('start group filter anchor not found')
s = s.replace(old, new)
s = s.replace('  }, [channels, guideUi.pinnedGroups, guideUi.startGroup]);','  }, [channels, customGuideGroups.byName, customGuideGroups.groups, guideUi.hiddenGroups, guideUi.pinnedGroups, guideUi.startGroup]);')
s = s.replace('<SourceRow title="Primary XMLTV Guide" subtitle="Managed by CharmIPTV · locked source" status={status.error ? "Guide error — see below" : "Active"} />','<SourceRow title="Primary XMLTV Guide" subtitle="Managed by CharmIPTV · locked source" status={!epgOwnership.primaryEnabled ? "Disabled" : status.error ? "Guide error — see below" : "Active"} />\n              <SourceRow title="User XMLTV Guide" subtitle="Optional custom source · per-channel overrides" status={!epgOwnership.userEnabled ? "Disabled" : epgOwnership.userUrl ? `${Object.keys(epgOwnership.userOverrides).length} assigned channels` : "Enabled · URL required"} />')
p.write_text(s)
