from pathlib import Path

source = Path("frontend/src/source.native.ts")
text = source.read_text(encoding="utf-8")

anchor = 'import { clearGuidePrograms } from "@/src/core/guideProgramsStore";\n'
imports = '''import { clearGuidePrograms } from "@/src/core/guideProgramsStore";\nimport {\n  enforcePlaylistByteLimit,\n  enforcePlaylistTextLimit,\n  parseM3UWithStats,\n} from "@/src/core/sourceParsing";\n'''
if 'parseM3UWithStats' not in text:
    if anchor not in text:
        raise SystemExit("sourceParsing import anchor not found")
    text = text.replace(anchor, imports, 1)

text = text.replace('  fetchNativePlaylist,\n', '', 1)

old = '''async function fetchPlaylist(): Promise<Channel[]> {\n  if (!SOURCE_M3U) {\n    throw new Error("Playlist is not configured for this build (missing EXPO_PUBLIC_M3U_URL).");\n  }\n  setProgress({ phase: "channels", ratio: 0.06, etaSeconds: null });\n  const parsed = await fetchNativePlaylist(sourceUrl(SOURCE_M3U));\n  setProgress({ phase: "channels", ratio: 0.17, etaSeconds: null });\n  const channels = Array.isArray(parsed.channels) ? parsed.channels : [];\n  if (!channels.length) throw new Error("Playlist contained no playable channels");\n  return channels;\n}\n'''
new = '''async function fetchPlaylist(): Promise<Channel[]> {\n  if (!SOURCE_M3U) {\n    throw new Error("Playlist is not configured for this build (missing EXPO_PUBLIC_M3U_URL).");\n  }\n  setProgress({ phase: "channels", ratio: 0.06, etaSeconds: null });\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), PLAYLIST_FETCH_TIMEOUT_MS);\n  try {\n    // Preserve the provider protocol exactly. Xtream-style sources commonly use\n    // cleartext HTTP; sideload builds explicitly permit it. This is the same\n    // bounded acquisition/parser path used by the last known-good Charm build,\n    // while native SQLite remains authoritative after sync.\n    const response = await fetch(sourceUrl(SOURCE_M3U), {\n      headers: { "User-Agent": "CharmIPTV/Experimental-v3" },\n      signal: controller.signal,\n    });\n    if (!response.ok) throw new Error(`M3U HTTP ${response.status}`);\n    const contentLength = Number(response.headers.get("content-length") || "");\n    if (Number.isFinite(contentLength) && contentLength > 0) {\n      enforcePlaylistByteLimit(contentLength);\n    }\n    const body = await response.text();\n    enforcePlaylistTextLimit(body);\n    const parsed = parseM3UWithStats(body, (url) => url, (ratio) => {\n      setProgress({ phase: "channels", ratio: 0.06 + ratio * 0.11, etaSeconds: null });\n    });\n    const channels = Array.isArray(parsed.channels) ? parsed.channels : [];\n    setProgress({ phase: "channels", ratio: 0.17, etaSeconds: null });\n    if (!channels.length) throw new Error("Playlist contained no playable channels");\n    return channels;\n  } catch (error) {\n    if (controller.signal.aborted) {\n      throw new Error("Playlist request timed out before channels could be loaded");\n    }\n    throw error;\n  } finally {\n    clearTimeout(timeout);\n  }\n}\n'''
if old not in text:
    raise SystemExit("current native fetchPlaylist block not found")
text = text.replace(old, new, 1)

const_anchor = 'const PROGRESS_THROTTLE_MS = 150;\n'
if 'PLAYLIST_FETCH_TIMEOUT_MS' not in text:
    if const_anchor not in text:
        raise SystemExit("progress constant anchor not found")
    text = text.replace(const_anchor, const_anchor + 'const PLAYLIST_FETCH_TIMEOUT_MS = 45_000;\n', 1)

source.write_text(text, encoding="utf-8")

# Permanent regression: the 6% boundary must use the bounded HTTP-preserving
# compatibility loader and may not block on the native full-playlist bridge.
test = Path("frontend/tests/startupPlaylistAcquisition.test.mjs")
test.write_text('''import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst source = fs.readFileSync(new URL("../src/source.native.ts", import.meta.url), "utf8");\nassert.match(source, /fetch\\(sourceUrl\\(SOURCE_M3U\\)/);\nassert.match(source, /PLAYLIST_FETCH_TIMEOUT_MS = 45_000/);\nassert.match(source, /parseM3UWithStats/);\nassert.match(source, /enforcePlaylistByteLimit/);\nassert.match(source, /enforcePlaylistTextLimit/);\nassert.doesNotMatch(source, /await fetchNativePlaylist\\(/);\nassert.match(source, /Playlist request timed out before channels could be loaded/);\nconsole.log("startup playlist acquisition regression: ok");\n''', encoding="utf-8")

runner = Path("frontend/tests/run-tests.mjs")
r = runner.read_text(encoding="utf-8")
entry = 'import "./startupPlaylistAcquisition.test.mjs";\n'
if entry not in r:
    r += '\n' + entry
    runner.write_text(r, encoding="utf-8")

print("Restored bounded HTTP-preserving playlist acquisition at the 6% boundary.")
