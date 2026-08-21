from pathlib import Path

ROOT = Path("frontend")
stream_path = ROOT / "src/components/StreamPlayer.tsx"
stream = stream_path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global stream
    count = stream.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    stream = stream.replace(old, new, 1)

# TiViMate-style ownership: one bounded in-engine re-prepare, then hand recovery
# back to the outer fullscreen owner. Multiple nested re-prepares plus route-level
# retries create the visible pause/pause/final-freeze failure pattern.
replace_once(
    "const MAX_SILENT_BUFFERING_RESYNCS = 2;",
    "const MAX_SILENT_BUFFERING_RESYNCS = 1;",
    "bound Media3 internal resync budget",
)

# A fatal VLC failure must release the native decoder before publishing error.
# Otherwise the final exhausted retry leaves the last frozen native surface alive.
replace_once(
'''  const fail = useCallback(() => {\n    if (tearingDownRef.current || !activeRef.current) return;\n    if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n    recordFailure(sessionRole, engine, uri, "stream-error");\n    if (isCircuitOpen(sessionRole, engine, uri)) {\n      // Stop LibVLC before unmounting the native view — otherwise blocked→null\n      // leaks a running decoder until a later remount.\n      hardStop();\n      setBlocked(true);\n      emit("loading", "circuit-open");\n    } else {\n      emit("error", "stream-error");\n    }\n  }, [emit, engine, hardStop, sessionGeneration, sessionRole, setBlocked, uri]);''',
'''  const fail = useCallback(() => {\n    if (tearingDownRef.current || !activeRef.current) return;\n    if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n    // Release LibVLC before surfacing failure. If the outer retry budget is\n    // exhausted, retaining this decoder is exactly how a final frozen frame\n    // remains on Fire TV.\n    hardStop();\n    recordFailure(sessionRole, engine, uri, "stream-error");\n    if (isCircuitOpen(sessionRole, engine, uri)) {\n      setBlocked(true);\n      emit("loading", "circuit-open");\n    } else {\n      emit("error", "stream-error");\n    }\n  }, [emit, engine, hardStop, sessionGeneration, sessionRole, setBlocked, uri]);''',
    "release VLC decoder before fatal status",
)

# Media3 frozen-clock exhaustion must release the decoder before the parent
# engine-swap/route retry. This prevents stale SurfaceView/codec ownership.
replace_once(
'''      if (bufferingFor < BUFFERING_FAIL_MS) return;\n      bufferingSinceRef.current = null;\n      recordFailure(sessionRole, engine, uri, "stream-error");\n      emit("error", "stream-error");''',
'''      if (bufferingFor < BUFFERING_FAIL_MS) return;\n      bufferingSinceRef.current = null;\n      hardStop();\n      recordFailure(sessionRole, engine, uri, "stream-error");\n      emit("error", "stream-error");''',
    "release Media3 after frozen-clock budget",
)
replace_once(
'''  }, [blocked, emit, engine, headers, kind, mediaReady, mode, paused, player, sessionGeneration, sessionRole, uri]);''',
'''  }, [blocked, emit, engine, hardStop, headers, kind, mediaReady, mode, paused, player, sessionGeneration, sessionRole, uri]);''',
    "watchdog hardStop dependency",
)

# Native Media3 error status follows the same release-before-error contract.
replace_once(
'''      } else if (error || status === "error") {\n        recordFailure(sessionRole, engine, uri, "stream-error");''',
'''      } else if (error || status === "error") {\n        hardStop();\n        recordFailure(sessionRole, engine, uri, "stream-error");''',
    "release Media3 on native error",
)
replace_once(
'''  }, [blocked, emit, engine, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, setBlocked, uri]);''',
'''  }, [blocked, emit, engine, hardStop, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, setBlocked, uri]);''',
    "status listener hardStop dependency",
)

# Silent-audio fallback is an engine handoff too: release Media3 before asking
# the wrapper to mount VLC so two decoders cannot overlap during the swap.
replace_once(
'''      if (sawSupportedAudio) return;\n      recordAudioDiagnostics({''',
'''      if (sawSupportedAudio) return;\n      hardStop();\n      recordAudioDiagnostics({''',
    "release Media3 before silent-audio handoff",
)
replace_once(
'''  }, [blocked, emit, kind, mediaReady, mode, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, uri]);''',
'''  }, [blocked, emit, hardStop, kind, mediaReady, mode, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, uri]);''',
    "silent-audio hardStop dependency",
)

# Forced player settings are ownership contracts. Startup timeout must not ignore
# them and silently mount the opposite decoder. Terminal timeout releases the
# current native decoder before PlayerScreen decides whether to retry.
replace_once(
'''      if (fallbackUsed) {\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");\n        setStatus("error", "start-timeout");\n        return;\n      }\n      const alternate = alternateEngine(engine, vlcAvailable);''',
'''      if (fallbackUsed || forceVlc || forceMedia3) {\n        pauseSessionDecoders(role);\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");\n        setStatus("error", "start-timeout");\n        return;\n      }\n      const alternate = alternateEngine(engine, vlcAvailable);''',
    "honor forced engine on startup timeout",
)
replace_once(
'''      if (!alternate) {\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");''',
'''      if (!alternate) {\n        pauseSessionDecoders(role);\n        setSessionPhase(role, sessionGeneration, "failed", "start-timeout");''',
    "release terminal startup timeout decoder",
)
replace_once(
'''  }, [engine, fallbackUsed, playbackFocused, role, sessionGeneration, setStatus, startTimeoutMs, uri]);''',
'''  }, [engine, fallbackUsed, forceMedia3, forceVlc, playbackFocused, role, sessionGeneration, setStatus, startTimeoutMs, uri]);''',
    "startup timeout preference dependencies",
)

# Add the role-scoped pause helper to the existing session import.
replace_once(
'''  beginSession,\n  isSessionCurrent,''',
'''  beginSession,\n  isSessionCurrent,\n  pauseSessionDecoders,''',
    "import pauseSessionDecoders",
)

stream_path.write_text(stream, encoding="utf-8")
print("Applied CharmIPTV player freeze/decoder ownership repair")
