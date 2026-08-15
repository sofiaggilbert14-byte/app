from pathlib import Path

# Channel type retains independent playlist and EPG logo sources.
path = Path("frontend/src/api.ts")
text = path.read_text()
old = '''  logo: string;\n  group: string;'''
new = '''  logo: string;\n  /** Original #EXTINF tvg-logo from the playlist. */\n  playlist_logo?: string;\n  /** Matched XMLTV <icon> logo, kept separately for priority/fallback changes. */\n  epg_logo?: string;\n  group: string;'''
if old not in text: raise SystemExit("api Channel logo anchor not found")
text = text.replace(old, new, 1)
path.write_text(text)

path = Path("frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt")
text = path.read_text()
old = '''            putString("logo", channel.logo)\n            putString("group", channel.group)'''
new = '''            putString("logo", channel.logo)\n            putString("playlist_logo", channel.logo)\n            putString("group", channel.group)'''
if old not in text: raise SystemExit("native playlist logo anchor not found")
text = text.replace(old, new, 1)
path.write_text(text)

path = Path("frontend/src/core/epgMatching.ts")
text = path.read_text()
text = text.replace(
    '''export type EpgMatchOptions = {\n  /** Messy providers: only exact/normalized tvg-id (and playlist id) — never name. */\n  preferTvgIdOnly?: boolean;\n};''',
    '''export type EpgMatchOptions = {\n  /** Messy providers: only exact/normalized tvg-id (and playlist id) — never name. */\n  preferTvgIdOnly?: boolean;\n  /** Which available logo source wins; the other remains as fallback. */\n  logoPriority?: "playlist" | "epg";\n};''',
)
old = '''    const xmltvLogo = result.logoId ? (logos[result.logoId] || "").trim() : "";\n    const nextLogo = xmltvLogo || channel.logo || "";\n    const nextGuideId = result.sourceId || channel.tvg_id;\n\n    if (nextLogo === channel.logo && nextGuideId === channel.tvg_id) {\n      byId.set(channel.id, channel);\n    } else {\n      byId.set(channel.id, { ...channel, tvg_id: nextGuideId, logo: nextLogo });\n    }'''
new = '''    const xmltvLogo = result.logoId ? (logos[result.logoId] || "").trim() : "";\n    const playlistLogo = (channel.playlist_logo || (!channel.epg_logo ? channel.logo : "") || "").trim();\n    const nextLogo = options.logoPriority === "epg"\n      ? (xmltvLogo || playlistLogo || channel.logo || "")\n      : (playlistLogo || xmltvLogo || channel.logo || "");\n    const nextGuideId = result.sourceId || channel.tvg_id;\n\n    if (nextLogo === channel.logo && nextGuideId === channel.tvg_id && playlistLogo === (channel.playlist_logo || "") && xmltvLogo === (channel.epg_logo || "")) {\n      byId.set(channel.id, channel);\n    } else {\n      byId.set(channel.id, { ...channel, tvg_id: nextGuideId, logo: nextLogo, playlist_logo: playlistLogo, epg_logo: xmltvLogo });\n    }'''
if old not in text: raise SystemExit("epg matching logo resolution block not found")
text = text.replace(old, new, 1)
old = '''    const key = (channel.tvg_id || "").trim();\n    const xmltvLogo = (key && logos[key] ? logos[key] : logos[channel.id] || "").trim();\n    if (!xmltvLogo || xmltvLogo === channel.logo) return channel;\n    changed = true;\n    return { ...channel, logo: xmltvLogo };'''
new = '''    const key = (channel.tvg_id || "").trim();\n    const xmltvLogo = (key && logos[key] ? logos[key] : logos[channel.id] || "").trim();\n    const playlistLogo = (channel.playlist_logo || (!channel.epg_logo ? channel.logo : "") || "").trim();\n    const nextLogo = playlistLogo || xmltvLogo || channel.logo || "";\n    if (nextLogo === channel.logo && playlistLogo === (channel.playlist_logo || "") && xmltvLogo === (channel.epg_logo || "")) return channel;\n    changed = true;\n    return { ...channel, logo: nextLogo, playlist_logo: playlistLogo, epg_logo: xmltvLogo };'''
if old not in text: raise SystemExit("epg logo-only block not found")
text = text.replace(old, new, 1)
path.write_text(text)

path = Path("frontend/src/source.native.ts")
text = path.read_text()
anchor = '''import {\n  getSourceRefreshPreferences,\n  isRefreshDue,\n  nextRefreshAt,\n} from "@/src/core/sourceRefreshPreferences";\n'''
if 'from "@/src/core/logoPreferences"' not in text:
    if anchor not in text: raise SystemExit("source.native logo preference import anchor not found")
    text = text.replace(anchor, anchor + 'import { getLogoPriority, type LogoPriority } from "@/src/core/logoPreferences";\n', 1)
old = '''async function matchChannelsWithPhases(\n  channels: Channel[],\n  indexes: ReturnType<typeof buildXmltvMatchIndexes>,\n  epgLogos: Record<string, string>,\n  onPartial?: (channels: Channel[], quality: EpgMatchQuality) => void | Promise<void>,\n): Promise<{ channels: Channel[]; quality: EpgMatchQuality }> {'''
new = '''async function matchChannelsWithPhases(\n  channels: Channel[],\n  indexes: ReturnType<typeof buildXmltvMatchIndexes>,\n  epgLogos: Record<string, string>,\n  logoPriority: LogoPriority,\n  onPartial?: (channels: Channel[], quality: EpgMatchQuality) => void | Promise<void>,\n): Promise<{ channels: Channel[]; quality: EpgMatchQuality }> {'''
if old not in text: raise SystemExit("matchChannelsWithPhases signature not found")
text = text.replace(old, new, 1)
text = text.replace('      preferTvgIdOnly,\n      onlyChannelIds: priority,', '      preferTvgIdOnly,\n      logoPriority,\n      onlyChannelIds: priority,', 1)
text = text.replace('      preferTvgIdOnly,\n      onlyChannelIds: restIds,', '      preferTvgIdOnly,\n      logoPriority,\n      onlyChannelIds: restIds,', 1)
text = text.replace('    preferTvgIdOnly,\n    priorityChannelIds:', '    preferTvgIdOnly,\n    logoPriority,\n    priorityChannelIds:', 1)
old = '''    return {\n      ts: parsed.ts,\n      channels: sortChannels(parsed.channels),'''
new = '''    const normalizedChannels = parsed.channels.map((channel) => ({ ...channel, playlist_logo: channel.playlist_logo || (!channel.epg_logo ? channel.logo : "") || "" }));\n    return {\n      ts: parsed.ts,\n      channels: sortChannels(normalizedChannels),'''
if old not in text: raise SystemExit("readMeta logo normalization anchor not found")
text = text.replace(old, new, 1)
old = '''      const epgLogos = epg.channelLogos || {};\n      const epgNames = epg.channelNames || {};'''
new = '''      const epgLogos = epg.channelLogos || {};\n      const epgNames = epg.channelNames || {};\n      const logoPriority = await getLogoPriority();'''
if old not in text: raise SystemExit("source.native epg logos anchor not found")
text = text.replace(old, new, 1)
text = text.replace('      if (playlistUnchanged && policyUnchanged && epgUnchanged && cached?.channels?.length) {', '      if (logoPriority === "playlist" && playlistUnchanged && policyUnchanged && epgUnchanged && cached?.channels?.length) {', 1)
old = '''          channels,\n          indexes,\n          epgLogos,\n          async (partialChannels, partialQuality) => {'''
new = '''          channels,\n          indexes,\n          epgLogos,\n          logoPriority,\n          async (partialChannels, partialQuality) => {'''
if old not in text: raise SystemExit("source.native phased match call not found")
text = text.replace(old, new, 1)
path.write_text(text)

path = Path("frontend/src/components/ChannelLogo.tsx")
text = path.read_text()
anchor = '''  void (Image as any).clearMemoryCache?.().catch?.(() => undefined);\n}\n\nfunction remember'''
insert = '''  void (Image as any).clearMemoryCache?.().catch?.(() => undefined);\n}\n\nexport async function clearChannelLogoCache(includeDisk = true): Promise<void> {\n  clearChannelLogoMemory();\n  if (includeDisk) await (Image as any).clearDiskCache?.().catch?.(() => undefined);\n}\n\nfunction remember'''
if anchor not in text: raise SystemExit("ChannelLogo helper insert anchor not found")
text = text.replace(anchor, insert, 1)
text = text.replace('        cachePolicy="disk"', '        cachePolicy="memory-disk"', 1)
path.write_text(text)

path = Path("frontend/app/(tabs)/settings.tsx")
text = path.read_text()
anchor = '''import {\n  type SourceRefreshIntervalHours,\n  useSourceRefreshPreferences,\n} from "@/src/core/sourceRefreshPreferences";\n'''
if 'useLogoPriority' not in text:
    if anchor not in text: raise SystemExit("settings logo import anchor not found")
    text = text.replace(anchor, anchor + 'import { type LogoPriority, useLogoPriority } from "@/src/core/logoPreferences";\nimport { clearChannelLogoCache } from "@/src/components/ChannelLogo";\n', 1)
anchor = '  const sourceRefresh = useSourceRefreshPreferences();\n'
if 'const [logoPriority, setLogoPriority]' not in text:
    if anchor not in text: raise SystemExit("settings logo hook anchor not found")
    text = text.replace(anchor, anchor + '  const [logoPriority, setLogoPriority] = useLogoPriority();\n', 1)
anchor = '''                <Action label={busy ? "Refreshing…" : "Refresh playlist & EPG"} icon="refresh" onPress={hardReload} disabled={busy} />'''
insert = '''                <ChoiceRow<LogoPriority>\n                  label="Channel logos priority"\n                  value={logoPriority}\n                  options={[\n                    { label: "Prefer playlist logos", value: "playlist" },\n                    { label: "Prefer EPG logos", value: "epg" },\n                  ]}\n                  onChange={setLogoPriority}\n                />\n                <Text style={styles.help}>Both playlist and EPG logo URLs are retained. The preferred source wins, with the other used as fallback.</Text>\n                <Action label="Clear channel logo cache" icon="image-outline" onPress={() => void clearChannelLogoCache(true)} />\n                <Action label={busy ? "Refreshing…" : "Refresh playlist & EPG"} icon="refresh" onPress={hardReload} disabled={busy} />'''
if anchor not in text: raise SystemExit("settings logo controls anchor not found")
text = text.replace(anchor, insert, 1)
path.write_text(text)
