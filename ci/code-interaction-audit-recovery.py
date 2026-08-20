from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# Late live-stream recovery: a stream that was stable before it froze must not
# keep the stable gate while its fallback engine starts. Also, the one allowed
# alternate engine still needs a bounded start timeout so a hung fallback can
# surface an error to PlayerScreen's retry/remount path.
stream_path = Path("frontend/src/components/StreamPlayer.tsx")
stream = stream_path.read_text(encoding="utf-8")

stream = replace_once(
    stream,
    '''      const frozenReadyClock =\n        bufferingSince == null &&\n        hasPlayedRef.current &&\n        Boolean((player as any).playing) &&\n        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;''',
    '''      const frozenReadyClock =\n        bufferingSince == null &&\n        hasPlayedRef.current &&\n        mediaReady &&\n        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;''',
    "Media3 frozen-clock gate",
)

stream = replace_once(
    stream,
    '''    const timer = setTimeout(() => {\n      if (stableRef.current || fallbackUsed) return;\n      if (!isSessionCurrent(role, sessionGeneration)) return;\n      const alternate = alternateEngine(engine, vlcAvailable);''',
    '''    const timer = setTimeout(() => {\n      if (stableRef.current) return;\n      if (!isSessionCurrent(role, sessionGeneration)) return;\n      // The one allowed alternate engine still needs a bounded startup. If it\n      // never reaches playing, surface an error so PlayerScreen can perform its\n      // full decoder remount/backoff instead of staying on a permanent spinner.\n      if (fallbackUsed) {\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");\n        setStatus("error", "start-timeout");\n        return;\n      }\n      const alternate = alternateEngine(engine, vlcAvailable);''',
    "fallback start timeout",
)

stream = replace_once(
    stream,
    '''        if (alternate) {\n          setFallbackUsed(true);\n          setEngine(alternate);\n          const swapReason: SessionFailReason =''',
    '''        if (alternate) {\n          // A post-playback failure is a new recovery attempt. Clear the stable\n          // gate before mounting the alternate or its own start timeout is\n          // suppressed by the earlier successful engine.\n          stableRef.current = false;\n          if (role === "fullscreen") setNativePlaybackStarting(true);\n          setFallbackUsed(true);\n          setEngine(alternate);\n          const swapReason: SessionFailReason =''',
    "late alternate stable reset",
)

stream_path.write_text(stream, encoding="utf-8")


# Native Guide live clock: advanceLiveViewport() already owns the correct
# wall-clock math and coalesces SQLite reads. It was only called from onDraw,
# however, and nothing guaranteed a draw while the user simply watched the
# Guide. Add one active-only native clock tick so old programme blocks slide off
# with time instead of waiting for a D-pad/data event.
guide_path = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt")
guide = guide_path.read_text(encoding="utf-8")

# Clean a migration artifact while touching this file.
while "import kotlin.math.abs\nimport kotlin.math.abs\n" in guide:
    guide = guide.replace("import kotlin.math.abs\nimport kotlin.math.abs\n", "import kotlin.math.abs\n")

field_anchor = '''  private var liveFollowEnabled = true\n  private var lastLiveFollowQueryStartMs = Long.MIN_VALUE\n  private val settleSelectionRunnable = Runnable {'''
field_replacement = '''  private var liveFollowEnabled = true\n  private var lastLiveFollowQueryStartMs = Long.MIN_VALUE\n  private val liveClockRunnable = Runnable {\n    if (!disposed && enabled && isAttachedToWindow) {\n      invalidate()\n      scheduleLiveClock()\n    }\n  }\n  private val settleSelectionRunnable = Runnable {'''
guide = replace_once(guide, field_anchor, field_replacement, "Guide live clock field")

init_anchor = '''  init {\n    isFocusable = true\n    isFocusableInTouchMode = true\n    setBackgroundColor(Color.BLACK)\n  }\n\n  fun setChannels'''
init_replacement = '''  init {\n    isFocusable = true\n    isFocusableInTouchMode = true\n    setBackgroundColor(Color.BLACK)\n  }\n\n  private fun scheduleLiveClock() {\n    removeCallbacks(liveClockRunnable)\n    if (!disposed && enabled && isAttachedToWindow) {\n      postDelayed(liveClockRunnable, LIVE_CLOCK_TICK_MS)\n    }\n  }\n\n  private fun stopLiveClock() {\n    removeCallbacks(liveClockRunnable)\n  }\n\n  fun setChannels'''
guide = replace_once(guide, init_anchor, init_replacement, "Guide live clock helpers")

active_anchor = '''    enabled = value\n    if (!value) {\n      removeCallbacks(settleSelectionRunnable)'''
active_replacement = '''    enabled = value\n    if (!value) {\n      stopLiveClock()\n      removeCallbacks(settleSelectionRunnable)'''
guide = replace_once(guide, active_anchor, active_replacement, "Guide inactive clock stop")

active_resume_anchor = '''    }\n    applyPendingRestoreChannel()\n    // React may re-apply an unchanged active=true prop while Preview owns focus.'''
active_resume_replacement = '''    }\n    scheduleLiveClock()\n    applyPendingRestoreChannel()\n    // React may re-apply an unchanged active=true prop while Preview owns focus.'''
guide = replace_once(guide, active_resume_anchor, active_resume_replacement, "Guide active clock start")

attached_anchor = '''  override fun onAttachedToWindow() {\n    super.onAttachedToWindow()\n    applyPendingRestoreChannel()\n    loadPrograms()\n  }'''
attached_replacement = '''  override fun onAttachedToWindow() {\n    super.onAttachedToWindow()\n    scheduleLiveClock()\n    applyPendingRestoreChannel()\n    loadPrograms()\n  }'''
guide = replace_once(guide, attached_anchor, attached_replacement, "Guide attach clock start")

detached_anchor = '''  override fun onDetachedFromWindow() {\n    removeCallbacks(settleSelectionRunnable)'''
detached_replacement = '''  override fun onDetachedFromWindow() {\n    stopLiveClock()\n    removeCallbacks(settleSelectionRunnable)'''
guide = replace_once(guide, detached_anchor, detached_replacement, "Guide detach clock stop")

dispose_anchor = '''  fun dispose() {\n    if (disposed) return\n    removeCallbacks(settleSelectionRunnable)'''
dispose_replacement = '''  fun dispose() {\n    if (disposed) return\n    stopLiveClock()\n    removeCallbacks(settleSelectionRunnable)'''
guide = replace_once(guide, dispose_anchor, dispose_replacement, "Guide dispose clock stop")

companion_anchor = '''  companion object {'''
companion_replacement = '''  companion object {\n    private const val LIVE_CLOCK_TICK_MS = 30_000L'''
guide = replace_once(guide, companion_anchor, companion_replacement, "Guide live clock constant")

guide_path.write_text(guide, encoding="utf-8")
