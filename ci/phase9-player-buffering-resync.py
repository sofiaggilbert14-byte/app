from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path: str, old: str, new: str):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:180]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

replace(
    'frontend/src/components/StreamPlayer.tsx',
    '''const STALL_RECOVERY_NUDGE_MS = 7000;\nconst FROZEN_VIDEO_WATCHDOG_MS = 18000;''',
    '''// TiviMate-style recovery adapted to Charm: only an actual post-playback\n// BUFFERING/loading state arms the watchdog. A silent internal re-prepare gets\n// first chance before the parent retry/failure machinery is notified.\nconst BUFFERING_RESYNC_MS = 7000;\nconst BUFFERING_FAIL_MS = 22000;\nconst MAX_SILENT_BUFFERING_RESYNCS = 2;''',
)
replace(
    'frontend/src/components/StreamPlayer.tsx',
    '''  const lastPlaybackTimeRef = useRef(-1);\n  const lastPlaybackAdvanceAtRef = useRef(Date.now());\n  const lastStallNudgeAtRef = useRef(0);\n''',
    '''  const lastPlaybackTimeRef = useRef(-1);\n  const lastPlaybackAdvanceAtRef = useRef(Date.now());\n  const hasPlayedRef = useRef(false);\n  const bufferingSinceRef = useRef<number | null>(null);\n  const silentResyncCountRef = useRef(0);\n  const silentResyncInFlightRef = useRef(false);\n''',
)
replace(
    'frontend/src/components/StreamPlayer.tsx',
    '''    setMediaReady(false);\n    emit("loading");\n''',
    '''    setMediaReady(false);\n    hasPlayedRef.current = false;\n    bufferingSinceRef.current = null;\n    silentResyncCountRef.current = 0;\n    silentResyncInFlightRef.current = false;\n    emit("loading");\n''',
)
replace(
    'frontend/src/components/StreamPlayer.tsx',
    '''      if (status === "readyToPlay") {\n        lastPlaybackTimeRef.current = player.currentTime;\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        setMediaReady(true);\n        reportAndSelectMedia3Tracks();\n        recordStablePlayback(sessionRole, engine, uri);\n        emit("playing");\n      } else if (status === "loading") {\n        emit("loading");\n''',
    '''      if (status === "readyToPlay") {\n        lastPlaybackTimeRef.current = player.currentTime;\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        hasPlayedRef.current = true;\n        bufferingSinceRef.current = null;\n        silentResyncCountRef.current = 0;\n        silentResyncInFlightRef.current = false;\n        setMediaReady(true);\n        reportAndSelectMedia3Tracks();\n        recordStablePlayback(sessionRole, engine, uri);\n        emit("playing");\n      } else if (status === "loading") {\n        // Startup loading is handled by the separate start timeout. Only a\n        // rebuffer after actual playback arms freeze recovery.\n        if (hasPlayedRef.current && bufferingSinceRef.current == null) {\n          bufferingSinceRef.current = Date.now();\n        }\n        emit("loading");\n''',
)
replace(
    'frontend/src/components/StreamPlayer.tsx',
    '''    const progressSub = player.addListener("timeUpdate", ({ currentTime }) => {\n      if (currentTime > lastPlaybackTimeRef.current + 0.05) {\n        lastPlaybackTimeRef.current = currentTime;\n        lastPlaybackAdvanceAtRef.current = Date.now();\n      }\n    });\n    if (mode === "preview" || paused || blocked || !mediaReady) {\n      return () => progressSub.remove();\n    }\n    lastPlaybackTimeRef.current = player.currentTime;\n    lastPlaybackAdvanceAtRef.current = Date.now();\n    const watchdog = setInterval(() => {\n      if (!mountedRef.current || tearingDownRef.current || paused || blocked) return;\n      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n      const stalledFor = Date.now() - lastPlaybackAdvanceAtRef.current;\n      if (stalledFor >= STALL_RECOVERY_NUDGE_MS && stalledFor < FROZEN_VIDEO_WATCHDOG_MS) {\n        // A live HLS/TS source can legitimately stop advancing for several\n        // seconds while waiting for the next provider segment. Nudge play once\n        // without tearing down sockets/decoders; only escalate a sustained stall.\n        if (Date.now() - lastStallNudgeAtRef.current >= STALL_RECOVERY_NUDGE_MS) {\n          lastStallNudgeAtRef.current = Date.now();\n          try { player.play(); } catch {}\n        }\n        return;\n      }\n      if (stalledFor < FROZEN_VIDEO_WATCHDOG_MS) return;\n      lastPlaybackAdvanceAtRef.current = Date.now();\n      lastStallNudgeAtRef.current = 0;\n      recordFailure(sessionRole, engine, uri, "stream-error");\n      emit("error", "stream-error");\n    }, 1000);\n    return () => {\n      progressSub.remove();\n      clearInterval(watchdog);\n    };\n  }, [blocked, emit, engine, mediaReady, mode, paused, player, sessionGeneration, sessionRole, uri]);\n''',
    '''    const progressSub = player.addListener("timeUpdate", ({ currentTime }) => {\n      if (currentTime > lastPlaybackTimeRef.current + 0.05) {\n        lastPlaybackTimeRef.current = currentTime;\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        // Frames/time are advancing again, so any buffering watchdog is stale.\n        bufferingSinceRef.current = null;\n      }\n    });\n    if (mode === "preview" || paused || blocked || !mediaReady) {\n      return () => progressSub.remove();\n    }\n    lastPlaybackTimeRef.current = player.currentTime;\n    lastPlaybackAdvanceAtRef.current = Date.now();\n    const watchdog = setInterval(() => {\n      if (!mountedRef.current || tearingDownRef.current || paused || blocked) return;\n      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n      const bufferingSince = bufferingSinceRef.current;\n      if (bufferingSince == null) return;\n      const bufferingFor = Date.now() - bufferingSince;\n      if (bufferingFor < BUFFERING_RESYNC_MS) return;\n\n      if (\n        silentResyncCountRef.current < MAX_SILENT_BUFFERING_RESYNCS &&\n        !silentResyncInFlightRef.current\n      ) {\n        silentResyncCountRef.current += 1;\n        silentResyncInFlightRef.current = true;\n        bufferingSinceRef.current = Date.now();\n        const contentType = media3ContentType(kind);\n        replaceQueueRef.current = replaceQueueRef.current\n          .catch(() => undefined)\n          .then(async () => {\n            if (!mountedRef.current || tearingDownRef.current || paused || blocked) return;\n            if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n            await player.replaceAsync({ uri, headers, contentType });\n            if (!paused) player.play();\n          })\n          .catch(() => undefined)\n          .finally(() => { silentResyncInFlightRef.current = false; });\n        return;\n      }\n\n      if (bufferingFor < BUFFERING_FAIL_MS) return;\n      bufferingSinceRef.current = null;\n      recordFailure(sessionRole, engine, uri, "stream-error");\n      emit("error", "stream-error");\n    }, 1000);\n    return () => {\n      progressSub.remove();\n      clearInterval(watchdog);\n    };\n  }, [blocked, emit, engine, headers, kind, mediaReady, mode, paused, player, sessionGeneration, sessionRole, uri]);\n''',
)

print('phase9 buffering-state silent resync patched')
