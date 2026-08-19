from pathlib import Path

p = Path('frontend/src/core/guideGroups.ts')
s = p.read_text(encoding='utf-8')
old = '''    hiddenIds: Set<string>;
    customGroups?: ReadonlyMap<string, ReadonlySet<string>>;
  },
): GroupCountMap {'''
new = '''    hiddenIds: Set<string>;
    customGroups?: ReadonlyMap<string, ReadonlySet<string>>;
    includeProviderGroups?: boolean;
  },
): GroupCountMap {'''
if old not in s:
    raise SystemExit('guard failed: buildGroupCounts options block not found')
s = s.replace(old, new, 1)
old = '''    const raw = String(channel.group || "").trim();
    if (raw) counts[raw] = (counts[raw] || 0) + 1;'''
new = '''    if (opts.includeProviderGroups) {
      const raw = String(channel.group || "").trim();
      if (raw) counts[raw] = (counts[raw] || 0) + 1;
    }'''
if old not in s:
    raise SystemExit('guard failed: raw provider count block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

p = Path('frontend/app/(tabs)/guide.tsx')
s = p.read_text(encoding='utf-8')
old = '''        hiddenIds: hiddenIdSet,
        customGroups: customGuideGroups.byName,
      }),'''
new = '''        hiddenIds: hiddenIdSet,
        customGroups: customGuideGroups.byName,
        includeProviderGroups: showProviderGroups,
      }),'''
if old not in s:
    raise SystemExit('guard failed: guide group count call not found')
s = s.replace(old, new, 1)
old = '''    [channels, favoriteSet, recentIdSet, hiddenIdSet, failedCount, epgGuideFilter, customGuideGroups.byName],'''
new = '''    [channels, favoriteSet, recentIdSet, hiddenIdSet, failedCount, epgGuideFilter, customGuideGroups.byName, showProviderGroups],'''
if old not in s:
    raise SystemExit('guard failed: group count deps not found')
s = s.replace(old, new, 1)
old = '''  const playlistGroups = useMemo(
    () => listPlaylistGroupNames(channels, hiddenIdSet),
    [channels, hiddenIdSet],
  );'''
new = '''  const playlistGroups = useMemo(
    () => showProviderGroups ? listPlaylistGroupNames(channels, hiddenIdSet) : [],
    [channels, hiddenIdSet, showProviderGroups],
  );'''
if old not in s:
    raise SystemExit('guard failed: playlistGroups memo not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
