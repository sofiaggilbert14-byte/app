from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def rep(path: Path, old: str, new: str):
    text = path.read_text(encoding='utf-8')
    c = text.count(old)
    if c != 1:
        raise SystemExit(f'{path}: anchor mismatch {c}: {old[:110]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

phase9 = ROOT / 'src/core/phase9GuideGroups.ts'
text = phase9.read_text(encoding='utf-8')
text = text.replace('favoriteSet: ReadonlySet<string>;', 'favoriteSet: Set<string>;')
text = text.replace('recentIds: ReadonlySet<string>;', 'recentIds: Set<string>;')
text = text.replace('hiddenIds: ReadonlySet<string>;', 'hiddenIds: Set<string>;')
text = text.replace('favoriteSet: new Set(opts.favoriteSet),', 'favoriteSet: opts.favoriteSet,')
phase9.write_text(text, encoding='utf-8')

guide = ROOT / 'app/(tabs)/guide.tsx'
rep(
    guide,
    'import {\n  buildGroupCounts,\n  buildVisibleGroups,\n  filterChannelsByGroup,\n  listPlaylistGroupNames,\n  pinGroup,\n  unpinGroup,\n} from "@/src/core/guideGroups";\n',
    'import { pinGroup, unpinGroup } from "@/src/core/guideGroups";\nimport {\n  buildPhase9GroupCounts,\n  buildPhase9VisibleGroups,\n  filterPhase9ChannelsByGroup,\n  listProviderGroupNames,\n} from "@/src/core/phase9GuideGroups";\nimport { useChannelGroupPreferences } from "@/src/core/channelGroupPreferences";\n',
)
rep(
    guide,
    '  } = useGuideUiPreferences();\n  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();\n',
    '  } = useGuideUiPreferences();\n  const groupPrefs = useChannelGroupPreferences();\n  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();\n',
)
rep(
    guide,
    '  const groupCounts = useMemo(\n    () =>\n      buildGroupCounts(channels, {\n        favoriteSet,\n        recentIds: recentIdSet,\n        hasEpgMatch: channelHasEpgMatch,\n        isFailed: isFailedChannel,\n        hiddenIds: hiddenIdSet,\n      }),\n    // failedCount invalidates when the in-memory failure registry grows/shrinks.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n    [channels, favoriteSet, recentIdSet, hiddenIdSet, failedCount, epgGuideFilter],\n  );\n\n  const playlistGroups = useMemo(\n    () => listPlaylistGroupNames(channels, hiddenIdSet),\n    [channels, hiddenIdSet],\n  );\n\n  const { tabs: groups, overflow: overflowGroups } = useMemo(\n    () =>\n      buildVisibleGroups({\n        counts: groupCounts,\n        pinned: pinnedGroups,\n        playlistGroups,\n        maxPlaylistTabs: 10,\n      }),\n    [groupCounts, pinnedGroups, playlistGroups],\n  );\n',
    '  const groupCounts = useMemo(\n    () =>\n      buildPhase9GroupCounts(channels, {\n        favoriteSet,\n        recentIds: recentIdSet,\n        hasEpgMatch: channelHasEpgMatch,\n        isFailed: isFailedChannel,\n        hiddenIds: hiddenIdSet,\n      }, groupPrefs),\n    // failedCount invalidates when the in-memory failure registry grows/shrinks.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n    [channels, favoriteSet, recentIdSet, hiddenIdSet, failedCount, epgGuideFilter, groupPrefs],\n  );\n\n  const playlistGroups = useMemo(\n    () => listProviderGroupNames(channels, hiddenIdSet, groupPrefs),\n    [channels, hiddenIdSet, groupPrefs],\n  );\n\n  const groups = useMemo(\n    () => buildPhase9VisibleGroups({ counts: groupCounts, pinned: pinnedGroups, providerGroups: playlistGroups, prefs: groupPrefs }),\n    [groupCounts, groupPrefs, pinnedGroups, playlistGroups],\n  );\n  const overflowGroups = useMemo<string[]>(() => [], []);\n',
)
rep(
    guide,
    '    let list = filterChannelsByGroup(channels, group, {\n      favoriteSet,\n      recent,\n      recentIds: recentIdSet,\n      hasEpgMatch: channelHasEpgMatch,\n      isFailed: isFailedChannel,\n      hiddenIds: hiddenIdSet,\n      customOrder,\n    });\n',
    '    let list = filterPhase9ChannelsByGroup(channels, group, {\n      favoriteSet,\n      recent,\n      recentIds: recentIdSet,\n      hasEpgMatch: channelHasEpgMatch,\n      isFailed: isFailedChannel,\n      hiddenIds: hiddenIdSet,\n      customOrder,\n    }, groupPrefs);\n',
)
rep(
    guide,
    '  }, [channels, customOrder, epgGuideFilter, favoriteSet, group, hiddenIdSet, recent, recentIdSet]);\n',
    '  }, [channels, customOrder, epgGuideFilter, favoriteSet, group, groupPrefs, hiddenIdSet, recent, recentIdSet]);\n',
)

print('Phase 9 group resolver integrated')
