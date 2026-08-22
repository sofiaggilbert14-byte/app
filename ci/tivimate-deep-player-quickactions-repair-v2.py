#!/usr/bin/env python3
from pathlib import Path
import re
import runpy

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


def sub_once(text: str, pattern: str, repl: str, label: str, flags: int = 0) -> str:
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return out


# The v1 helper has already-proven MainActivity and Quick Actions transforms, but
# its StreamPlayer cleanup was order-dependent. Reuse only those two transforms
# on an unrepaired tree, then take over the player work here with idempotent,
# source-shaped edits.
main_rel = "frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt"
qa_rel = "frontend/src/components/TvQuickActionsOverlay.tsx"
main = read(main_rel)
qa = read(qa_rel)
main_done = "selectHoldHandler" in main and "selectLongPressRunnable" in main
qa_done = "firstActionRef" in qa and "requestNativeFocus(firstActionRef.current)" in qa
if main_done != qa_done:
    raise SystemExit("deep repair ownership markers are inconsistent")
if not main_done:
    try:
        runpy.run_path(str(ROOT / "ci/tivimate-deep-player-quickactions-repair.py"), run_name="__main__")
    except SystemExit as exc:
        if str(exc) != "StreamPlayer dead clock refs still present":
            raise
    main = read(main_rel)
    qa = read(qa_rel)
    if "selectHoldHandler" not in main or "selectLongPressRunnable" not in main:
        raise SystemExit("MainActivity timed Select ownership repair did not apply")
    if "firstActionRef" not in qa or "requestNativeFocus(firstActionRef.current)" not in qa:
        raise SystemExit("Quick Actions deterministic first focus repair did not apply")


# ---------------------------------------------------------------------------
# StreamPlayer: one Media3 source reprepare per unstable episode. A brief return
# to playback must stay stable for 30s before it can re-arm another reprepare.
# This prevents nested pause/reload loops while retaining bounded failover.
# ---------------------------------------------------------------------------
sp_rel = "frontend/src/components/StreamPlayer.tsx"
sp = read(sp_rel)
if "RESYNC_REARM_STABLE_MS" not in sp:
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
        "  const lastPlaybackTimeRef = useRef(-1);\n"
        "  const lastPlaybackAdvanceAtRef = useRef(Date.now());\n"
        "  const hasAdvancedPlaybackRef = useRef(false);\n"
        "  const hasPlayedRef = useRef(false);\n"
        "  const bufferingSinceRef = useRef<number | null>(null);\n",
        "  const lastPlaybackTimeRef = useRef(-1);\n"
        "  const hasPlayedRef = useRef(false);\n"
        "  const bufferingSinceRef = useRef<number | null>(null);\n"
        "  const stableProgressSinceRef = useRef<number | null>(null);\n",
        "StreamPlayer stable episode refs",
    )

    sp = sub_once(
        sp,
        r'(setMediaReady\(false\);\n\s*hasPlayedRef\.current = false;\n)(?:\s*hasAdvancedPlaybackRef\.current = false;\n)?(\s*bufferingSinceRef\.current = null;\n)',
        r'\1\2    stableProgressSinceRef.current = null;\n',
        "StreamPlayer initial stable reset",
    )

    sp = sub_once(
        sp,
        r'if \(status === "readyToPlay"\) \{\n\s*lastPlaybackTimeRef\.current = player\.currentTime;\n(?:\s*lastPlaybackAdvanceAtRef\.current = Date\.now\(\);\n)?\s*bufferingSinceRef\.current = null;',
        'if (status === "readyToPlay") {\n'
        '        lastPlaybackTimeRef.current = player.currentTime;\n'
        '        // Startup READY is handled by the wrapper timeout. After real\n'
        '        // playback has begun, keep an existing rebuffer timestamp armed\n'
        '        // until the playback clock advances; READY-with-no-frame must\n'
        '        // never cancel freeze recovery.\n'
        '        if (!hasPlayedRef.current) bufferingSinceRef.current = null;',
        "StreamPlayer READY rebuffer ownership",
    )

    sp = replace_once(
        sp,
        "        if (hasPlayedRef.current && bufferingSinceRef.current == null) {\n"
        "          bufferingSinceRef.current = Date.now();\n"
        "        }\n",
        "        if (hasPlayedRef.current && bufferingSinceRef.current == null) {\n"
        "          bufferingSinceRef.current = Date.now();\n"
        "          stableProgressSinceRef.current = null;\n"
        "        }\n",
        "StreamPlayer loading stable reset",
    )

    sp = sub_once(
        sp,
        r'(if \(currentTime > lastPlaybackTimeRef\.current \+ 0\.05\) \{\n'
        r'\s*const firstProgress = !hasPlayedRef\.current;\n'
        r'\s*lastPlaybackTimeRef\.current = currentTime;\n'
        r'(?:\s*lastPlaybackAdvanceAtRef\.current = Date\.now\(\);\n)?'
        r'\s*hasPlayedRef\.current = true;\n'
        r'(?:\s*hasAdvancedPlaybackRef\.current = true;\n)?'
        r'(?:\s*//[^\n]*\n){0,4})'
        r'\s*silentResyncCountRef\.current = 0;\n'
        r'\s*bufferingSinceRef\.current = null;',
        r'\1        const progressNow = Date.now();\n'
        r'        if (stableProgressSinceRef.current == null) stableProgressSinceRef.current = progressNow;\n'
        r'        if (progressNow - stableProgressSinceRef.current >= RESYNC_REARM_STABLE_MS) {\n'
        r'          silentResyncCountRef.current = 0;\n'
        r'        }\n'
        r'        bufferingSinceRef.current = null;',
        "StreamPlayer timeUpdate stable rearm",
    )

    sp = sub_once(
        sp,
        r'(if \(Number\.isFinite\(observedPlaybackTime\) && observedPlaybackTime > lastPlaybackTimeRef\.current \+ 0\.05\) \{\n'
        r'\s*lastPlaybackTimeRef\.current = observedPlaybackTime;\n)'
        r'(?:\s*lastPlaybackAdvanceAtRef\.current = now;\n)?'
        r'(?:\s*hasAdvancedPlaybackRef\.current = true;\n)?'
        r'\s*silentResyncCountRef\.current = 0;\n'
        r'\s*bufferingSinceRef\.current = null;',
        r'\1        if (stableProgressSinceRef.current == null) stableProgressSinceRef.current = now;\n'
        r'        if (now - stableProgressSinceRef.current >= RESYNC_REARM_STABLE_MS) {\n'
        r'          silentResyncCountRef.current = 0;\n'
        r'        }\n'
        r'        bufferingSinceRef.current = null;',
        "StreamPlayer watchdog stable rearm",
    )

    sp = sub_once(
        sp,
        r'(silentResyncCountRef\.current \+= 1;\n\s*silentResyncInFlightRef\.current = true;\n)'
        r'(?:\s*//[^\n]*\n){0,4}'
        r'(?:\s*hasAdvancedPlaybackRef\.current = false;\n)?'
        r'(?:\s*lastPlaybackAdvanceAtRef\.current = Date\.now\(\);\n)?'
        r'\s*bufferingSinceRef\.current = Date\.now\(\);',
        r'\1        // One reprepare owns this unstable episode. A brief frame/clock\n'
        r'        // recovery cannot immediately buy another source reload.\n'
        r'        stableProgressSinceRef.current = null;\n'
        r'        bufferingSinceRef.current = Date.now();',
        "StreamPlayer silent resync ownership",
    )

    # Any remaining references are obsolete bookkeeping from the old frozen-clock
    # path. Remove the assignment lines only after semantic replacements above.
    sp = re.sub(r'^\s*lastPlaybackAdvanceAtRef\.current = (?:Date\.now\(\)|now);\n', '', sp, flags=re.MULTILINE)
    sp = re.sub(r'^\s*hasAdvancedPlaybackRef\.current = (?:true|false);\n', '', sp, flags=re.MULTILINE)
    if "lastPlaybackAdvanceAtRef" in sp or "hasAdvancedPlaybackRef" in sp:
        raise SystemExit("StreamPlayer obsolete clock refs remain after v2 repair")
    write(sp_rel, sp)
else:
    required = [
        "const BUFFERING_FAIL_MS = 12_000;",
        "const RESYNC_REARM_STABLE_MS = 30_000;",
        "const VLC_FROZEN_PROGRESS_MS = 8_000;",
        "const VLC_BUFFERING_FAIL_MS = 12_000;",
        "stableProgressSinceRef",
    ]
    for token in required:
        if token not in sp:
            raise SystemExit(f"StreamPlayer partial deep repair: missing {token}")
    if "lastPlaybackAdvanceAtRef" in sp or "hasAdvancedPlaybackRef" in sp:
        raise SystemExit("StreamPlayer repaired constants but obsolete clock refs remain")


# ---------------------------------------------------------------------------
# PlayerScreen: one outer retry budget (1s/2s/4s). Do not reset that budget on a
# transient PLAYING blip; require 30 seconds of stable playback on the same
# channel before another three-attempt recovery sequence can be earned.
# ---------------------------------------------------------------------------
player_rel = "frontend/app/player.tsx"
player = read(player_rel)
if "STABLE_RETRY_RESET_MS" not in player:
    player = replace_once(
        player,
        "const STREAM_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;\n"
        "const MAX_AUTO_STREAM_RETRIES = 4;\n"
        "const SWITCH_NOTICE_MS = 1800;\n"
        "const STABLE_HISTORY_DELAY_MS = 5000;\n",
        "const STREAM_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;\n"
        "const MAX_AUTO_STREAM_RETRIES = 3;\n"
        "const STABLE_RETRY_RESET_MS = 30_000;\n"
        "const SWITCH_NOTICE_MS = 1800;\n"
        "const STABLE_HISTORY_DELAY_MS = 5000;\n",
        "Player retry constants",
    )
    player = replace_once(
        player,
        "  const stableHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n",
        "  const stableHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n"
        "  const stableRetryResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n",
        "Player stable retry timer ref",
    )
    player = replace_once(
        player,
        "      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);\n"
        "    };\n"
        "    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional cold-mount/retry only\n",
        "      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);\n"
        "      if (stableRetryResetTimer.current) clearTimeout(stableRetryResetTimer.current);\n"
        "    };\n"
        "    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional cold-mount/retry only\n",
        "Player timer teardown",
    )
    old_playing = '''  useEffect(() => {
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
    new_playing = '''  useEffect(() => {
    if (status === "playing") {
      if (controlsRef.current) scheduleHide();
      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
      if (stableRetryResetTimer.current) clearTimeout(stableRetryResetTimer.current);
      const stableChannelId = channelIdRef.current;
      stableRetryResetTimer.current = setTimeout(() => {
        if (channelIdRef.current !== stableChannelId) return;
        setRetryAttempt(0);
      }, STABLE_RETRY_RESET_MS);
      stableHistoryTimer.current = setTimeout(() => {
        if (channelIdRef.current !== stableChannelId) return;
        const stableChannel = channelById(stableChannelId);
        if (stableChannel) addRecent(stableChannel);
      }, STABLE_HISTORY_DELAY_MS);
      return () => {
        if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
        if (stableRetryResetTimer.current) clearTimeout(stableRetryResetTimer.current);
      };
    }
  }, [addRecent, channelById, scheduleHide, status]);
'''
    player = replace_once(player, old_playing, new_playing, "Player stable retry reset effect")
    write(player_rel, player)
else:
    for token in [
        "const MAX_AUTO_STREAM_RETRIES = 3;",
        "const STABLE_RETRY_RESET_MS = 30_000;",
        "stableRetryResetTimer",
    ]:
        if token not in player:
            raise SystemExit(f"Player partial deep repair: missing {token}")


# ---------------------------------------------------------------------------
# Native Media3 network failover: keep pooled connections but fail dead reads and
# writes quickly enough for the single recovery owner to act.
# ---------------------------------------------------------------------------
patch_rel = "frontend/patches/expo-video+3.0.16.patch"
patch = read(patch_rel)
if ".readTimeout(30, TimeUnit.SECONDS)" in patch:
    patch = replace_once(
        patch,
        "+    .readTimeout(30, TimeUnit.SECONDS)\n+    .writeTimeout(15, TimeUnit.SECONDS)\n",
        "+    .readTimeout(5, TimeUnit.SECONDS)\n+    .writeTimeout(5, TimeUnit.SECONDS)\n",
        "Media3 socket failover timeouts",
    )
    write(patch_rel, patch)
elif ".readTimeout(5, TimeUnit.SECONDS)" not in patch or ".writeTimeout(5, TimeUnit.SECONDS)" not in patch:
    raise SystemExit("Media3 network timeout repair is partial")

print("TiViMate deep player + Quick Actions v2 repair applied/verified")
