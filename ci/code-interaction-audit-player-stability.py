from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")


# Keep provider-connect failure detection fast while allowing normal IPTV body/
# segment jitter. The playback-clock watchdog owns genuine decoder freezes.
patch_path = Path("frontend/patches/expo-video+3.0.16.patch")
text = patch_path.read_text(encoding="utf-8")
old_comment = "// for every VideoSource. Short socket timeouts let the buffering watchdog\n// recover a hung provider connection instead of waiting tens of seconds."
new_comment = "// for every VideoSource. Keep connect failure detection fast, but give live\n// segment/body reads enough jitter tolerance that a brief provider stall does\n// not abort an otherwise healthy long-running IPTV session. The JS playback\n// clock watchdog remains responsible for recovering a genuinely frozen decoder."
text = text.replace(old_comment, new_comment)
old_timeout = ".readTimeout(5, TimeUnit.SECONDS)"
new_timeout = ".readTimeout(30, TimeUnit.SECONDS)"
if old_timeout not in text and new_timeout not in text:
    raise SystemExit("shared OkHttp read timeout block not found")
text = text.replace(old_timeout, new_timeout)
patch_path.write_text(text, encoding="utf-8")


# Preserve Previous Channel when the channel strip changes the visible channel
# before its debounced decoder is actually committed.
player_path = Path("frontend/app/player.tsx")
player = player_path.read_text(encoding="utf-8")
old_commit = '''      const pending = pendingChannelIdRef.current;\n      channelIdRef.current = pending;\n      setChannelId(pending);'''
new_commit = '''      const pending = pendingChannelIdRef.current;\n      // Strip focus updates the visible channel before its decoder is armed.\n      // Preserve the actually tuned channel at commit time so Previous channel\n      // remains correct after a debounced strip-based zap. Next/Prev already\n      // updates this history earlier, so the equality guard keeps that path intact.\n      const previous = channelIdRef.current;\n      if (previous && previous !== pending) previousChannelIdRef.current = previous;\n      channelIdRef.current = pending;\n      setChannelId(pending);'''
player = replace_once(player, old_commit, new_commit, "player debounced commit")
player_path.write_text(player, encoding="utf-8")


# Fullscreen Media3 late-stall recovery. Two interaction defects could leave a
# stream frozen forever after it had already played successfully:
# 1) a stopped playback clock was ignored when Media3's `playing` flag dropped;
# 2) a late alternate-engine swap inherited the old stable gate, and the
#    fallback's own start timeout returned early because fallbackUsed=true.
stream_path = Path("frontend/src/components/StreamPlayer.tsx")
stream = stream_path.read_text(encoding="utf-8")
old_frozen = '''      const frozenReadyClock =\n        bufferingSince == null &&\n        hasPlayedRef.current &&\n        Boolean((player as any).playing) &&\n        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;'''
new_frozen = '''      const frozenReadyClock =\n        bufferingSince == null &&\n        hasPlayedRef.current &&\n        mediaReady &&\n        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;'''
stream = replace_once(stream, old_frozen, new_frozen, "Media3 frozen-clock gate")

old_timeout_gate = '''    const timer = setTimeout(() => {\n      if (stableRef.current || fallbackUsed) return;\n      if (!isSessionCurrent(role, sessionGeneration)) return;\n      const alternate = alternateEngine(engine, vlcAvailable);'''
new_timeout_gate = '''    const timer = setTimeout(() => {\n      if (stableRef.current) return;\n      if (!isSessionCurrent(role, sessionGeneration)) return;\n      // The one allowed alternate engine still needs a bounded startup. If it\n      // never reaches playing, surface an error so PlayerScreen can perform its\n      // full decoder remount/backoff instead of staying on a permanent spinner.\n      if (fallbackUsed) {\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");\n        setStatus("error", "start-timeout");\n        return;\n      }\n      const alternate = alternateEngine(engine, vlcAvailable);'''
stream = replace_once(stream, old_timeout_gate, new_timeout_gate, "fallback start timeout")

old_late_swap = '''        if (alternate) {\n          setFallbackUsed(true);\n          setEngine(alternate);\n          const swapReason: SessionFailReason ='''
new_late_swap = '''        if (alternate) {\n          // A post-playback failure is a new recovery attempt. Clear the stable\n          // gate before mounting the alternate or its own start timeout is\n          // suppressed by the earlier successful engine.\n          stableRef.current = false;\n          if (role === "fullscreen") setNativePlaybackStarting(true);\n          setFallbackUsed(true);\n          setEngine(alternate);\n          const swapReason: SessionFailReason ='''
stream = replace_once(stream, old_late_swap, new_late_swap, "late alternate stable reset")
stream_path.write_text(stream, encoding="utf-8")


# Normalize a migration artifact and make the native Guide own a bounded wall-
# clock redraw. advanceLiveViewport already coalesces SQLite reads (>=2 minutes),
# so a 30-second paint tick moves old blocks off-screen without creating a query
# storm. Manual horizontal browsing still disables live-follow as before.
native_guide_path = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt")
native_guide = native_guide_path.read_text(encoding="utf-8")
while "import kotlin.math.abs\nimport kotlin.math.abs\n" in native_guide:
    native_guide = native_guide.replace("import kotlin.math.abs\nimport kotlin.math.abs\n", "import kotlin.math.abs\n")
if native_guide.count("import kotlin.math.abs\n") != 1:
    raise SystemExit("NativeGuideView abs import normalization failed")

field_old = '''  private var liveFollowEnabled = true\n  private var lastLiveFollowQueryStartMs = Long.MIN_VALUE\n  private val settleSelectionRunnable = Runnable {'''
field_new = '''  private var liveFollowEnabled = true\n  private var lastLiveFollowQueryStartMs = Long.MIN_VALUE\n  private val liveClockRunnable = Runnable {\n    if (!disposed && enabled && isAttachedToWindow) {\n      invalidate()\n      scheduleLiveClock()\n    }\n  }\n  private val settleSelectionRunnable = Runnable {'''
native_guide = replace_once(native_guide, field_old, field_new, "Guide live clock field")

init_old = '''  init {\n    isFocusable = true\n    isFocusableInTouchMode = true\n    setBackgroundColor(Color.BLACK)\n  }\n\n  fun setChannels'''
init_new = '''  init {\n    isFocusable = true\n    isFocusableInTouchMode = true\n    setBackgroundColor(Color.BLACK)\n  }\n\n  private fun scheduleLiveClock() {\n    removeCallbacks(liveClockRunnable)\n    if (!disposed && enabled && isAttachedToWindow) {\n      postDelayed(liveClockRunnable, LIVE_CLOCK_TICK_MS)\n    }\n  }\n\n  private fun stopLiveClock() {\n    removeCallbacks(liveClockRunnable)\n  }\n\n  fun setChannels'''
native_guide = replace_once(native_guide, init_old, init_new, "Guide live clock helpers")

native_guide = replace_once(
    native_guide,
    '''    enabled = value\n    if (!value) {\n      removeCallbacks(settleSelectionRunnable)''',
    '''    enabled = value\n    if (!value) {\n      stopLiveClock()\n      removeCallbacks(settleSelectionRunnable)''',
    "Guide inactive clock stop",
)
native_guide = replace_once(
    native_guide,
    '''    }\n    applyPendingRestoreChannel()\n    // React may re-apply an unchanged active=true prop while Preview owns focus.''',
    '''    }\n    scheduleLiveClock()\n    applyPendingRestoreChannel()\n    // React may re-apply an unchanged active=true prop while Preview owns focus.''',
    "Guide active clock start",
)
native_guide = replace_once(
    native_guide,
    '''  override fun onDetachedFromWindow() {\n    removeCallbacks(settleSelectionRunnable)''',
    '''  override fun onDetachedFromWindow() {\n    stopLiveClock()\n    removeCallbacks(settleSelectionRunnable)''',
    "Guide detach clock stop",
)
native_guide = replace_once(
    native_guide,
    '''  override fun onAttachedToWindow() {\n    super.onAttachedToWindow()\n    applyPendingRestoreChannel()\n    loadPrograms()\n  }''',
    '''  override fun onAttachedToWindow() {\n    super.onAttachedToWindow()\n    scheduleLiveClock()\n    applyPendingRestoreChannel()\n    loadPrograms()\n  }''',
    "Guide attach clock start",
)
native_guide = replace_once(
    native_guide,
    '''  fun dispose() {\n    if (disposed) return\n    removeCallbacks(settleSelectionRunnable)''',
    '''  fun dispose() {\n    if (disposed) return\n    stopLiveClock()\n    removeCallbacks(settleSelectionRunnable)''',
    "Guide dispose clock stop",
)
native_guide = replace_once(
    native_guide,
    '''  companion object {''',
    '''  companion object {\n    private const val LIVE_CLOCK_TICK_MS = 30_000L''',
    "Guide live clock constant",
)
native_guide_path.write_text(native_guide, encoding="utf-8")


# Guide Groups owns only horizontal native boundary keys. BACK remains with the
# screen-level double-Back hierarchy, while Up/Down/OK remain Android focus keys.
activity_path = Path("frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt")
activity = activity_path.read_text(encoding="utf-8")
old_owner = '(context == "guide_groups" && boundaryKey != null)'
new_owner = '(context == "guide_groups" && (boundaryKey == "LEFT" || boundaryKey == "RIGHT"))'
activity = replace_once(activity, old_owner, new_owner, "guide groups native boundary owner")
activity_path.write_text(activity, encoding="utf-8")

groups_path = Path("frontend/src/components/PurpleGuideGroupDrawer.tsx")
groups = groups_path.read_text(encoding="utf-8")
groups = groups.replace(
    "// The groups drawer owns horizontal/back remote actions. Up/Down and OK stay",
    "// The groups drawer owns horizontal remote actions. BACK stays with the",
    1,
)
groups = groups.replace(
    "// with Android's native focus engine inside the drawer, so only one layer\n    // responds to a physical key at a time.",
    "// Guide Back hierarchy so each drawer transition keeps its deliberate\n    // double-Back gesture. Up/Down and OK stay with Android native focus.",
    1,
)
old_back = '      if (key === "LEFT" || key === "BACK") {'
new_back = '      if (key === "LEFT") {'
groups = replace_once(groups, old_back, new_back, "Guide Groups BACK ownership")
groups_path.write_text(groups, encoding="utf-8")
