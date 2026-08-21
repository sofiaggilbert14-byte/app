from pathlib import Path
import sys

ROOT = Path("frontend")
critical: list[str] = []

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="replace")

stream = read("src/components/StreamPlayer.tsx")
guide = read("app/(tabs)/guide.tsx")
rail = read("src/components/GuidePreviewRail.tsx")
handoff = read("src/utils/openFullscreenPlayer.ts")
session = read("src/core/playbackSession.ts")
player = read("app/player.tsx")
scheduler = read("src/components/SourceRefreshScheduler.tsx")
quick_actions = read("src/components/TvQuickActionsOverlay.tsx")

# Preview is best-effort and must never teach/poison fullscreen health.
if 'if (role === "fullscreen") rememberSuccessfulStreamEngine(engineMemoryKey, engine);' not in stream:
    critical.append("preview can rewrite fullscreen successful-engine memory")
if 'if (!uri || role === "preview") return;' not in stream:
    critical.append("preview failures can open fullscreen circuit state")
if "noteStreamFailure" in guide or "clearStreamFailure" in guide:
    critical.append("Guide preview can mutate fullscreen failed-stream registry")

# A visible preview must self-release if its native decoder/socket freezes. The
# stricter deep repair uses an 8s VLC frozen-progress gate, 12s terminal buffering
# gate, and exactly one Media3 reprepare per unstable episode.
if 'if (mode === "preview" || paused || blocked) return;' in stream:
    critical.append("VLC preview is excluded from frozen-progress watchdog")
if 'if (mode === "preview" || paused || blocked || !mediaReady)' in stream:
    critical.append("Media3 preview is excluded from buffering watchdog")
for required in (
    "const VLC_BUFFERING_FAIL_MS = 12_000",
    "if (bufferingSince == null) return;",
    "const BUFFERING_RESYNC_MS = 5000",
    "const BUFFERING_FAIL_MS = 12_000",
    "MAX_SILENT_BUFFERING_RESYNCS = 1",
    "const RESYNC_REARM_STABLE_MS = 30_000",
):
    if required not in stream:
        critical.append(f"missing bounded player watchdog contract: {required}")

if "MEDIA3_FROZEN_CLOCK_MS" in stream or "const frozenReadyClock =" in stream:
    critical.append("Media3 clock-silence-only decoder reload is enabled")

# Preview memory/network footprint stays below fullscreen and muted audio cannot
# steal Android AUDIOFOCUS from the real player.
for required in (
    'const networkCaching = mode === "preview" ? 1000 : fullMs',
    'const liveCaching = mode === "preview" ? 1000 : fullMs',
    'const fileCaching = mode === "preview" ? 700 : Math.round(fullMs * 0.62)',
    'maxBufferBytes: Math.min(12 * 1024 * 1024, coordinatedCacheBudget)',
    'player.audioMixingMode = mode === "preview" ? "mixWithOthers" : "doNotMix"',
    'mode === "preview" ? "textureView" : "surfaceView"',
):
    if required not in stream:
        critical.append(f"preview RAM/audio/surface isolation missing: {required}")

# Route/app blur must unmount the decoder completely.
if 'if (!playbackFocused || !uri || !sessionGeneration) return null;' not in stream:
    critical.append("inactive/background player can retain decoder view")
if 'const sub = AppState.addEventListener("change"' not in stream or 'return () => sub.remove();' not in stream:
    critical.append("player AppState listener lifecycle is incomplete")

# Preview -> fullscreen must destroy preview first and leave a native codec release window.
stop_at = handoff.find("stopPreviewForFullscreen();")
push_at = handoff.find("router.push(")
if stop_at < 0 or push_at < 0 or stop_at > push_at:
    critical.append("fullscreen route can start before preview teardown")
if "FULLSCREEN_HANDOFF_SETTLE_MS = 90" not in handoff:
    critical.append("preview/fullscreen decoder settle window missing")
if 'stopSession("preview", "superseded")' not in session:
    critical.append("preview session generation is not invalidated for fullscreen")

# Fullscreen retries/zaps follow the same single-decoder ownership contract.
for required in (
    'pauseSessionDecoders("fullscreen")',
    "DECODER_RESTART_SETTLE_MS = 120",
    "CHANNEL_ZAP_SETTLE_MS = 850",
    'stopFullscreenSession()',
    "const MAX_AUTO_STREAM_RETRIES = 3",
    "const STABLE_RETRY_RESET_MS = 30_000",
):
    if required not in player:
        critical.append(f"fullscreen decoder ownership contract missing: {required}")

# Guide is the only preview mount and is explicitly muted by default.
if rail.count("<StreamPlayer") != 1:
    critical.append(f"unexpected Guide preview StreamPlayer mount count={rail.count('<StreamPlayer')}")
for required in ('mode="preview"', 'sessionRole="preview"', "muted={muted}"):
    if required not in rail:
        critical.append(f"Guide preview mount contract missing: {required}")

# Provider refresh must never compete for sockets/SQLite while Guide/player owns foreground.
for required in (
    '!pathname?.startsWith("/guide")',
    '!pathname?.startsWith("/player")',
    "!isGuideSurfing()",
    "clearTimeout(initialTimer)",
    "clearInterval(timer)",
    "sub.remove()",
):
    if required not in scheduler:
        critical.append(f"background source lifecycle contract missing: {required}")

# Quick Actions is a temporary modal owner. Route replacement must close it, and
# stale modal cleanup must never overwrite a player/Guide/drawer that already
# claimed the remote. This mirrors the same owner-safe teardown used elsewhere.
for required in (
    'resetRemoteContextIfOwned("modal", restore)',
    'const openPathRef = useRef<string | null>(null)',
    'openPathRef.current = pathname || ""',
    'if (openedPath == null || openedPath === (pathname || "")) return;',
    'close();',
):
    if required not in quick_actions:
        critical.append(f"Quick Actions owner lifecycle missing: {required}")
if 'setRemoteContext(pathname?.startsWith("/player")' in quick_actions:
    critical.append("Quick Actions still performs unconditional route-owner restoration")

report = Path("ci/code-interaction-audit-preview-lifecycle-report.txt")
lines = [
    "CharmIPTV preview/player lifecycle scan",
    f"critical_findings={len(critical)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
]
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
