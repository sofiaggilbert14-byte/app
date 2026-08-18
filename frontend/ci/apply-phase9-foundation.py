from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one anchor, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# Native remote owner: one layer owns boundary keys at a time.
module = ROOT / "android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt"
replace_once(
    module,
    '    @JvmField\n    var guideRepeatIntervalMs: Long = 72L\n',
    '    @JvmField\n    var guideRepeatIntervalMs: Long = 72L\n    @JvmField\n    var remoteOwner: String = "APP"\n',
)
replace_once(
    module,
    '  @ReactMethod\n  fun setGuideRepeatInterval(milliseconds: Double) {\n    guideRepeatIntervalMs = milliseconds.toLong().coerceIn(60L, 120L)\n  }\n',
    '  @ReactMethod\n  fun setGuideRepeatInterval(milliseconds: Double) {\n    guideRepeatIntervalMs = milliseconds.toLong().coerceIn(60L, 120L)\n  }\n\n  @ReactMethod\n  fun setRemoteOwner(owner: String) {\n    remoteOwner = owner.uppercase().take(32)\n  }\n',
)

activity = ROOT / "android/app/src/main/java/com/charmiptv/app/MainActivity.kt"
replace_once(
    activity,
    '  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {\n',
    '  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {\n    val remoteOwner = TvRemoteModule.remoteOwner\n',
)
replace_once(
    activity,
    '    if (key != null && (!TvRemoteModule.guideNavigationActive || TvRemoteModule.pointerActive)) {\n',
    '    // The Groups drawer owns only its horizontal boundary keys. Up/Down and\n    // Select continue through Android TV focus so one physical event cannot move\n    // both the Guide and the drawer.\n    if (\n      key != null &&\n        event.repeatCount == 0 &&\n        remoteOwner == "GROUP_DRAWER" &&\n        (key == "LEFT" || key == "RIGHT")\n    ) {\n      emitRemoteEvent("TvRemoteKey", key)\n      return true\n    }\n\n    if (\n      key != null &&\n        remoteOwner != "GROUP_DRAWER" &&\n        remoteOwner != "MAIN_DRAWER" &&\n        (!TvRemoteModule.guideNavigationActive || TvRemoteModule.pointerActive)\n    ) {\n',
)
replace_once(
    activity,
    '    TvRemoteModule.pointerActive = false\n    TvRemoteModule.guideNavigationActive = false\n',
    '    TvRemoteModule.pointerActive = false\n    TvRemoteModule.guideNavigationActive = false\n    TvRemoteModule.remoteOwner = "APP"\n',
)

# Player: do not classify a normal short IPTV rebuffer as a fatal frozen decoder.
player = ROOT / "src/components/StreamPlayer.tsx"
replace_once(player, 'const FROZEN_VIDEO_WATCHDOG_MS = 5000;\n', 'const FROZEN_VIDEO_WATCHDOG_MS = 15_000;\n')
replace_once(
    player,
    '  const lastPlaybackTimeRef = useRef(-1);\n  const lastPlaybackAdvanceAtRef = useRef(Date.now());\n',
    '  const lastPlaybackTimeRef = useRef(-1);\n  const lastPlaybackAdvanceAtRef = useRef(Date.now());\n  const playbackTransportStateRef = useRef<"idle" | "loading" | "ready">("idle");\n',
)
replace_once(
    player,
    '    const requestedMs = bufferProfile === "low_latency" ? 900 : bufferProfile === "stable" ? 3200 : 1800;\n    const fullMs = lowRam ? Math.min(requestedMs, 1800) : requestedMs;\n',
    '    const requestedMs = bufferProfile === "low_latency" ? 1200 : bufferProfile === "stable" ? 5000 : 3000;\n    const fullMs = lowRam ? Math.min(requestedMs, 2800) : requestedMs;\n',
)
replace_once(
    player,
    '          : {\n              preferredForwardBufferDuration: lowRam ? 2.2 : (media3Audio === "ffmpeg" ? 3.5 : 3),\n              maxBufferBytes: (lowRam ? 24 : (media3Audio === "ffmpeg" ? 56 : 48)) * 1024 * 1024,\n            };\n',
    '          : {\n              preferredForwardBufferDuration: lowRam ? 3.0 : (media3Audio === "ffmpeg" ? 5.5 : 5.0),\n              maxBufferBytes: (lowRam ? 28 : (media3Audio === "ffmpeg" ? 64 : 56)) * 1024 * 1024,\n            };\n',
)
replace_once(
    player,
    '      if (status === "readyToPlay") {\n        lastPlaybackTimeRef.current = player.currentTime;\n',
    '      if (status === "readyToPlay") {\n        playbackTransportStateRef.current = "ready";\n        lastPlaybackTimeRef.current = player.currentTime;\n',
)
replace_once(
    player,
    '      } else if (status === "loading") {\n        emit("loading");\n      } else if (error || status === "error") {\n',
    '      } else if (status === "loading") {\n        // A provider/HLS rebuffer is not a frozen decoder. Reset the watchdog\n        // clock and let Media3 refill rather than tearing down a healthy session.\n        playbackTransportStateRef.current = "loading";\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        emit("loading");\n      } else if (error || status === "error") {\n        playbackTransportStateRef.current = "idle";\n',
)
replace_once(
    player,
    '      if (!mountedRef.current || tearingDownRef.current || paused || blocked) return;\n      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n      if (Date.now() - lastPlaybackAdvanceAtRef.current < FROZEN_VIDEO_WATCHDOG_MS) return;\n',
    '      if (!mountedRef.current || tearingDownRef.current || paused || blocked) return;\n      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n      if (playbackTransportStateRef.current !== "ready") return;\n      if (Date.now() - lastPlaybackAdvanceAtRef.current < FROZEN_VIDEO_WATCHDOG_MS) return;\n',
)

print("Phase 9 foundation patch applied")
