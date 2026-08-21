from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import sys

ROOT = Path("frontend")
SOURCE_EXTS = {".ts", ".tsx", ".js", ".mjs", ".kt", ".java"}
SKIP_PARTS = {"node_modules", "build", ".gradle", ".expo", "dist"}

files: list[Path] = []
for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix not in SOURCE_EXTS:
        continue
    if any(part in SKIP_PARTS for part in path.parts):
        continue
    files.append(path)

critical: list[str] = []
warnings: list[str] = []
metrics = Counter()

def text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")

for path in files:
    data = text(path)
    rel = path.as_posix()
    metrics["files"] += 1
    metrics["functions"] += len(re.findall(r"\b(?:function|fun)\s+[A-Za-z_$][\w$]*\s*\(", data))
    metrics["arrow_callbacks"] += len(re.findall(r"(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(?:useCallback\()?\s*\(?[^\n=]*\)?\s*=>", data))
    metrics["timeouts"] += data.count("setTimeout(") + data.count("postDelayed(")
    metrics["intervals"] += data.count("setInterval(")
    metrics["listeners"] += data.count("addListener(") + data.count("addEventListener(")
    metrics["stream_players"] += data.count("<StreamPlayer")

    # Duplicate imports are a strong corruption signal in actual Kotlin/Java
    # source files. Do not inspect JS config-plugin templates here: a single JS
    # file can legitimately contain multiple generated Kotlin source strings,
    # each with the same required import.
    if path.suffix in {".kt", ".java"}:
        import_lines = [
            raw.strip()
            for raw in data.splitlines()
            if raw.strip().startswith("import ")
        ]
        dupes = [line for line, count in Counter(import_lines).items() if count > 1]
        for line in dupes:
            critical.append(f"duplicate import: {rel}: {line}")

    if "setInterval(" in data and "clearInterval(" not in data:
        warnings.append(f"interval without file-local clearInterval: {rel}")
    if "AppState.addEventListener" in data and ".remove()" not in data and "sub.remove()" not in data:
        warnings.append(f"AppState listener without obvious remove: {rel}")
    if "DeviceEventEmitter.addListener" in data and ".remove()" not in data and "sub.remove()" not in data:
        warnings.append(f"DeviceEventEmitter listener without obvious remove: {rel}")
    if "Executors.newSingleThreadExecutor" in data and not re.search(r"\.shutdown(?:Now)?\(\)", data):
        critical.append(f"native executor without shutdown: {rel}")
    if "CharmMemoryCoordinator.register" in data and "unregister" not in data:
        critical.append(f"memory listener without unregister owner: {rel}")

# TiViMate-style player/preview ownership invariants.
stream_path = ROOT / "src/components/StreamPlayer.tsx"
stream = text(stream_path)
if 'if (role === "fullscreen") rememberSuccessfulStreamEngine(engineMemoryKey, engine);' not in stream:
    critical.append("preview can write fullscreen successful-engine memory")
if 'if (!uri || role === "preview") return;' not in stream:
    critical.append("preview failures can poison fullscreen circuit state")
if 'if (bufferingSince == null) return;' not in stream or 'MAX_SILENT_BUFFERING_RESYNCS = 1' not in stream:
    critical.append("Media3 explicit-buffering watchdog/resync budget missing")
if 'const RESYNC_REARM_STABLE_MS = 30_000' not in stream or 'const BUFFERING_FAIL_MS = 12_000' not in stream:
    critical.append("Media3 unstable-episode rearm/buffering bound missing")
if "MEDIA3_FROZEN_CLOCK_MS" in stream or "const frozenReadyClock =" in stream:
    critical.append("Media3 clock-silence-only decoder reload is enabled")
if (
    'const VLC_BUFFERING_FAIL_MS = 12_000' not in stream
    or 'const VLC_BUFFERING_FAIL_MS = 12_000' not in stream
    or 'onStopped={fail}' not in stream
):
    critical.append("VLC frozen-progress/stop recovery missing")
if 'mode === "preview" ? "textureView" : "surfaceView"' not in stream:
    critical.append("preview/fullscreen Android surface ownership split missing")
if 'if (!playbackFocused || !uri || !sessionGeneration) return null;' not in stream:
    critical.append("player does not fully disarm while route/app is inactive")

# Outer fullscreen recovery is bounded to one 1s/2s/4s sequence per unstable
# episode, and a transient PLAYING callback cannot instantly buy another cycle.
player_path = ROOT / "app/player.tsx"
player = text(player_path)
for required in (
    'const STREAM_RETRY_DELAYS_MS = [1000, 2000, 4000] as const',
    'const MAX_AUTO_STREAM_RETRIES = 3',
    'const STABLE_RETRY_RESET_MS = 30_000',
):
    if required not in player:
        critical.append(f"fullscreen bounded retry ownership missing: {required}")
if 'if (status === "playing") {\n      setRetryAttempt(0);' in player:
    critical.append("fullscreen retry budget resets on transient PLAYING")

handoff_path = ROOT / "src/utils/openFullscreenPlayer.ts"
handoff = text(handoff_path)
stop_at = handoff.find("stopPreviewForFullscreen();")
push_at = handoff.find("router.push(")
if stop_at < 0 or push_at < 0 or stop_at > push_at:
    critical.append("fullscreen route can open before preview teardown")
if "FULLSCREEN_HANDOFF_SETTLE_MS" not in handoff:
    critical.append("preview->fullscreen native decoder release window missing")

# Background refresh must yield to Guide and Player ownership.
scheduler_path = ROOT / "src/components/SourceRefreshScheduler.tsx"
scheduler = text(scheduler_path)
for required in ('!pathname?.startsWith("/guide")', '!pathname?.startsWith("/player")', '!isGuideSurfing()'):
    if required not in scheduler:
        critical.append(f"source scheduler missing foreground exclusion: {required}")
if "clearTimeout(initialTimer)" not in scheduler or "clearInterval(timer)" not in scheduler or "sub.remove()" not in scheduler:
    critical.append("source refresh scheduler cleanup incomplete")

# Guide must clean its expensive timers/cache owners on blur/unmount.
guide_path = ROOT / "app/(tabs)/guide.tsx"
guide = text(guide_path)
for required in (
    "clearTimeout(previewTimer.current)",
    "clearTimeout(previewRecoverTimer.current)",
    "clearTimeout(surfReleaseTimer.current)",
    "clearTimeout(runwayPatchTimer.current)",
    "setViewportGuideChannelIds(null)",
    "setPriorityMatchChannelIds([])",
    "releaseGuideSlidingCache()",
):
    if required not in guide:
        critical.append(f"Guide lifecycle cleanup missing: {required}")
if 'resetRemoteContextIfOwned("guide", "default")' not in guide:
    critical.append("Guide cleanup can overwrite a newer remote owner")

# Native Guide must own exactly one clock scheduler and shut down DB/executor.
native_guide_path = ROOT / "android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"
native_guide = text(native_guide_path)
if native_guide.count("private const val LIVE_CLOCK_TICK_MS") != 1:
    critical.append("native Guide live clock constant is missing or duplicated")
for required in ("stopLiveClock()", "io.shutdownNow()", "database.close()", "unregisterMemoryListener()"):
    if required not in native_guide:
        critical.append(f"native Guide teardown missing: {required}")

# Remote-context cleanup should be owner-safe outside the central helper.
for path in files:
    rel = path.as_posix()
    if rel.endswith("src/utils/tvRemote.ts"):
        continue
    data = text(path)
    if re.search(r'setRemoteContext\(\s*["\']default["\']\s*\)', data):
        warnings.append(f"direct default remote-context reset (verify ownership): {rel}")

# Report all lifecycle hot spots so the audit covers the whole checked-out source tree.
report = Path("ci/code-interaction-audit-lifecycle-report.txt")
lines = [
    "CharmIPTV whole-app lifecycle scan",
    f"files_scanned={metrics['files']}",
    f"function_declarations={metrics['functions']}",
    f"arrow_callbacks={metrics['arrow_callbacks']}",
    f"timer_sites={metrics['timeouts'] + metrics['intervals']}",
    f"listener_sites={metrics['listeners']}",
    f"stream_player_mount_sites={metrics['stream_players']}",
    f"critical_findings={len(critical)}",
    f"warnings={len(warnings)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
    "",
    "WARNINGS / MANUAL REVIEW",
    *(warnings or ["none"]),
]
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
