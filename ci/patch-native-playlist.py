from pathlib import Path

# Wire the streaming parser into the existing CharmEpg native module.
path = Path("frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt")
text = path.read_text()
old = '''  private val refreshExecutor = Executors.newSingleThreadExecutor()\n  private val queryExecutor = Executors.newFixedThreadPool(2)'''
new = '''  private val refreshExecutor = Executors.newSingleThreadExecutor()\n  private val playlistExecutor = Executors.newSingleThreadExecutor()\n  private val queryExecutor = Executors.newFixedThreadPool(2)'''
if old not in text:
    raise SystemExit("EpgNative executor anchor not found")
text = text.replace(old, new, 1)
anchor = '  override fun getName(): String = "CharmEpg"\n\n'
method = '''  override fun getName(): String = "CharmEpg"\n\n  @ReactMethod\n  fun fetchPlaylist(url: String, promise: Promise) {\n    playlistExecutor.execute {\n      try {\n        val parsed = NativePlaylistParser.fetch(url)\n        val channels = Arguments.createArray()\n        for (channel in parsed.channels) {\n          channels.pushMap(Arguments.createMap().apply {\n            putString("id", channel.id)\n            putString("raw_tvg_id", channel.rawTvgId)\n            putString("tvg_id", channel.rawTvgId)\n            putString("name", channel.name)\n            putString("logo", channel.logo)\n            putString("group", channel.group)\n            putString("url", channel.url)\n            putString("stream_type", channel.streamType)\n          })\n        }\n        promise.resolve(Arguments.createMap().apply {\n          putArray("channels", channels)\n          putInt("rejected", parsed.rejected)\n          putBoolean("truncated", parsed.truncated)\n        })\n      } catch (t: Throwable) {\n        promise.reject("PLAYLIST_FETCH_FAILED", t.message ?: "Native playlist refresh failed", t)\n      }\n    }\n  }\n\n'''
if anchor not in text:
    raise SystemExit("EpgNative method anchor not found")
text = text.replace(anchor, method, 1)
old = '''    refreshExecutor.shutdownNow()\n    queryExecutor.shutdownNow()'''
new = '''    refreshExecutor.shutdownNow()\n    playlistExecutor.shutdownNow()\n    queryExecutor.shutdownNow()'''
if old not in text:
    raise SystemExit("EpgNative invalidate anchor not found")
text = text.replace(old, new, 1)
path.write_text(text)

# JS native bridge wrapper.
path = Path("frontend/src/nativeEpg.ts")
text = path.read_text()
text = text.replace('import type { Program } from "@/src/api";', 'import type { Channel, Program } from "@/src/api";')
anchor = '''type NativeRefreshResult = {\n  count: number;'''
insert = '''type NativePlaylistResult = {\n  channels: Channel[];\n  rejected: number;\n  truncated: boolean;\n};\n\ntype NativeRefreshResult = {\n  count: number;'''
if anchor not in text:
    raise SystemExit("nativeEpg result anchor not found")
text = text.replace(anchor, insert, 1)
anchor = '''type CharmEpgModule = {\n  refresh(url: string, allowNotModified: boolean): Promise<NativeRefreshResult>;'''
insert = '''type CharmEpgModule = {\n  fetchPlaylist?(url: string): Promise<NativePlaylistResult>;\n  refresh(url: string, allowNotModified: boolean): Promise<NativeRefreshResult>;'''
if anchor not in text:
    raise SystemExit("nativeEpg module anchor not found")
text = text.replace(anchor, insert, 1)
anchor = '''export async function refreshNativeEpg(url: string, allowNotModified: boolean): Promise<NativeRefreshResult> {'''
insert = '''export async function fetchNativePlaylist(url: string): Promise<NativePlaylistResult> {\n  if (!nativeModule || typeof nativeModule.fetchPlaylist !== "function") {\n    throw new Error("Native playlist engine is unavailable");\n  }\n  return nativeModule.fetchPlaylist(url);\n}\n\nexport async function refreshNativeEpg(url: string, allowNotModified: boolean): Promise<NativeRefreshResult> {'''
if anchor not in text:
    raise SystemExit("nativeEpg function anchor not found")
text = text.replace(anchor, insert, 1)
path.write_text(text)

# Native source path no longer downloads the complete M3U into a JS string.
path = Path("frontend/src/source.native.ts")
text = path.read_text()
old = '''import {\n  enforcePlaylistByteLimit,\n  enforcePlaylistTextLimit,\n  parseM3UWithStats,\n} from "@/src/core/sourceParsing";\n'''
if old not in text:
    raise SystemExit("source.native JS parser import block not found")
text = text.replace(old, '', 1)
old = '''  clearNativeEpg,\n  loadNativeEpgWindow,'''
new = '''  clearNativeEpg,\n  fetchNativePlaylist,\n  loadNativeEpgWindow,'''
if old not in text:
    raise SystemExit("source.native nativeEpg import anchor not found")
text = text.replace(old, new, 1)
start = text.index('async function fetchPlaylist(): Promise<Channel[]> {')
end = text.index('\nasync function ensureLoaded(): Promise<NativeMeta> {', start)
replacement = '''async function fetchPlaylist(): Promise<Channel[]> {\n  if (!SOURCE_M3U) {\n    throw new Error("Playlist is not configured for this build (missing EXPO_PUBLIC_M3U_URL).");\n  }\n  setProgress({ phase: "channels", ratio: 0.06, etaSeconds: null });\n  const parsed = await fetchNativePlaylist(https(SOURCE_M3U));\n  setProgress({ phase: "channels", ratio: 0.17, etaSeconds: null });\n  const sorted = sortChannels(Array.isArray(parsed.channels) ? parsed.channels : []);\n  if (!sorted.length) throw new Error("Playlist contained no playable channels");\n  return sorted;\n}\n'''
text = text[:start] + replacement + text[end:]
path.write_text(text)
