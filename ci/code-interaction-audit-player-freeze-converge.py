from pathlib import Path

ROOT = Path("frontend")
stream_path = ROOT / "src/components/StreamPlayer.tsx"
player_path = ROOT / "app/player.tsx"
focus_test_path = ROOT / "tests/playerAndFocus.test.mjs"
live_test_path = ROOT / "tests/playerLiveStability.test.mjs"
preview_scan_path = Path("ci/code-interaction-audit-preview-lifecycle-scan.py")
lifecycle_scan_path = Path("ci/code-interaction-audit-lifecycle-scan.py")
freeze_scan_path = Path("ci/code-interaction-audit-player-freeze-scan.py")
bleed_repair_path = Path("ci/code-interaction-audit-player-freeze-bleed-repair.py")

stream = stream_path.read_text(encoding="utf-8")
player = player_path.read_text(encoding="utf-8")
focus_test = focus_test_path.read_text(encoding="utf-8")
live_test = live_test_path.read_text(encoding="utf-8")
preview_scan = preview_scan_path.read_text(encoding="utf-8")
lifecycle_scan = lifecycle_scan_path.read_text(encoding="utf-8")
freeze_scan = freeze_scan_path.read_text(encoding="utf-8")
bleed_repair = bleed_repair_path.read_text(encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# Keep only one in-engine reprepare. The deeper bleed repair has already made
# this budget conditional on a real post-playback buffering state, never clock
# silence. One native reprepare is enough before the outer owner handles fallback.
stream = replace_once(
    stream,
    "const MAX_SILENT_BUFFERING_RESYNCS = 2;",
    "const MAX_SILENT_BUFFERING_RESYNCS = 1;",
    "bound explicit Media3 reprepare budget",
)

# Release LibVLC before publishing a terminal failure so an exhausted retry cannot
# leave a frozen decoder/native surface resident.
stream = replace_once(
    stream,
'''  const fail = useCallback(() => {\n    if (tearingDownRef.current || !activeRef.current) return;\n    if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n    recordFailure(sessionRole, engine, uri, "stream-error");\n    if (isCircuitOpen(sessionRole, engine, uri)) {\n      // Stop LibVLC before unmounting the native view — otherwise blocked→null\n      // leaks a running decoder until a later remount.\n      hardStop();\n      setBlocked(true);\n      emit("loading", "circuit-open");\n    } else {\n      emit("error", "stream-error");\n    }\n  }, [emit, engine, hardStop, sessionGeneration, sessionRole, setBlocked, uri]);''',
'''  const fail = useCallback(() => {\n    if (tearingDownRef.current || !activeRef.current) return;\n    if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n    hardStop();\n    recordFailure(sessionRole, engine, uri, "stream-error");\n    if (isCircuitOpen(sessionRole, engine, uri)) {\n      setBlocked(true);\n      emit("loading", "circuit-open");\n    } else {\n      emit("error", "stream-error");\n    }\n  }, [emit, engine, hardStop, sessionGeneration, sessionRole, setBlocked, uri]);''',
    "release VLC before failure publication",
)

# Media3 native errors and exhausted explicit-buffering recovery follow the same
# release-before-error contract.
stream = replace_once(
    stream,
'''      } else if (error || status === "error") {\n        recordFailure(sessionRole, engine, uri, "stream-error");''',
'''      } else if (error || status === "error") {\n        hardStop();\n        recordFailure(sessionRole, engine, uri, "stream-error");''',
    "release Media3 on native error",
)
stream = replace_once(
    stream,
'''  }, [blocked, emit, engine, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, setBlocked, uri]);''',
'''  }, [blocked, emit, engine, hardStop, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, setBlocked, uri]);''',
    "Media3 error hardStop dependency",
)
stream = replace_once(
    stream,
'''      if (bufferingFor < BUFFERING_FAIL_MS) return;\n      bufferingSinceRef.current = null;\n      recordFailure(sessionRole, engine, uri, "stream-error");\n      emit("error", "stream-error");''',
'''      if (bufferingFor < BUFFERING_FAIL_MS) return;\n      bufferingSinceRef.current = null;\n      hardStop();\n      recordFailure(sessionRole, engine, uri, "stream-error");\n      emit("error", "stream-error");''',
    "release Media3 after explicit buffering budget",
)
stream = replace_once(
    stream,
'''  }, [blocked, emit, engine, headers, kind, mediaReady, mode, paused, player, sessionGeneration, sessionRole, uri]);''',
'''  }, [blocked, emit, engine, hardStop, headers, kind, mediaReady, mode, paused, player, sessionGeneration, sessionRole, uri]);''',
    "Media3 watchdog hardStop dependency",
)

# Silent-audio Media3 -> VLC is also a decoder handoff. Release first.
stream = replace_once(
    stream,
'''      if (sawSupportedAudio) return;\n      recordAudioDiagnostics({''',
'''      if (sawSupportedAudio) return;\n      hardStop();\n      recordAudioDiagnostics({''',
    "release Media3 before silent-audio handoff",
)
stream = replace_once(
    stream,
'''  }, [blocked, emit, kind, mediaReady, mode, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, uri]);''',
'''  }, [blocked, emit, hardStop, kind, mediaReady, mode, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, uri]);''',
    "silent-audio hardStop dependency",
)

# Forced engine settings are ownership contracts. Startup timeout may not silently
# switch to the opposite engine; terminal timeout releases the current decoder.
stream = replace_once(
    stream,
'''      if (fallbackUsed) {\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");\n        setStatus("error", "start-timeout");\n        return;\n      }\n      const alternate = alternateEngine(engine, vlcAvailable);''',
'''      if (fallbackUsed || forceVlc || forceMedia3) {\n        pauseSessionDecoders(role);\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");\n        setStatus("error", "start-timeout");\n        return;\n      }\n      const alternate = alternateEngine(engine, vlcAvailable);''',
    "honor forced engine on startup timeout",
)
stream = replace_once(
    stream,
'''      if (!alternate) {\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");''',
'''      if (!alternate) {\n        pauseSessionDecoders(role);\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");''',
    "release terminal startup timeout decoder",
)
stream = replace_once(
    stream,
'''  }, [engine, fallbackUsed, playbackFocused, role, sessionGeneration, setStatus, startTimeoutMs, uri]);''',
'''  }, [engine, fallbackUsed, forceMedia3, forceVlc, playbackFocused, role, sessionGeneration, setStatus, startTimeoutMs, uri]);''',
    "startup timeout preference dependencies",
)
stream = replace_once(
    stream,
'''  beginSession,\n  isSessionCurrent,''',
'''  beginSession,\n  isSessionCurrent,\n  pauseSessionDecoders,''',
    "import role-scoped decoder pause",
)

# Fullscreen intent is explicit and cannot inherit a route-sensitive default.
player = replace_once(
    player,
    'sessionRole="fullscreen"',
    'mode="full"\n          sessionRole="fullscreen"',
    "explicit fullscreen StreamPlayer mode",
)

# Tests produced by the bleed repair must converge on one explicit-buffering
# reprepare, not the older two-attempt budget.
focus_test = focus_test.replace("MAX_SILENT_BUFFERING_RESYNCS = 2", "MAX_SILENT_BUFFERING_RESYNCS = 1")
live_test = live_test.replace("MAX_SILENT_BUFFERING_RESYNCS = 2", "MAX_SILENT_BUFFERING_RESYNCS = 1")

# Preview lifecycle scan: explicit buffering only, one bounded reprepare, and no
# clock-only reload sentinel.
preview_scan = preview_scan.replace(
    '    "const MEDIA3_FROZEN_CLOCK_MS = 9000",\n',
    '    "if (bufferingSince == null) return;",\n',
)
preview_scan = preview_scan.replace("MAX_SILENT_BUFFERING_RESYNCS = 2", "MAX_SILENT_BUFFERING_RESYNCS = 1")
needle = '# Preview memory/network footprint stays below fullscreen and muted audio cannot\n'
insert = '''if "MEDIA3_FROZEN_CLOCK_MS" in stream or "const frozenReadyClock =" in stream:\n    critical.append("Media3 clock-silence-only decoder reload is enabled")\n\n'''
if insert not in preview_scan:
    if needle not in preview_scan:
        raise SystemExit("preview lifecycle insertion anchor missing")
    preview_scan = preview_scan.replace(needle, insert + needle, 1)

# Whole-app lifecycle scan must enforce the same player contract.
old_lifecycle = '''if 'const MEDIA3_FROZEN_CLOCK_MS = 9000' not in stream or 'MAX_SILENT_BUFFERING_RESYNCS = 2' not in stream:\n    critical.append("Media3 frozen-clock watchdog/resync budget missing")'''
new_lifecycle = '''if 'if (bufferingSince == null) return;' not in stream or 'MAX_SILENT_BUFFERING_RESYNCS = 1' not in stream:\n    critical.append("Media3 explicit-buffering watchdog/resync budget missing")\nif "MEDIA3_FROZEN_CLOCK_MS" in stream or "const frozenReadyClock =" in stream:\n    critical.append("Media3 clock-silence-only decoder reload is enabled")'''
lifecycle_scan = replace_once(lifecycle_scan, old_lifecycle, new_lifecycle, "whole-app Media3 lifecycle contract")

# Repo-wide freeze scanner: explicitly prove there is no clock-only source reload.
freeze_anchor = '# One in-engine Media3 resync only. Outer PlayerScreen owns subsequent remounts.\n'
freeze_insert = '''# Live IPTV clock silence is not proof of a frozen decoder. Only an explicit\n# post-playback loading/buffering state may arm source replacement.\nif 'if (bufferingSince == null) return;' not in stream:\n    critical.append("Media3 explicit-buffering recovery gate missing")\nif "MEDIA3_FROZEN_CLOCK_MS" in stream or "const frozenReadyClock =" in stream:\n    critical.append("Media3 clock-only reload can cause pause/reload/freeze cascades")\n\n'''
if freeze_insert not in freeze_scan:
    if freeze_anchor not in freeze_scan:
        raise SystemExit("freeze scan insertion anchor missing")
    freeze_scan = freeze_scan.replace(freeze_anchor, freeze_insert + freeze_anchor, 1)
freeze_scan = freeze_scan.replace(
    '    if "const MAX_SILENT_BUFFERING_RESYNCS = 2;" in main_stream:\n        notes.append("main still has two nested Media3 silent resyncs; do not back-port that recovery stack")\n',
    '    if "MEDIA3_FROZEN_CLOCK_MS" in main_stream or "const frozenReadyClock =" in main_stream:\n        notes.append("main still allows clock-silence-only Media3 reloads; do not back-port that recovery gate")\n',
)

# Make the deeper bleed repair idempotent after this one-resync contract lands.
marker = '''new_jitter = '''
idx = bleed_repair.find(marker)
if idx < 0:
    raise SystemExit("bleed repair new_jitter block missing")
tail = bleed_repair[idx:]
pos = tail.find("MAX_SILENT_BUFFERING_RESYNCS = 2")
if pos >= 0:
    absolute = idx + pos
    bleed_repair = bleed_repair[:absolute] + "MAX_SILENT_BUFFERING_RESYNCS = 1" + bleed_repair[absolute + len("MAX_SILENT_BUFFERING_RESYNCS = 2"):]

stream_path.write_text(stream, encoding="utf-8")
player_path.write_text(player, encoding="utf-8")
focus_test_path.write_text(focus_test, encoding="utf-8")
live_test_path.write_text(live_test, encoding="utf-8")
preview_scan_path.write_text(preview_scan, encoding="utf-8")
lifecycle_scan_path.write_text(lifecycle_scan, encoding="utf-8")
freeze_scan_path.write_text(freeze_scan, encoding="utf-8")
bleed_repair_path.write_text(bleed_repair, encoding="utf-8")

print("CharmIPTV player freeze convergence repair applied")
