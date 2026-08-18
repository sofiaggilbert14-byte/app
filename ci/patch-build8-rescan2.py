from pathlib import Path


def patch(path_str: str, old: str, new: str, label: str) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"{label}: anchor not found in {path_str}; refusing fuzzy patch")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

# 1) Preserve configured HTTP/HTTPS source URLs and avoid reparsing the entire
# existing 6k+ channel cache while a new cache graph/string is already resident.
source = "frontend/src/source.native.ts"
patch(
    source,
    'let lastNativeMatchWriteFingerprint = "";\n',
    'let lastNativeMatchWriteFingerprint = "";\n/** True only when this process successfully parsed or promoted the primary channel cache. */\nlet channelCacheKnownGood = false;\n',
    "source cache known-good state",
)
patch(
    source,
    '''function https(url: string): string {\n  return url && url.startsWith("http://") ? `https://${url.slice(7)}` : url;\n}\n''',
    '''function sourceUrl(url: string): string {\n  // Preserve provider protocol exactly. Sideload builds intentionally allow\n  // cleartext HTTP for Xtream-style servers (often :25461); forcing HTTPS here\n  // makes otherwise valid M3U/XMLTV endpoints unreachable.\n  return (url || "").trim();\n}\n''',
    "preserve source protocol",
)
for old, new, label in [
    ('fetchNativePlaylist(https(SOURCE_M3U))', 'fetchNativePlaylist(sourceUrl(SOURCE_M3U))', 'M3U source protocol'),
    ('configureNativeEpgSource(https(SOURCE_EPG), refreshPreferences.epgHours)', 'configureNativeEpgSource(sourceUrl(SOURCE_EPG), refreshPreferences.epgHours)', 'EPG configure protocol 1'),
    ('refreshNativeEpg(\n        https(SOURCE_EPG),', 'refreshNativeEpg(\n        sourceUrl(SOURCE_EPG),', 'EPG refresh protocol 1'),
]:
    patch(source, old, new, label)
# The same EPG configure/refresh pair exists in refreshEpgOnly.
patch(source, 'configureNativeEpgSource(https(SOURCE_EPG), refreshPreferences.epgHours)', 'configureNativeEpgSource(sourceUrl(SOURCE_EPG), refreshPreferences.epgHours)', 'EPG configure protocol 2')
patch(source, 'refreshNativeEpg(\n        https(SOURCE_EPG),', 'refreshNativeEpg(\n        sourceUrl(SOURCE_EPG),', 'EPG refresh protocol 2')

patch(
    source,
    '''async function readChannelCache(): Promise<NativeMeta | null> {\n  const primary = await readMetaFile(CHANNEL_CACHE);\n  if (primary) return primary;\n  const backup = await readMetaFile(CHANNEL_CACHE_BAK);\n  return backup || null;\n}\n''',
    '''async function readChannelCache(): Promise<NativeMeta | null> {\n  const primary = await readMetaFile(CHANNEL_CACHE);\n  if (primary) {\n    channelCacheKnownGood = true;\n    return primary;\n  }\n  channelCacheKnownGood = false;\n  const backup = await readMetaFile(CHANNEL_CACHE_BAK);\n  return backup || null;\n}\n''',
    "cache parse ownership",
)
patch(
    source,
    '''  // Parse at most the existing primary. We generate the temp JSON ourselves, so\n  // reparsing temp + promoted copies only duplicates the full 6k-channel graph.\n  // A corrupt primary is never rotated over a known last-good backup.\n  const validCurrent = await readMetaFile(CHANNEL_CACHE);\n  if (validCurrent) {\n    await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);\n    await FileSystem.moveAsync({ from: CHANNEL_CACHE, to: CHANNEL_CACHE_BAK });\n  } else {\n    await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);\n  }\n''',
    '''  // Do not parse the previous 6k+ channel JSON while the new metadata graph and\n  // serialized JSON are both live. `channelCacheKnownGood` is set only by a\n  // successful primary parse/promotion; an existing backup remains untouched when\n  // the primary was not proven good in this process.\n  const currentInfo = await FileSystem.getInfoAsync(CHANNEL_CACHE).catch(() => null);\n  if (channelCacheKnownGood && currentInfo?.exists) {\n    await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);\n    await FileSystem.moveAsync({ from: CHANNEL_CACHE, to: CHANNEL_CACHE_BAK });\n  } else {\n    await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);\n  }\n''',
    "cache write avoids reparse",
)
patch(
    source,
    '''    await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);\n  } catch (error) {\n''',
    '''    await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);\n    channelCacheKnownGood = true;\n  } catch (error) {\n    channelCacheKnownGood = false;\n''',
    "cache promotion state",
)
patch(
    source,
    '''function playlistIdentityFingerprint(channels: Channel[]): string {\n''',
    '''function buildXmltvChannelIdSet(\n  logos: Record<string, string>,\n  names: Record<string, string>,\n  programIds: Iterable<string>,\n): Set<string> {\n  const ids = new Set<string>();\n  for (const id in logos) if (id) ids.add(id);\n  for (const id in names) if (id) ids.add(id);\n  for (const id of programIds) if (id) ids.add(id);\n  return ids;\n}\n\nfunction playlistIdentityFingerprint(channels: Channel[]): string {\n''',
    "incremental XMLTV id set helper",
)
old_set = '''        channelIds: new Set([\n          ...Object.keys(epgLogos),\n          ...Object.keys(epgNames),\n          ...(epg.channelIdsWithPrograms || []),\n        ]),'''
new_set = '''        channelIds: buildXmltvChannelIdSet(\n          epgLogos,\n          epgNames,\n          epg.channelIdsWithPrograms || [],\n        ),'''
patch(source, old_set, new_set, "XMLTV id set refresh all")
patch(source, old_set, new_set, "XMLTV id set EPG-only")
patch(
    source,
    '''  clearGuidePrograms();\n  viewportGuideChannelIds = null;\n''',
    '''  clearGuidePrograms();\n  viewportGuideChannelIds = null;\n  priorityMatchChannelIds = [];\n  channelCacheKnownGood = false;\n''',
    "guide cache full reset",
)

# 2) Build XMLTV indexes without temporary all-entry arrays.
matching = "frontend/src/core/epgMatching.ts"
patch(
    matching,
    '''  for (const [id, name] of Object.entries(names)) add(`n:${id}=${name}`);\n''',
    '''  for (const id in names) add(`n:${id}=${names[id]}`);\n''',
    "fingerprint names without Object.entries",
)
patch(
    matching,
    '''  const idsWithPrograms = new Set(\n    Array.from(input.idsWithPrograms || []).filter((id) => typeof id === "string" && id.trim()),\n  );\n''',
    '''  const idsWithPrograms = new Set<string>();\n  for (const id of input.idsWithPrograms || []) {\n    if (typeof id !== "string") continue;\n    const value = id.trim();\n    if (value) idsWithPrograms.add(value);\n  }\n''',
    "programme id set without Array.from filter",
)

# 3) Coalesce large custom-order AsyncStorage writes through one writer.
custom = "frontend/src/core/channelCustomize.ts"
patch(
    custom,
    '''const listeners = new Set<(value: Snapshot) => void>();\n''',
    '''const listeners = new Set<(value: Snapshot) => void>();\ntype DirtyState = { hiddenIds: boolean; customOrder: boolean; customNumbers: boolean };\nlet persistRunning = false;\nlet pendingDirty: DirtyState = { hiddenIds: false, customOrder: false, customNumbers: false };\n''',
    "custom persistence queue state",
)
patch(
    custom,
    '''async function persist(previous: Snapshot, next: Snapshot): Promise<void> {\n  cached = next;\n  loaded = true;\n  emit();\n\n  // Channel order may contain thousands of IDs. Do not JSON-serialize and write\n  // every customization blob when a focus action changed only one of them.\n  const writes: Promise<boolean>[] = [];\n  if (previous.hiddenIds !== next.hiddenIds) writes.push(storage.setItem(HIDDEN_KEY, next.hiddenIds));\n  if (previous.customOrder !== next.customOrder) writes.push(storage.setItem(ORDER_KEY, next.customOrder));\n  if (previous.customNumbers !== next.customNumbers) writes.push(storage.setItem(NUMBERS_KEY, next.customNumbers));\n  if (writes.length) await Promise.all(writes);\n}\n''',
    '''async function flushPersistence(): Promise<void> {\n  if (persistRunning) return;\n  persistRunning = true;\n  try {\n    while (pendingDirty.hiddenIds || pendingDirty.customOrder || pendingDirty.customNumbers) {\n      const dirty = pendingDirty;\n      pendingDirty = { hiddenIds: false, customOrder: false, customNumbers: false };\n      // Capture the newest snapshot only after the prior write finished. Rapid\n      // remote moves therefore collapse into one latest order write instead of\n      // building a queue of 6k-10k ID JSON serializations.\n      const snapshot = cached;\n      const writes: Promise<boolean>[] = [];\n      if (dirty.hiddenIds) writes.push(storage.setItem(HIDDEN_KEY, snapshot.hiddenIds));\n      if (dirty.customOrder) writes.push(storage.setItem(ORDER_KEY, snapshot.customOrder));\n      if (dirty.customNumbers) writes.push(storage.setItem(NUMBERS_KEY, snapshot.customNumbers));\n      if (writes.length) await Promise.all(writes);\n    }\n  } finally {\n    persistRunning = false;\n    if (pendingDirty.hiddenIds || pendingDirty.customOrder || pendingDirty.customNumbers) {\n      void flushPersistence();\n    }\n  }\n}\n\nfunction persist(previous: Snapshot, next: Snapshot): void {\n  cached = next;\n  loaded = true;\n  emit();\n  if (previous.hiddenIds !== next.hiddenIds) pendingDirty.hiddenIds = true;\n  if (previous.customOrder !== next.customOrder) pendingDirty.customOrder = true;\n  if (previous.customNumbers !== next.customNumbers) pendingDirty.customNumbers = true;\n  void flushPersistence();\n}\n''',
    "coalescing custom persistence",
)

# 4) Remove per-character-row allocations from local-logo fuzzy distance.
local_logo = "frontend/src/core/localLogoFolder.ts"
patch(
    local_logo,
    '''function distance(a: string, b: string, limit = 4): number {\n  if (Math.abs(a.length - b.length) > limit) return limit + 1;\n  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);\n  for (let i = 1; i <= a.length; i += 1) {\n    const current = [i];\n    let rowMin = i;\n    for (let j = 1; j <= b.length; j += 1) {\n      const value = Math.min(\n        current[j - 1] + 1,\n        previous[j] + 1,\n        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),\n      );\n      current[j] = value;\n      rowMin = Math.min(rowMin, value);\n    }\n    if (rowMin > limit) return limit + 1;\n    previous.splice(0, previous.length, ...current);\n  }\n  return previous[b.length];\n}\n''',
    '''function distance(a: string, b: string, limit = 4): number {\n  if (Math.abs(a.length - b.length) > limit) return limit + 1;\n  let previous = new Uint16Array(b.length + 1);\n  let current = new Uint16Array(b.length + 1);\n  for (let j = 0; j <= b.length; j += 1) previous[j] = j;\n  for (let i = 1; i <= a.length; i += 1) {\n    current[0] = i;\n    let rowMin = i;\n    for (let j = 1; j <= b.length; j += 1) {\n      const value = Math.min(\n        current[j - 1] + 1,\n        previous[j] + 1,\n        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),\n      );\n      current[j] = value;\n      rowMin = Math.min(rowMin, value);\n    }\n    if (rowMin > limit) return limit + 1;\n    const swap = previous;\n    previous = current;\n    current = swap;\n  }\n  return previous[b.length];\n}\n''',
    "fuzzy logo distance buffers",
)

# 5) If logos are intentionally suppressed, skip local-folder fuzzy matching too.
channel_logo = "frontend/src/components/ChannelLogo.tsx"
patch(
    channel_logo,
    '''  const localLogo = useLocalLogo(name);\n''',
    '''  const localLogo = useLocalLogo(!disabled && visible ? name : "");\n''',
    "suppressed logo skips local lookup",
)

# 6) Precompute native Guide row labels instead of allocating strings per repaint.
native_guide = "frontend/android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"
patch(
    native_guide,
    '''  private data class ChannelRow(val id: String, val name: String, val number: String)\n''',
    '''  private data class ChannelRow(val id: String, val name: String, val number: String, val label: String)\n''',
    "native guide row label field",
)
patch(
    native_guide,
    '''      nextRows.add(ChannelRow(id, item.getString("name") ?: "Channel", item.getString("number") ?: ""))\n''',
    '''      val name = item.getString("name") ?: "Channel"\n      val number = item.getString("number") ?: ""\n      nextRows.add(ChannelRow(id, name, number, if (number.isBlank()) name else "$number  $name"))\n''',
    "native guide row label build",
)
patch(
    native_guide,
    '''      val rowLabel = if (row.number.isBlank()) row.name else "${row.number}  ${row.name}"\n      drawClippedText(canvas, rowLabel, pad, top + rowHeight * .62f, channelWidth - pad, title)\n''',
    '''      drawClippedText(canvas, row.label, pad, top + rowHeight * .62f, channelWidth - pad, title)\n''',
    "native guide draw label reuse",
)

# 7) Guide: entry-scoped fixed start group, one-pass IDs, and no channel numbering work when disabled.
guide = "frontend/app/(tabs)/guide.tsx"
patch(
    guide,
    '''import { consumeGuideJump } from "@/src/core/guideSearchJump";\n''',
    '''import { consumeGuideJump, peekGuideJump } from "@/src/core/guideSearchJump";\n''',
    "guide jump peek import",
)
patch(
    guide,
    '''let guideSessionChannelId: string | null = null;\nlet guideStartPreferenceApplied = false;\nconst guideSessionChannelByGroup = new Map<string, string>();\n''',
    '''let guideSessionChannelId: string | null = null;\nconst guideSessionChannelByGroup = new Map<string, string>();\n''',
    "remove process-scoped guide start flag",
)
patch(
    guide,
    '''  const [previewEpoch, setPreviewEpoch] = useState(0);\n  useEffect(() => {\n''',
    '''  const [previewEpoch, setPreviewEpoch] = useState(0);\n  const startPreferenceAppliedRef = useRef(false);\n  const wasFocusedRef = useRef(false);\n  useEffect(() => {\n    if (isFocused && !wasFocusedRef.current) startPreferenceAppliedRef.current = false;\n    wasFocusedRef.current = isFocused;\n  }, [isFocused]);\n  useEffect(() => {\n''',
    "entry-scoped guide start state",
)
patch(
    guide,
    '''  // Apply a configured start group once per app process. Explicit Search/player\n  // jumps set the same session state and therefore take priority over this.\n  useEffect(() => {\n    if (guideStartPreferenceApplied || !isFocused || !channels.length) return;\n    if (!startGroup || startGroup === GUIDE_START_LAST_USED) return;\n    const available = groups.includes(startGroup) || overflowGroups.includes(startGroup);\n    const next = available ? startGroup : "All";\n    guideStartPreferenceApplied = true;\n    guideSessionGroup = next;\n    guideSessionChannelId = guideSessionChannelByGroup.get(next) || null;\n    setGroup(next);\n    resetGuideSelection(guideSessionChannelId);\n    setRestoreTimeMs(null);\n    setResetToken((value) => value + 1);\n  }, [channels.length, groups, isFocused, overflowGroups, startGroup]);\n''',
    '''  // Apply a fixed start group once per normal Guide entry. "Last used" keeps\n  // session state; explicit Search/player jumps always win over this preference.\n  useEffect(() => {\n    if (startPreferenceAppliedRef.current || !isFocused || !channels.length) return;\n    if (peekGuideJump()) return;\n    startPreferenceAppliedRef.current = true;\n    if (!startGroup || startGroup === GUIDE_START_LAST_USED) return;\n    const available = groups.includes(startGroup) || overflowGroups.includes(startGroup);\n    const next = available ? startGroup : "All";\n    guideSessionGroup = next;\n    guideSessionChannelId = guideSessionChannelByGroup.get(next) || null;\n    setGroup(next);\n    resetGuideSelection(guideSessionChannelId);\n    setRestoreTimeMs(null);\n    setResetToken((value) => value + 1);\n  }, [channels.length, groups, isFocused, overflowGroups, startGroup]);\n''',
    "guide fixed start per entry",
)
patch(
    guide,
    '''  const orderedFilteredIds = useMemo(\n    () => filtered.map((channel) => channel.id).filter(Boolean),\n    [filtered],\n  );\n''',
    '''  const orderedFilteredIds = useMemo(() => {\n    const ids: string[] = [];\n    for (const channel of filtered) if (channel.id) ids.push(channel.id);\n    return ids;\n  }, [filtered]);\n''',
    "guide filtered ids one pass",
)
patch(
    guide,
    '''  const channelNumberById = useMemo(() => {\n    const result: Record<string, number> = {};\n    [...channels].sort(byName).forEach((channel, index) => {\n      result[channel.id] = resolveChannelNumber(channel.id, index + 1, customNumbers);\n    });\n    return result;\n  }, [channels, customNumbers]);\n''',
    '''  const channelNumberById = useMemo(() => {\n    const result: Record<string, number> = {};\n    if (!channelNumbers) return result;\n    // Native source/cache rows are already name-sorted; do not clone/sort all\n    // 6k+ channels again just to produce optional display numbers.\n    for (let index = 0; index < channels.length; index += 1) {\n      const channel = channels[index];\n      result[channel.id] = resolveChannelNumber(channel.id, index + 1, customNumbers);\n    }\n    return result;\n  }, [channelNumbers, channels, customNumbers]);\n''',
    "guide numbering bounded",
)
patch(
    guide,
    '''      const jump = consumeGuideJump();\n      if (!jump) return;\n      guideStartPreferenceApplied = true;\n''',
    '''      const jump = consumeGuideJump();\n      if (!jump) return;\n      startPreferenceAppliedRef.current = true;\n''',
    "jump overrides guide start preference",
)

# byName is no longer used after removing the Guide re-sort.
patch(
    guide,
    '''function byName(a: Channel, b: Channel) {\n  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });\n}\n\n''',
    '',
    "remove guide byName helper",
)

# 8) Home: skip full numbering map when disabled; source rows already sorted.
home = "frontend/app/(tabs)/index.tsx"
patch(
    home,
    '''function channelSort(a: Channel, b: Channel) {\n  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });\n}\n\n''',
    '',
    "remove Home sort helper",
)
patch(
    home,
    '''  const channelNumberById = useMemo(() => {\n    const result: Record<string, number> = {};\n    const sorted = channels.slice();\n    sorted.sort(channelSort);\n    for (let index = 0; index < sorted.length; index++) result[sorted[index].id] = index + 1;\n    return result;\n  }, [channels]);\n''',
    '''  const channelNumberById = useMemo(() => {\n    const result: Record<string, number> = {};\n    if (!channelNumbers) return result;\n    for (let index = 0; index < channels.length; index += 1) result[channels[index].id] = index + 1;\n    return result;\n  }, [channelNumbers, channels]);\n''',
    "Home numbering bounded",
)

# 9) Fullscreen player: avoid whole-list clones/sorts exactly while decoder starts.
player = "frontend/app/player.tsx"
patch(
    player,
    '''  const sortedChannels = useMemo(\n    () => [...channels].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" })),\n    [channels],\n  );\n  const streamChannels = useMemo(() => sortedChannels.filter((item) => !!item.url), [sortedChannels]);\n  const historyChannels = useMemo(() => {\n    const seen = new Set<string>();\n    return [...recent, ...streamChannels].filter((item) => !!item.url && !seen.has(item.id) && !!seen.add(item.id));\n  }, [recent, streamChannels]);\n  const numberById = useMemo(() => {\n    const result: Record<string, number> = {};\n    sortedChannels.forEach((item, index) => { result[item.id] = index + 1; });\n    return result;\n  }, [sortedChannels]);\n''',
    '''  // Native source/cache channels are already name-sorted and playable. Avoid\n  // cloning/sorting several 6k+ arrays while the fullscreen decoder is starting.\n  const streamChannels = channels;\n  const historyChannels = useMemo(() => {\n    const seen = new Set<string>();\n    const out: Channel[] = [];\n    for (const item of recent) {\n      if (!item.url || seen.has(item.id)) continue;\n      seen.add(item.id);\n      out.push(item);\n    }\n    for (const item of streamChannels) {\n      if (!item.url || seen.has(item.id)) continue;\n      seen.add(item.id);\n      out.push(item);\n    }\n    return out;\n  }, [recent, streamChannels]);\n  const numberById = useMemo(() => {\n    const result: Record<string, number> = {};\n    if (!channelNumbers) return result;\n    for (let index = 0; index < channels.length; index += 1) result[channels[index].id] = index + 1;\n    return result;\n  }, [channelNumbers, channels]);\n''',
    "player startup list allocations",
)

# 10) Search: resolve only native FTS result IDs; don't scan legacy nested programmes on Android.
search = "frontend/app/(tabs)/search.tsx"
patch(
    search,
    '''    const byEpgId = new Map<string, Channel>();\n    for (const channel of channels) {\n      // Avoid allocating [id,tvg,raw].filter(...) for every channel in a 6k list.\n      if (channel.id && !byEpgId.has(channel.id)) byEpgId.set(channel.id, channel);\n      if (channel.tvg_id && !byEpgId.has(channel.tvg_id)) byEpgId.set(channel.tvg_id, channel);\n      if (channel.raw_tvg_id && !byEpgId.has(channel.raw_tvg_id)) byEpgId.set(channel.raw_tvg_id, channel);\n    }\n    void searchNativeEpg(value, 24)\n      .then((rows) => {\n        if (cancelled) return;\n        const next: { channel: Channel; program: Program }[] = [];\n        for (const { channelId, program } of rows) {\n          const channel = byEpgId.get(channelId);\n          if (channel) next.push({ channel, program });\n        }\n        setNativePrograms(next);\n      })\n''',
    '''    void searchNativeEpg(value, 24)\n      .then((rows) => {\n        if (cancelled) return;\n        const wanted = new Set(rows.map((row) => row.channelId).filter(Boolean));\n        const byEpgId = new Map<string, Channel>();\n        if (wanted.size) {\n          for (const channel of channels) {\n            if (channel.id && wanted.has(channel.id)) byEpgId.set(channel.id, channel);\n            if (channel.tvg_id && wanted.has(channel.tvg_id)) byEpgId.set(channel.tvg_id, channel);\n            if (channel.raw_tvg_id && wanted.has(channel.raw_tvg_id)) byEpgId.set(channel.raw_tvg_id, channel);\n            if (byEpgId.size >= wanted.size) break;\n          }\n        }\n        const next: { channel: Channel; program: Program }[] = [];\n        for (const { channelId, program } of rows) {\n          const channel = byEpgId.get(channelId);\n          if (channel) next.push({ channel, program });\n        }\n        setNativePrograms(next);\n      })\n''',
    "Search resolves only FTS result IDs",
)
patch(
    search,
    '''    const programs: { channel: Channel; program: Program }[] = [];\n    const now = Date.now();\n    for (const channel of channels) {\n      const nested = channel.programs;\n      if (!nested?.length) continue;\n      for (const program of nested) {\n        const stop = program.stop ? Date.parse(program.stop) : Date.parse(program.start);\n        if (Number.isFinite(stop) && stop < now) continue;\n        if ((program.title || "").toLowerCase().includes(q)) programs.push({ channel, program });\n        if (programs.length >= 24) break;\n      }\n      if (programs.length >= 24) break;\n    }\n    const mergedPrograms = nativePrograms.length ? nativePrograms : programs;\n''',
    '''    const programs: { channel: Channel; program: Program }[] = [];\n    // Android programme search is native FTS. The new Guide architecture keeps\n    // programme rows outside Channel objects, so walking all 6k channels looking\n    // for legacy nested arrays is wasted TV-thread work. Preserve that fallback\n    // only for web/non-native development.\n    if (Platform.OS === "web") {\n      const now = Date.now();\n      for (const channel of channels) {\n        const nested = channel.programs;\n        if (!nested?.length) continue;\n        for (const program of nested) {\n          const stop = program.stop ? Date.parse(program.stop) : Date.parse(program.start);\n          if (Number.isFinite(stop) && stop < now) continue;\n          if ((program.title || "").toLowerCase().includes(q)) programs.push({ channel, program });\n          if (programs.length >= 24) break;\n        }\n        if (programs.length >= 24) break;\n      }\n    }\n    const mergedPrograms = nativePrograms.length ? nativePrograms : programs;\n''',
    "Search skips legacy Android programme scan",
)

# 11) Guide group counts: compute reusable strings once per channel instead of once per smart/curated group.
groups = "frontend/src/core/guideGroups.ts"
patch(
    groups,
    '''    if (opts.favoriteSet.has(channel.id)) counts.Favorites += 1;\n    if (opts.recentIds.has(channel.id)) counts["Recently Watched"] += 1;\n    for (const smart of SMART_GROUPS) {\n      if (channelMatchesSmart(channel, smart, opts)) counts[smart] += 1;\n    }\n    for (const curated of CURATED_GROUPS) {\n      if (channelMatchesCurated(channel, curated)) counts[curated] += 1;\n    }\n''',
    '''    if (opts.favoriteSet.has(channel.id)) counts.Favorites += 1;\n    if (opts.recentIds.has(channel.id)) counts["Recently Watched"] += 1;\n    const combined = `${channel.name || ""} ${channel.group || ""}`;\n    if (HD_RE.test(combined)) counts["HD Only"] += 1;\n    if (ALLDAY_RE.test(combined)) counts["24/7"] += 1;\n    if (!opts.hasEpgMatch(channel)) counts["Unmatched EPG"] += 1;\n    if (opts.isFailed(channel.id)) counts["Failed Streams"] += 1;\n    const curatedValue = combined.toLowerCase();\n    for (const curated of CURATED_GROUPS) {\n      if (CURATED_MATCH[curated]?.test(curatedValue)) counts[curated] += 1;\n    }\n''',
    "Guide group counts one string per channel",
)

# 12) Settings help should reflect entry-scoped start preference behavior.
epg_settings = "frontend/app/(tabs)/epg-sources.tsx"
patch(
    epg_settings,
    '''              <Text style={styles.help}>Choose which Guide group opens first after a fresh app launch. Last used keeps your previous Guide tab. Search and returning from fullscreen always open on the requested/current channel instead.</Text>\n''',
    '''              <Text style={styles.help}>Choose which Guide group opens first on a normal Guide entry. Last used keeps your previous Guide tab. Search and returning from fullscreen always open on the requested/current channel instead.</Text>\n''',
    "Guide start help copy",
)

# 13) Regression assertions for the second audit.
mem_test = Path("frontend/tests/memoryCrossAudit.test.mjs")
text = mem_test.read_text(encoding="utf-8")
addition = r'''

test("direct IPTV sources preserve HTTP and cache writes avoid reparsing the old full channel graph", async () => {
  const source = await readFile(join(root, "src/source.native.ts"), "utf8");
  assert.match(source, /function sourceUrl\(url: string\)/);
  assert.doesNotMatch(source, /startsWith\("http:\/\/"\).*https:/s);
  assert.match(source, /fetchNativePlaylist\(sourceUrl\(SOURCE_M3U\)\)/);
  assert.match(source, /refreshNativeEpg\([\s\S]*?sourceUrl\(SOURCE_EPG\)/);
  assert.doesNotMatch(source, /const validCurrent = await readMetaFile\(CHANNEL_CACHE\)/);
  assert.match(source, /channelCacheKnownGood/);
  assert.match(source, /priorityMatchChannelIds = \[\]/);
});

test("large-list UI paths skip redundant whole-list sorting and Android legacy programme scans", async () => {
  const [guide, home, player, search, logo] = await Promise.all([
    readFile(join(root, "app/(tabs)/guide.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/index.tsx"), "utf8"),
    readFile(join(root, "app/player.tsx"), "utf8"),
    readFile(join(root, "app/(tabs)/search.tsx"), "utf8"),
    readFile(join(root, "src/components/ChannelLogo.tsx"), "utf8"),
  ]);
  assert.match(guide, /if \(!channelNumbers\) return result/);
  assert.doesNotMatch(guide, /\[\.\.\.channels\]\.sort\(/);
  assert.match(home, /if \(!channelNumbers\) return result/);
  assert.doesNotMatch(home, /channels\.slice\(\)[\s\S]{0,100}\.sort\(/);
  assert.doesNotMatch(player, /\[\.\.\.channels\]\.sort\(/);
  assert.doesNotMatch(player, /\[\.\.\.recent, \.\.\.streamChannels\]/);
  assert.match(search, /if \(Platform\.OS === "web"\)/);
  assert.match(logo, /useLocalLogo\(!disabled && visible \? name : ""\)/);
});

test("custom ordering uses one coalescing storage writer", async () => {
  const customize = await readFile(join(root, "src/core/channelCustomize.ts"), "utf8");
  assert.match(customize, /let persistRunning = false/);
  assert.match(customize, /async function flushPersistence\(\)/);
  assert.match(customize, /const snapshot = cached/);
  assert.match(customize, /void flushPersistence\(\)/);
});

test("Guide fixed start preference is entry-scoped and explicit jumps override it", async () => {
  const guide = await readFile(join(root, "app/(tabs)/guide.tsx"), "utf8");
  assert.match(guide, /peekGuideJump/);
  assert.match(guide, /startPreferenceAppliedRef/);
  assert.doesNotMatch(guide, /let guideStartPreferenceApplied = false/);
  assert.match(guide, /startPreferenceAppliedRef\.current = true;[\s\S]{0,120}const nextGroup = jump\.group/);
});
'''
if "direct IPTV sources preserve HTTP" not in text:
    mem_test.write_text(text + addition, encoding="utf-8")

arch_test = Path("frontend/tests/nativeGuideArchitecture.test.mjs")
text = arch_test.read_text(encoding="utf-8")
addition = r'''

test("native Guide precomputes row labels outside the repaint loop", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /ChannelRow\(val id: String, val name: String, val number: String, val label: String\)/);
  assert.match(view, /drawClippedText\(canvas, row\.label/);
  assert.doesNotMatch(view, /val rowLabel = if \(row\.number\.isBlank\(\)\)/);
});
'''
if "precomputes row labels" not in text:
    arch_test.write_text(text + addition, encoding="utf-8")
