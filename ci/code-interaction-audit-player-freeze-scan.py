from pathlib import Path
import subprocess
import sys

ROOT = Path("frontend")
critical: list[str] = []
notes: list[str] = []


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8", errors="replace")

stream = read("src/components/StreamPlayer.tsx")
player = read("app/player.tsx")
guide = read("app/(tabs)/guide.tsx")
rail = read("src/components/GuidePreviewRail.tsx")
session = read("src/core/playbackSession.ts")
handoff = read("src/utils/openFullscreenPlayer.ts")
scheduler = read("src/components/SourceRefreshScheduler.tsx")

# Repository-wide native decoder ownership: only StreamPlayer may instantiate
# expo-video or LibVLC. Any other direct mount can overlap preview/fullscreen.
for path in ROOT.rglob("*.ts*"):
    rel = path.relative_to(ROOT).as_posix()
    if any(part in {"node_modules", "build", ".gradle", ".expo", "dist"} for part in path.parts):
        continue
    text = path.read_text(encoding="utf-8", errors="replace")
    if rel == "src/components/StreamPlayer.tsx":
        continue
    risky = []
    if "useVideoPlayer(" in text: risky.append("useVideoPlayer")
    if "<VideoView" in text: risky.append("VideoView")
    if "RCTVLCPlayer" in text: risky.append("RCTVLCPlayer")
    if "react-native-vlc-media-player" in text: risky.append("react-native-vlc-media-player")
    if "<VLCPlayer" in text: risky.append("VLCPlayer")
    if risky:
        critical.append(f"direct native decoder outside StreamPlayer: {rel}: {', '.join(risky)}")

# Exactly one preview and one fullscreen StreamPlayer owner.
if rail.count("<StreamPlayer") != 1:
    critical.append(f"Guide preview StreamPlayer count={rail.count('<StreamPlayer')}")
if player.count("<StreamPlayer") != 1:
    critical.append(f"fullscreen StreamPlayer count={player.count('<StreamPlayer')}")
for token in ('mode="preview"', 'sessionRole="preview"'):
    if token not in rail:
        critical.append(f"Guide preview ownership missing {token}")
for token in ('mode="full"', 'sessionRole="fullscreen"'):
    if token not in player:
        critical.append(f"fullscreen ownership missing {token}")

# Preview -> fullscreen release must precede route creation.
if handoff.find("stopPreviewForFullscreen();") < 0 or handoff.find("router.push(") < 0:
    critical.append("preview/fullscreen handoff markers missing")
elif handoff.find("stopPreviewForFullscreen();") > handoff.find("router.push("):
    critical.append("fullscreen route starts before preview decoder teardown")
if "FULLSCREEN_HANDOFF_SETTLE_MS = 90" not in handoff:
    critical.append("preview/fullscreen native release settle window missing")

# Role scoped generations prevent stale callbacks from a released codec.
for token in (
    'export function beginSession(role: SessionRole)',
    'export function isSessionCurrent(role: SessionRole, generation: number)',
    'state.stops.clear();',
    'stopSession("preview", "superseded")',
):
    if token not in session:
        critical.append(f"session ownership contract missing: {token}")

# Fatal native failures must stop the decoder BEFORE publishing error. This is
# the key final-frozen-frame guard when retries are exhausted.
for token in (
    'hardStop();\n    recordFailure(sessionRole, engine, uri, "stream-error");',
    'hardStop();\n      recordFailure(sessionRole, engine, uri, "stream-error");',
    'if (sawSupportedAudio) return;\n      hardStop();',
):
    if token not in stream:
        critical.append(f"release-before-error contract missing: {token.splitlines()[0]}")

# Live IPTV clock silence is not proof of a frozen decoder. Only an explicit
# post-playback loading/buffering state may arm source replacement.
if 'if (bufferingSince == null) return;' not in stream:
    critical.append("Media3 explicit-buffering recovery gate missing")
if "MEDIA3_FROZEN_CLOCK_MS" in stream or "const frozenReadyClock =" in stream:
    critical.append("Media3 clock-only reload can cause pause/reload/freeze cascades")

# Exactly one in-engine Media3 resync per unstable episode. The outer fullscreen
# owner gets one bounded 1s/2s/4s sequence and may only re-arm after 30s stable.
if "const MAX_SILENT_BUFFERING_RESYNCS = 1;" not in stream:
    critical.append("Media3 has more than one nested silent re-prepare budget")
if "const RESYNC_REARM_STABLE_MS = 30_000;" not in stream:
    critical.append("Media3 unstable episode can re-arm before 30 seconds stable")
if "const MAX_AUTO_STREAM_RETRIES = 3;" not in player:
    critical.append("fullscreen outer retry budget is not exactly three attempts")
if "const STABLE_RETRY_RESET_MS = 30_000;" not in player:
    critical.append("fullscreen retry budget can re-arm before 30 seconds stable")
if "STREAM_RETRY_DELAYS_MS = [1000, 2000, 4000]" not in player:
    critical.append("fullscreen retry backoff contract changed unexpectedly")
if 'if (status === "playing") {\n      setRetryAttempt(0);' in player:
    critical.append("brief PLAYING state immediately resets outer retry budget")
if 'if (failReason === "circuit-open" || isFullscreenCircuitOpen(streamUri)) return;' not in player:
    critical.append("auto retry can storm a circuit-open decoder")

# Expiring provider URLs get one playlist-only source recheck after local
# decoder retries are exhausted. The decoder must be released first, and EPG
# parsing must remain outside this recovery path.
for token in (
    "sourceRecheckAttemptedRef.current",
    'pauseSessionDecoders("fullscreen")',
    "refreshPlaybackChannel(logicalChannelId)",
    "setRecoveryUri(freshUri)",
):
    if token not in player:
        critical.append(f"bounded provider source recheck missing: {token}")

# Forced engine settings must also control startup-timeout recovery.
if "if (fallbackUsed || forceVlc || forceMedia3)" not in stream:
    critical.append("forced Media3/VLC can be ignored by startup-timeout fallback")
if "pauseSessionDecoders(role);" not in stream:
    critical.append("terminal startup timeout does not release native decoder")

# Route/app focus and settings changes cannot leave hidden decoders alive.
for token in (
    'if (!playbackFocused || !uri || !sessionGeneration) return null;',
    'const sub = AppState.addEventListener("change"',
    'role !== "preview" || isFocused',
):
    if token not in stream:
        critical.append(f"background/settings decoder lifecycle missing: {token}")

# RAM/cache/network bleed: provider refresh cannot compete with active player or Guide.
for token in (
    '!pathname?.startsWith("/guide")',
    '!pathname?.startsWith("/player")',
    "!isGuideSurfing()",
    "clearInterval(timer)",
):
    if token not in scheduler:
        critical.append(f"source refresh can bleed into playback: {token}")

# Fullscreen zaps/retries must disarm first and wait for native codec release.
for token in (
    'pauseSessionDecoders("fullscreen")',
    "DECODER_RESTART_SETTLE_MS = 120",
    "setDecoderArmed(false)",
    "stopFullscreenSession()",
):
    if token not in player:
        critical.append(f"fullscreen decoder remount contract missing: {token}")

# Compare main as requested. Main is reference-only here; repaired audit branch is
# the candidate. Report known risky contracts still present in main so nothing is
# accidentally copied back during future merges.
try:
    main_stream = subprocess.check_output(
        ["git", "show", "origin/main:frontend/src/components/StreamPlayer.tsx"],
        text=True,
        stderr=subprocess.DEVNULL,
    )
    if "MEDIA3_FROZEN_CLOCK_MS" in main_stream or "const frozenReadyClock =" in main_stream:
        notes.append("main still allows clock-silence-only Media3 reloads; do not back-port that recovery gate")
    if 'if (fallbackUsed || forceVlc || forceMedia3)' not in main_stream:
        notes.append("main startup-timeout path does not honor forced engine preference")
    if 'hardStop();\n      recordFailure(sessionRole, engine, uri, "stream-error");' not in main_stream:
        notes.append("main does not consistently release Media3 before fatal error publication")
except Exception as exc:
    notes.append(f"main comparison unavailable: {exc}")

report = Path("ci/code-interaction-audit-player-freeze-report.txt")
report.write_text(
    "\n".join([
        "CharmIPTV repo-wide player/decoder/codec bleed scan",
        f"critical_findings={len(critical)}",
        f"main_reference_notes={len(notes)}",
        "",
        "CRITICAL",
        *(critical or ["none"]),
        "",
        "MAIN_REFERENCE_NOTES",
        *(notes or ["none"]),
    ]) + "\n",
    encoding="utf-8",
)
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
