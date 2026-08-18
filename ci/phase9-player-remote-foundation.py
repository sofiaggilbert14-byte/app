from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# ---- Shared remote shortcut semantics: restore long-OK favorite as the default. ----
replace(
    'frontend/src/core/remoteShortcutPreferences.ts',
    'export type LongSelectAction = "controls" | "guide" | "none";',
    'export type LongSelectAction = "favorite" | "controls" | "guide" | "none";',
)
replace(
    'frontend/src/core/remoteShortcutPreferences.ts',
    '  longSelect: "controls",',
    '  longSelect: "favorite",',
)
replace(
    'frontend/src/core/remoteShortcutPreferences.ts',
    '    longSelect: value?.longSelect === "guide" || value?.longSelect === "none" ? value.longSelect : "controls",',
    '    longSelect: value?.longSelect === "favorite" || value?.longSelect === "guide" || value?.longSelect === "controls" || value?.longSelect === "none" ? value.longSelect : "favorite",',
)

# ---- JS/native remote context bridge. ----
replace(
    'frontend/src/utils/tvRemote.ts',
    'export function setGuideNavigationActive(active: boolean) {\n  try {\n    TvRemote?.setGuideNavigationActive?.(active);\n  } catch {}\n}\n',
    'export function setGuideNavigationActive(active: boolean) {\n  try {\n    TvRemote?.setGuideNavigationActive?.(active);\n  } catch {}\n}\n\nexport type RemoteContext = "default" | "guide" | "guide_groups" | "main_drawer" | "player" | "modal";\n\nexport function setRemoteContext(context: RemoteContext) {\n  try { TvRemote?.setRemoteContext?.(context); } catch {}\n}\n',
)

replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt',
    '    @JvmField\n    var guideRepeatIntervalMs: Long = 72L\n',
    '    @JvmField\n    var guideRepeatIntervalMs: Long = 72L\n    @JvmField\n    var remoteContext: String = "default"\n',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt',
    '  @ReactMethod\n  fun setGuideRepeatInterval(milliseconds: Double) {\n    guideRepeatIntervalMs = milliseconds.toLong().coerceIn(60L, 120L)\n  }\n',
    '  @ReactMethod\n  fun setGuideRepeatInterval(milliseconds: Double) {\n    guideRepeatIntervalMs = milliseconds.toLong().coerceIn(60L, 120L)\n  }\n\n  @ReactMethod\n  fun setRemoteContext(context: String) {\n    remoteContext = when (context) {\n      "guide", "guide_groups", "main_drawer", "player", "modal" -> context\n      else -> "default"\n    }\n  }\n',
)

# ---- Checked-in MainActivity: restore semantic long presses + explicit drawer ownership. ----
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt',
    '  private var lastAcceptedDirectionalKeyCode = -1\n',
    '  private var lastAcceptedDirectionalKeyCode = -1\n  private var emittedLongPressKeyCode = -1\n',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt',
    '  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {\n',
    '''  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {\n    // Emit one semantic long-press event per physical hold. This is the\n    // authoritative path for long OK/Select favorites on installed Android TV builds.\n    if (event.action == android.view.KeyEvent.ACTION_DOWN && event.repeatCount > 0 && emittedLongPressKeyCode != event.keyCode) {\n      val longKey = when (event.keyCode) {\n        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"\n        android.view.KeyEvent.KEYCODE_DPAD_CENTER,\n        android.view.KeyEvent.KEYCODE_ENTER,\n        android.view.KeyEvent.KEYCODE_NUMPAD_ENTER,\n        android.view.KeyEvent.KEYCODE_BUTTON_A -> "SELECT"\n        android.view.KeyEvent.KEYCODE_BACK -> "BACK"\n        else -> null\n      }\n      if (longKey != null) {\n        emittedLongPressKeyCode = event.keyCode\n        emitRemoteEvent("TvRemoteLongPress", longKey)\n      }\n    } else if (event.action == android.view.KeyEvent.ACTION_UP && event.keyCode == emittedLongPressKeyCode) {\n      emittedLongPressKeyCode = -1\n    }\n\n    // Phase 9 remote ownership. Drawers own only their boundary transitions;\n    // Up/Down/OK remain native focus events inside the active drawer.\n    if (event.action == android.view.KeyEvent.ACTION_DOWN && event.repeatCount == 0 && !TvRemoteModule.pointerActive) {\n      val context = TvRemoteModule.remoteContext\n      val boundaryKey = when (event.keyCode) {\n        android.view.KeyEvent.KEYCODE_DPAD_LEFT -> "LEFT"\n        android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> "RIGHT"\n        android.view.KeyEvent.KEYCODE_BACK -> "BACK"\n        else -> null\n      }\n      val owned =\n        (context == "guide_groups" && boundaryKey != null) ||\n          (context == "main_drawer" && boundaryKey == "RIGHT")\n      if (owned && boundaryKey != null) {\n        emitRemoteEvent("TvRemoteKey", boundaryKey)\n        return true\n      }\n    }\n''',
)
replace(
    'frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt',
    '    TvRemoteModule.guideNavigationActive = false\n    super.onDestroy()',
    '    TvRemoteModule.guideNavigationActive = false\n    TvRemoteModule.remoteContext = "default"\n    super.onDestroy()',
)

# ---- Player freeze recovery: a progress watchdog is not the same as BUFFERING. ----
replace(
    'frontend/src/components/StreamPlayer.tsx',
    'const FROZEN_VIDEO_WATCHDOG_MS = 5000;',
    'const STALL_RECOVERY_NUDGE_MS = 7000;\nconst FROZEN_VIDEO_WATCHDOG_MS = 18000;',
)
replace(
    'frontend/src/components/StreamPlayer.tsx',
    '  const lastPlaybackAdvanceAtRef = useRef(Date.now());\n',
    '  const lastPlaybackAdvanceAtRef = useRef(Date.now());\n  const lastStallNudgeAtRef = useRef(0);\n',
)
replace(
    'frontend/src/components/StreamPlayer.tsx',
    '    const requestedMs = bufferProfile === "low_latency" ? 900 : bufferProfile === "stable" ? 3200 : 1800;\n    const fullMs = lowRam ? Math.min(requestedMs, 1800) : requestedMs;',
    '    const requestedMs = bufferProfile === "low_latency" ? 1200 : bufferProfile === "stable" ? 5200 : 3000;\n    const fullMs = lowRam ? Math.min(requestedMs, 3000) : requestedMs;',
)
replace(
    'frontend/src/components/StreamPlayer.tsx',
    '''      const full = profile === "low_latency"\n        ? {\n            preferredForwardBufferDuration: lowRam ? 1.2 : (media3Audio === "ffmpeg" ? 2.0 : 1.5),\n            maxBufferBytes: (lowRam ? 18 : (media3Audio === "ffmpeg" ? 36 : 28)) * 1024 * 1024,\n          }\n        : profile === "stable"\n          ? { preferredForwardBufferDuration: lowRam ? 3.5 : 6, maxBufferBytes: (lowRam ? 28 : 48) * 1024 * 1024 }\n          : {\n              preferredForwardBufferDuration: lowRam ? 2.2 : (media3Audio === "ffmpeg" ? 3.5 : 3),\n              maxBufferBytes: (lowRam ? 24 : (media3Audio === "ffmpeg" ? 56 : 48)) * 1024 * 1024,\n            };''',
    '''      const full = profile === "low_latency"\n        ? {\n            preferredForwardBufferDuration: lowRam ? 1.8 : (media3Audio === "ffmpeg" ? 2.8 : 2.2),\n            maxBufferBytes: (lowRam ? 20 : (media3Audio === "ffmpeg" ? 40 : 32)) * 1024 * 1024,\n          }\n        : profile === "stable"\n          ? { preferredForwardBufferDuration: lowRam ? 5 : 10, maxBufferBytes: (lowRam ? 32 : 64) * 1024 * 1024 }\n          : {\n              preferredForwardBufferDuration: lowRam ? 3.5 : (media3Audio === "ffmpeg" ? 6 : 5),\n              maxBufferBytes: (lowRam ? 28 : (media3Audio === "ffmpeg" ? 60 : 52)) * 1024 * 1024,\n            };''',
)
replace(
    'frontend/src/components/StreamPlayer.tsx',
    '''      if (Date.now() - lastPlaybackAdvanceAtRef.current < FROZEN_VIDEO_WATCHDOG_MS) return;\n      lastPlaybackAdvanceAtRef.current = Date.now();\n      recordFailure(sessionRole, engine, uri, "stream-error");\n      emit("error", "stream-error");''',
    '''      const stalledFor = Date.now() - lastPlaybackAdvanceAtRef.current;\n      if (stalledFor >= STALL_RECOVERY_NUDGE_MS && stalledFor < FROZEN_VIDEO_WATCHDOG_MS) {\n        // A live HLS/TS source can legitimately stop advancing for several\n        // seconds while waiting for the next provider segment. Nudge play once\n        // without tearing down sockets/decoders; only escalate a sustained stall.\n        if (Date.now() - lastStallNudgeAtRef.current >= STALL_RECOVERY_NUDGE_MS) {\n          lastStallNudgeAtRef.current = Date.now();\n          try { player.play(); } catch {}\n        }\n        return;\n      }\n      if (stalledFor < FROZEN_VIDEO_WATCHDOG_MS) return;\n      lastPlaybackAdvanceAtRef.current = Date.now();\n      lastStallNudgeAtRef.current = 0;\n      recordFailure(sessionRole, engine, uri, "stream-error");\n      emit("error", "stream-error");''',
)

# ---- Fullscreen long-OK favorite. ----
replace(
    'frontend/app/player.tsx',
    '    addRecent,\n    playerControlsTimeoutMs,',
    '    addRecent,\n    toggleFavorite,\n    playerControlsTimeoutMs,',
)
replace(
    'frontend/app/player.tsx',
    '''      if (key === "SELECT") {\n        if (remoteShortcuts.longSelect === "guide") {\n          goGuide();\n          return;\n        }\n        if (remoteShortcuts.longSelect === "controls") revealControls({ claimChannelsFocus: true });\n      }''',
    '''      if (key === "SELECT") {\n        if (remoteShortcuts.longSelect === "favorite") {\n          const target = pendingChannelIdRef.current || channelIdRef.current;\n          if (target) {\n            toggleFavorite(target);\n            showNotice("Favorite updated");\n          }\n          return;\n        }\n        if (remoteShortcuts.longSelect === "guide") {\n          goGuide();\n          return;\n        }\n        if (remoteShortcuts.longSelect === "controls") revealControls({ claimChannelsFocus: true });\n      }''',
)
replace(
    'frontend/app/player.tsx',
    '  }, [goGuide, isTV, remoteShortcuts.longDown, remoteShortcuts.longSelect, revealControls, scheduleHide, setChannelsOpen, setMoreOpen, setTracksOpen]);',
    '  }, [goGuide, isTV, remoteShortcuts.longDown, remoteShortcuts.longSelect, revealControls, scheduleHide, setChannelsOpen, setMoreOpen, setTracksOpen, showNotice, toggleFavorite]);',
)

# ---- Settings exposes the restored behavior. ----
replace(
    'frontend/app/(tabs)/settings.tsx',
    '                    { label: "Show player controls", value: "controls" },\n                    { label: "Open TV Guide", value: "guide" },',
    '                    { label: "Add/remove Favorite", value: "favorite" },\n                    { label: "Show player controls", value: "controls" },\n                    { label: "Open TV Guide", value: "guide" },',
)

print('phase9 player/remote foundation patched')
