from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"{label}: pattern not found")
    p.write_text(text.replace(old, new, 1))

# Native source: replace fixed 24h TTL with independent playlist/EPG preferences.
path = Path("frontend/src/source.native.ts")
text = path.read_text()
import_anchor = 'import { cleanupLegacyEpgArtifactsOnce } from "@/src/utils/legacyEpgCleanup";\n'
refresh_import = '''import {\n  getSourceRefreshPreferences,\n  isRefreshDue,\n  nextRefreshAt,\n} from "@/src/core/sourceRefreshPreferences";\n'''
if refresh_import not in text:
    if import_anchor not in text:
        raise SystemExit("native source import anchor not found")
    text = text.replace(import_anchor, import_anchor + refresh_import, 1)
text = text.replace('const TTL_MS = 24 * 60 * 60 * 1000;\n', '')
old = '''    if (cached.ts <= 0 || Date.now() - cached.ts >= TTL_MS) {\n      if (!cached.epgError) {\n        setProgress({ phase: "update_available", ratio: 0, etaSeconds: null, message: null }, true);\n      }\n      void refreshInternal(false);\n    }'''
new = '''    void refreshSourcesIfDue();'''
if old not in text:
    raise SystemExit("native ensureLoaded TTL block not found")
text = text.replace(old, new, 1)
old = '''    if (!force && cached && cached.ts > 0 && Date.now() - cached.ts < TTL_MS) {\n      MEM = cached;\n      void syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0)\n        .then(() => syncMatchesToNative(cached.channels, cached.guideEpoch || 0))\n        .catch(() => undefined);\n      return cached;\n    }'''
new = '''    if (!force && cached?.channels?.length) {\n      const refreshPrefs = await getSourceRefreshPreferences();\n      const playlistLast = cached.playlistRefreshedAt || cached.ts;\n      if (!isRefreshDue(playlistLast, refreshPrefs.playlistHours)) {\n        MEM = cached;\n        void syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0)\n          .then(() => syncMatchesToNative(cached.channels, cached.guideEpoch || 0))\n          .catch(() => undefined);\n        return cached;\n      }\n    }'''
if old not in text:
    raise SystemExit("native refreshInternal TTL block not found")
text = text.replace(old, new, 1)
old = '''          guideEpoch:\n            typeof epg.guideEpoch === "number" && Number.isFinite(epg.guideEpoch)\n              ? Math.round(epg.guideEpoch)\n              : cached.guideEpoch,\n        };'''
new = '''          guideEpoch:\n            typeof epg.guideEpoch === "number" && Number.isFinite(epg.guideEpoch)\n              ? Math.round(epg.guideEpoch)\n              : cached.guideEpoch,\n          guideRefreshedAt: checkedAt,\n        };'''
if old not in text:
    raise SystemExit("native 304 metadata block not found")
text = text.replace(old, new, 1)
anchor = '''export async function refreshSource(force = false): Promise<SourceStatus> {\n  await refreshInternal(force);\n  return sourceStatus();\n}\n'''
insert = '''export async function refreshSource(force = false): Promise<SourceStatus> {\n  await refreshInternal(force);\n  return sourceStatus();\n}\n\n/** Check persisted independent playlist/EPG clocks and refresh only what is due. */\nexport async function refreshSourcesIfDue(): Promise<SourceStatus> {\n  if (refreshPromise) {\n    await refreshPromise;\n    return sourceStatus();\n  }\n  const cached = MEM || (await readChannelCache());\n  if (!cached?.channels?.length) return sourceStatus();\n  MEM = cached;\n  const prefs = await getSourceRefreshPreferences();\n  const now = Date.now();\n  const playlistLast = cached.playlistRefreshedAt || cached.ts;\n  if (isRefreshDue(playlistLast, prefs.playlistHours, now)) {\n    if (!cached.epgError) {\n      setProgress({ phase: "update_available", ratio: 0, etaSeconds: null, message: null }, true);\n    }\n    await refreshInternal(true);\n    return sourceStatus();\n  }\n  const guideLast = cached.guideRefreshedAt || cached.ts;\n  if (isRefreshDue(guideLast, prefs.epgHours, now)) {\n    return refreshEpgOnly();\n  }\n  return sourceStatus();\n}\n'''
if anchor not in text:
    raise SystemExit("native refreshSource anchor not found")
text = text.replace(anchor, insert, 1)
old = '''export async function sourceDiagnostics(): Promise<SourceDiagnostics> {\n  let cacheBytes = 0;'''
new = '''export async function sourceDiagnostics(): Promise<SourceDiagnostics> {\n  let cacheBytes = 0;'''
if old not in text:
    raise SystemExit("native diagnostics header not found")
# Keep header same; inject calculations before return.
calc_anchor = '''  return {\n    mode: SOURCE_M3U ? "direct" : "unconfigured",'''
calc = '''  const refreshPrefs = await getSourceRefreshPreferences();\n  const playlistNext = nextRefreshAt(MEM?.playlistRefreshedAt || MEM?.ts, refreshPrefs.playlistHours);\n  const epgNext = nextRefreshAt(MEM?.guideRefreshedAt || MEM?.ts, refreshPrefs.epgHours);\n  const nextCandidates = [playlistNext, epgNext].filter((value): value is number => typeof value === "number");\n  const nextAutoRefreshAt = nextCandidates.length ? Math.min(...nextCandidates) : null;\n  return {\n    mode: SOURCE_M3U ? "direct" : "unconfigured",'''
if calc_anchor not in text:
    raise SystemExit("native diagnostics return anchor not found")
text = text.replace(calc_anchor, calc, 1)
text = text.replace(
    '    nextAutoRefresh: MEM && MEM.ts > 0 ? new Date(MEM.ts + TTL_MS).toISOString() : null,',
    '    nextAutoRefresh: nextAutoRefreshAt ? new Date(nextAutoRefreshAt).toISOString() : null,',
    1,
)
path.write_text(text)

# Shared/web source must expose the scheduler symbol for TypeScript/web resolution.
path = Path("frontend/src/source.ts")
text = path.read_text()
anchor = '''export async function refreshEpgOnly(): Promise<SourceStatus> {\n  return refreshSource(true);\n}\n'''
insert = '''export async function refreshEpgOnly(): Promise<SourceStatus> {\n  return refreshSource(true);\n}\n\nexport async function refreshSourcesIfDue(): Promise<SourceStatus> {\n  return refreshSource(false);\n}\n'''
if anchor not in text:
    raise SystemExit("web refreshEpgOnly anchor not found")
text = text.replace(anchor, insert, 1)
path.write_text(text)

# Root scheduler: active-app/foreground checks without waking weak TV boxes aggressively.
path = Path("frontend/app/_layout.tsx")
text = path.read_text()
anchor = 'import { PurpleTvDrawerProvider } from "@/src/components/PurpleTvShell";\n'
new_import = anchor + 'import { SourceRefreshScheduler } from "@/src/components/SourceRefreshScheduler";\n'
if 'SourceRefreshScheduler' not in text:
    if anchor not in text:
        raise SystemExit("layout import anchor not found")
    text = text.replace(anchor, new_import, 1)
anchor = '''                <NotificationRouter />\n                <ReminderCleanup />'''
insert = '''                <NotificationRouter />\n                <SourceRefreshScheduler />\n                <ReminderCleanup />'''
if anchor not in text:
    raise SystemExit("layout scheduler anchor not found")
text = text.replace(anchor, insert, 1)
path.write_text(text)

# Settings: independent refresh choices and real persisted values.
path = Path("frontend/app/(tabs)/settings.tsx")
text = path.read_text()
anchor = '''import {\n  type PlayerEnginePreference,\n  usePlayerEnginePreference,\n} from "@/src/playerEnginePreference";\n'''
refresh_import = '''import {\n  type SourceRefreshIntervalHours,\n  useSourceRefreshPreferences,\n} from "@/src/core/sourceRefreshPreferences";\n'''
if refresh_import not in text:
    if anchor not in text:
        raise SystemExit("settings import anchor not found")
    text = text.replace(anchor, anchor + refresh_import, 1)
anchor = '  const [playerEnginePreference, setPlayerEnginePreference] = usePlayerEnginePreference();\n'
insert = anchor + '  const sourceRefresh = useSourceRefreshPreferences();\n'
if 'const sourceRefresh = useSourceRefreshPreferences();' not in text:
    if anchor not in text:
        raise SystemExit("settings hook anchor not found")
    text = text.replace(anchor, insert, 1)
actions = '''                <Action label={busy ? "Refreshing…" : "Refresh playlist & EPG"} icon="refresh" onPress={hardReload} disabled={busy} />\n                <Action label={busy ? "Working…" : "Refresh EPG only"} icon="calendar-outline" onPress={reloadEpgOnly} disabled={busy} />'''
choices = '''                <ChoiceRow<SourceRefreshIntervalHours>\n                  label="Playlist auto refresh"\n                  value={sourceRefresh.playlistHours}\n                  options={[\n                    { label: "Manual only", value: 0 },\n                    { label: "Every 2 hours", value: 2 },\n                    { label: "Every 4 hours", value: 4 },\n                    { label: "Every 6 hours", value: 6 },\n                    { label: "Every 12 hours", value: 12 },\n                    { label: "Every 24 hours", value: 24 },\n                  ]}\n                  onChange={sourceRefresh.setPlaylistHours}\n                />\n                <ChoiceRow<SourceRefreshIntervalHours>\n                  label="EPG auto refresh"\n                  value={sourceRefresh.epgHours}\n                  options={[\n                    { label: "Manual only", value: 0 },\n                    { label: "Every 2 hours", value: 2 },\n                    { label: "Every 4 hours", value: 4 },\n                    { label: "Every 6 hours", value: 6 },\n                    { label: "Every 12 hours", value: 12 },\n                    { label: "Every 24 hours", value: 24 },\n                  ]}\n                  onChange={sourceRefresh.setEpgHours}\n                />\n                <Text style={styles.help}>Playlist and guide refresh independently. Defaults are 24h for channels and 6h for EPG; Manual only disables automatic checks for that source.</Text>\n                <Action label={busy ? "Refreshing…" : "Refresh playlist & EPG"} icon="refresh" onPress={hardReload} disabled={busy} />\n                <Action label={busy ? "Working…" : "Refresh EPG only"} icon="calendar-outline" onPress={reloadEpgOnly} disabled={busy} />'''
if actions not in text:
    raise SystemExit("settings refresh action anchor not found")
text = text.replace(actions, choices, 1)
path.write_text(text)
