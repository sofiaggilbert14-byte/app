#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1) Window-level remote ownership: classify short vs long OK with a timer.
#    This does not depend on repeatCount, which is unreliable on Fire TV remotes.
# ---------------------------------------------------------------------------
main_rel = "frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt"
main = read(main_rel)
main = replace_once(
    main,
    "import android.os.Build\nimport android.os.Bundle\nimport android.view.WindowManager\n",
    "import android.os.Build\nimport android.os.Bundle\nimport android.os.Handler\nimport android.os.Looper\nimport android.view.ViewConfiguration\nimport android.view.WindowManager\n",
    "MainActivity imports",
)
main = replace_once(
    main,
    "  private var lastAcceptedDirectionalRepeatAt = 0L\n  private var lastAcceptedDirectionalKeyCode = -1\n  private var emittedLongPressKeyCode = -1\n",
    "  private var lastAcceptedDirectionalRepeatAt = 0L\n"
    "  private var lastAcceptedDirectionalKeyCode = -1\n"
    "  private var emittedLongPressKeyCode = -1\n"
    "  private val selectHoldHandler = Handler(Looper.getMainLooper())\n"
    "  private var selectHoldKeyCode = -1\n"
    "  private var selectHoldContext: String? = null\n"
    "  private var selectLongTriggered = false\n"
    "  private val selectLongPressRunnable = Runnable {\n"
    "    val owner = selectHoldContext\n"
    "    if (\n"
    "      selectHoldKeyCode != -1 &&\n"
    "        !selectLongTriggered &&\n"
    "        (owner == \"guide\" || owner == \"player\") &&\n"
    "        TvRemoteModule.remoteContext == owner\n"
    "    ) {\n"
    "      selectLongTriggered = true\n"
    "      emitRemoteEvent(\"TvRemoteQuickActions\", owner)\n"
    "    }\n"
    "  }\n",
    "MainActivity select hold fields",
)

start = main.find("    // One semantic long-press event per physical hold.")
end = main.find("    // Phase 9 remote ownership.", start)
if start < 0 or end < 0 or end <= start:
    raise SystemExit("MainActivity long-press block not found")
new_router = '''    // TiViMate-style window action router: classify OK/Select once per physical
    // hold at the Activity boundary. Fire TV remotes do not all emit repeatCount
    // events, so repeat-based long-press detection can fall through as a short
    // Guide click and open ProgramModal/Watch Now underneath Quick Actions.
    val selectKey =
      event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER ||
        event.keyCode == android.view.KeyEvent.KEYCODE_ENTER ||
        event.keyCode == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER ||
        event.keyCode == android.view.KeyEvent.KEYCODE_BUTTON_A
    if (selectKey && !TvRemoteModule.pointerActive) {
      val context = TvRemoteModule.remoteContext
      if (
        event.action == android.view.KeyEvent.ACTION_DOWN &&
          selectHoldKeyCode == -1 &&
          (context == "guide" || context == "player")
      ) {
        selectHoldKeyCode = event.keyCode
        selectHoldContext = context
        selectLongTriggered = false
        selectHoldHandler.removeCallbacks(selectLongPressRunnable)
        selectHoldHandler.postDelayed(
          selectLongPressRunnable,
          ViewConfiguration.getLongPressTimeout().toLong(),
        )
        // Do not let the child view see the initial DOWN until the hold is
        // classified. That is what prevents Watch Now / normal click bleed.
        return true
      }
      if (selectHoldKeyCode == event.keyCode) {
        if (event.action == android.view.KeyEvent.ACTION_DOWN) {
          // Consume vendor repeat events too; the timer is the sole classifier.
          return true
        }
        if (event.action == android.view.KeyEvent.ACTION_UP) {
          selectHoldHandler.removeCallbacks(selectLongPressRunnable)
          val owner = selectHoldContext
          val wasLong = selectLongTriggered
          selectHoldKeyCode = -1
          selectHoldContext = null
          selectLongTriggered = false
          if (wasLong) return true
          // A route/modal transition during the hold owns the release. Never
          // replay a short click into a different surface.
          if (owner == null || TvRemoteModule.remoteContext != owner) return true

          if (owner == "player") emitRemoteEvent("TvRemoteKey", "SELECT")

          // Re-inject one clean short click below this Activity override. Guide
          // gets a normal NativeGuideView DOWN/UP pair; Player controls retain
          // normal Android Pressable activation while JS gets one semantic key.
          val down = android.view.KeyEvent(
            event.downTime,
            event.eventTime,
            android.view.KeyEvent.ACTION_DOWN,
            event.keyCode,
            0,
            event.metaState,
            event.deviceId,
            event.scanCode,
            event.flags,
            event.source,
          )
          val up = android.view.KeyEvent(
            event.downTime,
            event.eventTime,
            android.view.KeyEvent.ACTION_UP,
            event.keyCode,
            0,
            event.metaState,
            event.deviceId,
            event.scanCode,
            event.flags,
            event.source,
          )
          super.dispatchKeyEvent(down)
          super.dispatchKeyEvent(up)
          return true
        }
      }
    }

    // Generic long Down/Back remains repeat-driven because those actions are
    // repeat/navigation semantics, not click-vs-hold classification.
    if (
      event.action == android.view.KeyEvent.ACTION_DOWN &&
        event.repeatCount > 0 &&
        emittedLongPressKeyCode != event.keyCode
    ) {
      val longKey = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"
        android.view.KeyEvent.KEYCODE_BACK -> "BACK"
        else -> null
      }
      if (longKey != null) {
        emittedLongPressKeyCode = event.keyCode
        emitRemoteEvent("TvRemoteLongPress", longKey)
      }
    } else if (
      event.action == android.view.KeyEvent.ACTION_UP &&
        event.keyCode == emittedLongPressKeyCode
    ) {
      emittedLongPressKeyCode = -1
    }

'''
main = main[:start] + new_router + main[end:]
main = replace_once(
    main,
    "  override fun onDestroy() {\n    // Static remote flags must never survive an Activity/bridge teardown.\n",
    "  override fun onDestroy() {\n"
    "    selectHoldHandler.removeCallbacks(selectLongPressRunnable)\n"
    "    selectHoldKeyCode = -1\n"
    "    selectHoldContext = null\n"
    "    selectLongTriggered = false\n"
    "    // Static remote flags must never survive an Activity/bridge teardown.\n",
    "MainActivity destroy select cleanup",
)
write(main_rel, main)

# ---------------------------------------------------------------------------
# 2) Quick Actions: deterministic first focus after the modal owns the window.
# ---------------------------------------------------------------------------
qa_rel = "frontend/src/components/TvQuickActionsOverlay.tsx"
qa = read(qa_rel)
qa = replace_once(
    qa,
    'import { FocusGuide } from "@/src/components/TVFocusGuideView";\n',
    'import { FocusGuide } from "@/src/components/TVFocusGuideView";\nimport { requestNativeFocus } from "@/src/utils/tvFocus";\n',
    "QuickActions focus import",
)
qa = replace_once(
    qa,
    "  const queryGeneration = useRef(0);\n  const openPathRef = useRef<string | null>(null);\n",
    "  const queryGeneration = useRef(0);\n"
    "  const openPathRef = useRef<string | null>(null);\n"
    "  const firstActionRef = useRef<any>(null);\n",
    "QuickActions first action ref",
)
qa = replace_once(
    qa,
    "  useEffect(() => {\n    if (!open) return;\n    setFocusClaim(false);\n    const frame = requestAnimationFrame(() => setFocusClaim(true));\n    return () => cancelAnimationFrame(frame);\n  }, [open, mode, sourceChoice?.id]);\n",
    "  useEffect(() => {\n"
    "    if (!open) return;\n"
    "    setFocusClaim(false);\n"
    "    let focusFrame: number | null = null;\n"
    "    const frame = requestAnimationFrame(() => {\n"
    "      setFocusClaim(true);\n"
    "      if (mode === \"main\") {\n"
    "        focusFrame = requestAnimationFrame(() => requestNativeFocus(firstActionRef.current));\n"
    "      }\n"
    "    });\n"
    "    return () => {\n"
    "      cancelAnimationFrame(frame);\n"
    "      if (focusFrame != null) cancelAnimationFrame(focusFrame);\n"
    "    };\n"
    "  }, [open, mode, sourceChoice?.id]);\n",
    "QuickActions focus claim",
)
qa = replace_once(
    qa,
    '<Action preferredFocus={focusClaim} icon="play" label="Watch channel now" value={guideProgram.title} onPress={watchSelectedProgram} />',
    '<Action buttonRef={firstActionRef} preferredFocus={focusClaim} icon="play" label="Watch channel now" value={guideProgram.title} onPress={watchSelectedProgram} />',
    "QuickActions program first action",
)
qa = replace_once(
    qa,
    '<Action preferredFocus={focusClaim} icon={context === "guide" ? "play" : "heart-outline"} label={context === "guide" ? "Play channel" : (favoriteSet.has(channel.id) ? "Remove Favorite" : "Add Favorite")} onPress={context === "guide" ? play : favorite} />',
    '<Action buttonRef={firstActionRef} preferredFocus={focusClaim} icon={context === "guide" ? "play" : "heart-outline"} label={context === "guide" ? "Play channel" : (favoriteSet.has(channel.id) ? "Remove Favorite" : "Add Favorite")} onPress={context === "guide" ? play : favorite} />',
    "QuickActions channel first action",
)
qa = replace_once(
    qa,
    "function Action({\n  icon,\n  label,\n  value,\n  onPress,\n  disabled = false,\n  preferredFocus = false,\n}: {\n",
    "function Action({\n"
    "  icon,\n"
    "  label,\n"
    "  value,\n"
    "  onPress,\n"
    "  disabled = false,\n"
    "  preferredFocus = false,\n"
    "  buttonRef,\n"
    "}: {\n",
    "QuickActions Action parameters",
)
qa = replace_once(
    qa,
    "  disabled?: boolean;\n  preferredFocus?: boolean;\n}) {\n  return (\n    <Pressable\n      disabled={disabled}\n",
    "  disabled?: boolean;\n"
    "  preferredFocus?: boolean;\n"
    "  buttonRef?: React.Ref<any>;\n"
    "}) {\n"
    "  return (\n"
    "    <Pressable\n"
    "      ref={buttonRef}\n"
    "      disabled={disabled}\n",
    "QuickActions Action ref prop",
)
write(qa_rel, qa)

# ---------------------------------------------------------------------------
# 3) Player recovery: one silent resync per unstable episode, first-frame-after-
#    rebuffer stays armed, dead freeze-era clock variables removed.
# ---------------------------------------------------------------------------
sp_rel = "frontend/src/components/StreamPlayer.tsx"
sp = read(sp_rel)
sp = replace_once(
    sp,
    "const BUFFERING_RESYNC_MS = 5000;\nconst BUFFERING_FAIL_MS = 22000;\nconst MAX_SILENT_BUFFERING_RESYNCS = 1;\nconst VLC_FROZEN_PROGRESS_MS = 15_000;\nconst VLC_BUFFERING_FAIL_MS = 22_000;\n",
    "const BUFFERING_RESYNC_MS = 5000;\n"
    "const BUFFERING_FAIL_MS = 12_000;\n"
    "const MAX_SILENT_BUFFERING_RESYNCS = 1;\n"
    "const RESYNC_REARM_STABLE_MS = 30_000;\n"
    "const VLC_FROZEN_PROGRESS_MS = 8_000;\n"
    "const VLC_BUFFERING_FAIL_MS = 12_000;\n",
    "StreamPlayer recovery constants",
)
sp = replace_once(
    sp,
    "  const lastPlaybackTimeRef = useRef(-1);\n  const lastPlaybackAdvanceAtRef = useRef(Date.now());\n  const hasAdvancedPlaybackRef = useRef(false);\n  const hasPlayedRef = useRef(false);\n  const bufferingSinceRef = useRef<number | null>(null);\n",
    "  const lastPlaybackTimeRef = useRef(-1);\n"
    "  const hasPlayedRef = useRef(false);\n"
    "  const bufferingSinceRef = useRef<number | null>(null);\n"
    "  const stableProgressSinceRef = useRef<number | null>(null);\n",
    "StreamPlayer remove dead clock refs",
)
sp = sp.replace("    hasAdvancedPlaybackRef.current = false;\n", "")
sp = sp.replace("        lastPlaybackAdvanceAtRef.current = Date.now();\n", "")
sp = sp.replace("        hasAdvancedPlaybackRef.current = true;\n", "")
sp = sp.replace("        lastPlaybackAdvanceAtRef.current = now;\n", "")
if "lastPlaybackAdvanceAtRef" in sp or "hasAdvancedPlaybackRef" in sp:
    raise SystemExit("StreamPlayer dead clock refs still present")
sp = replace_once(
    sp,
    "    hasPlayedRef.current = false;\n    bufferingSinceRef.current = null;\n    silentResyncCountRef.current = 0;\n",
    "    hasPlayedRef.current = false;\n"
    "    bufferingSinceRef.current = null;\n"
    "    stableProgressSinceRef.current = null;\n"
    "    silentResyncCountRef.current = 0;\n",
    "StreamPlayer initial stable reset",
)
sp = replace_once(
    sp,
    "      if (status === \"readyToPlay\") {\n        lastPlaybackTimeRef.current = player.currentTime;\n        bufferingSinceRef.current = null;\n",
    "      if (status === \"readyToPlay\") {\n"
    "        lastPlaybackTimeRef.current = player.currentTime;\n"
    "        // Startup READY is handled by the wrapper timeout. After real\n"
    "        // playback has begun, however, keep an existing rebuffer timestamp\n"
    "        // armed until the playback clock advances. READY-with-no-frame is\n"
    "        // a real TiViMate freeze condition and must not cancel recovery.\n"
    "        if (!hasPlayedRef.current) bufferingSinceRef.current = null;\n",
    "StreamPlayer ready rebuffer ownership",
)
sp = replace_once(
    sp,
    "        if (hasPlayedRef.current && bufferingSinceRef.current == null) {\n          bufferingSinceRef.current = Date.now();\n        }\n",
    "        if (hasPlayedRef.current && bufferingSinceRef.current == null) {\n"
    "          bufferingSinceRef.current = Date.now();\n"
    "          stableProgressSinceRef.current = null;\n"
    "        }\n",
    "StreamPlayer loading resets stable window",
)
old_progress = '''      if (currentTime > lastPlaybackTimeRef.current + 0.05) {
        const firstProgress = !hasPlayedRef.current;
        lastPlaybackTimeRef.current = currentTime;
        hasPlayedRef.current = true;
        // Real clock progress proves startup/recovery succeeded. Only now reset
        // the bounded recovery budget and publish stable playback to the parent.
        silentResyncCountRef.current = 0;
        bufferingSinceRef.current = null;
        if (firstProgress && isSessionCurrent(sessionRole, sessionGeneration)) {
          recordStablePlayback(sessionRole, engine, uri);
          emit("playing");
        }
      }
'''
new_progress = '''      if (currentTime > lastPlaybackTimeRef.current + 0.05) {
        const firstProgress = !hasPlayedRef.current;
        const now = Date.now();
        lastPlaybackTimeRef.current = currentTime;
        hasPlayedRef.current = true;
        if (stableProgressSinceRef.current == null) stableProgressSinceRef.current = now;
        if (
          silentResyncCountRef.current > 0 &&
          now - stableProgressSinceRef.current >= RESYNC_REARM_STABLE_MS
        ) {
          // A brief return to PLAYING must not immediately re-arm another source
          // replacement. Require sustained clean playback before forgiveness.
          silentResyncCountRef.current = 0;
          stableProgressSinceRef.current = now;
        }
        bufferingSinceRef.current = null;
        if (firstProgress && isSessionCurrent(sessionRole, sessionGeneration)) {
          recordStablePlayback(sessionRole, engine, uri);
          emit("playing");
        }
      }
'''
sp = replace_once(sp, old_progress, new_progress, "StreamPlayer timeUpdate recovery budget")
old_poll = '''      if (Number.isFinite(observedPlaybackTime) && observedPlaybackTime > lastPlaybackTimeRef.current + 0.05) {
        lastPlaybackTimeRef.current = observedPlaybackTime;
        silentResyncCountRef.current = 0;
        bufferingSinceRef.current = null;
      }
'''
new_poll = '''      if (Number.isFinite(observedPlaybackTime) && observedPlaybackTime > lastPlaybackTimeRef.current + 0.05) {
        lastPlaybackTimeRef.current = observedPlaybackTime;
        if (stableProgressSinceRef.current == null) stableProgressSinceRef.current = now;
        if (
          silentResyncCountRef.current > 0 &&
          now - stableProgressSinceRef.current >= RESYNC_REARM_STABLE_MS
        ) {
          silentResyncCountRef.current = 0;
          stableProgressSinceRef.current = now;
        }
        bufferingSinceRef.current = null;
      }
'''
sp = replace_once(sp, old_poll, new_poll, "StreamPlayer watchdog recovery budget")
sp = replace_once(
    sp,
    "        // Re-arm only after the replacement clock advances; otherwise a frozen\n        // readyToPlay state would immediately retrigger before Media3 settles.\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        bufferingSinceRef.current = Date.now();\n",
    "        // A silent resync starts a new unstable episode. Do not forgive it\n"
    "        // until RESYNC_REARM_STABLE_MS of real clock progress has elapsed.\n"
    "        stableProgressSinceRef.current = null;\n"
    "        bufferingSinceRef.current = Date.now();\n",
    "StreamPlayer silent resync stable gate",
)
write(sp_rel, sp)

# ---------------------------------------------------------------------------
# 4) Outer fullscreen retries: exactly 1s/2s/4s; brief PLAYING no longer resets
#    the attempt budget and creates an endless remount loop.
# ---------------------------------------------------------------------------
player_rel = "frontend/app/player.tsx"
player = read(player_rel)
player = replace_once(
    player,
    "const STREAM_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;\nconst MAX_AUTO_STREAM_RETRIES = 4;\nconst SWITCH_NOTICE_MS = 1800;\nconst STABLE_HISTORY_DELAY_MS = 5000;\n",
    "const STREAM_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;\n"
    "const MAX_AUTO_STREAM_RETRIES = 3;\n"
    "const STABLE_RETRY_RESET_MS = 30_000;\n"
    "const SWITCH_NOTICE_MS = 1800;\n"
    "const STABLE_HISTORY_DELAY_MS = 5000;\n",
    "Player retry constants",
)
player = replace_once(
    player,
    "  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n  const stableHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n",
    "  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n"
    "  const stableHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n"
    "  const stableRetryResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n",
    "Player stable retry timer ref",
)
player = replace_once(
    player,
    "      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);\n    };\n",
    "      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);\n"
    "      if (stableRetryResetTimer.current) clearTimeout(stableRetryResetTimer.current);\n"
    "    };\n",
    "Player cold mount cleanup",
)
old_playing_effect = '''  useEffect(() => {
    if (status === "playing") {
      setRetryAttempt(0);
      if (controlsRef.current) scheduleHide();
      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
      const stableChannelId = channelIdRef.current;
      stableHistoryTimer.current = setTimeout(() => {
        if (status !== "playing" || channelIdRef.current !== stableChannelId) return;
        const stableChannel = channelById(stableChannelId);
        if (stableChannel) addRecent(stableChannel);
      }, STABLE_HISTORY_DELAY_MS);
      return () => {
        if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
      };
    }
  }, [addRecent, channelById, scheduleHide, status]);
'''
new_playing_effect = '''  useEffect(() => {
    if (status === "playing") {
      if (controlsRef.current) scheduleHide();
      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
      if (stableRetryResetTimer.current) clearTimeout(stableRetryResetTimer.current);
      const stableChannelId = channelIdRef.current;
      stableHistoryTimer.current = setTimeout(() => {
        if (channelIdRef.current !== stableChannelId) return;
        const stableChannel = channelById(stableChannelId);
        if (stableChannel) addRecent(stableChannel);
      }, STABLE_HISTORY_DELAY_MS);
      stableRetryResetTimer.current = setTimeout(() => {
        if (channelIdRef.current !== stableChannelId) return;
        setRetryAttempt(0);
      }, STABLE_RETRY_RESET_MS);
      return () => {
        if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
        if (stableRetryResetTimer.current) clearTimeout(stableRetryResetTimer.current);
      };
    }
  }, [addRecent, channelById, scheduleHide, status]);
'''
player = replace_once(player, old_playing_effect, new_playing_effect, "Player stable retry reset effect")
write(player_rel, player)

# ---------------------------------------------------------------------------
# 5) Native Media3 network fast-fail: match TiViMate-style 5s socket timeouts.
# ---------------------------------------------------------------------------
patch_rel = "frontend/patches/expo-video+3.0.16.patch"
patch = read(patch_rel)
patch = replace_once(
    patch,
    "+    .connectTimeout(5, TimeUnit.SECONDS)\n+    .readTimeout(30, TimeUnit.SECONDS)\n+    .writeTimeout(15, TimeUnit.SECONDS)\n",
    "+    .connectTimeout(5, TimeUnit.SECONDS)\n"
    "+    .readTimeout(5, TimeUnit.SECONDS)\n"
    "+    .writeTimeout(5, TimeUnit.SECONDS)\n",
    "expo-video OkHttp fast fail",
)
write(patch_rel, patch)

print("TiViMate deep player/Quick Actions repair applied")
