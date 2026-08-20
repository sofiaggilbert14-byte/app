from pathlib import Path

path = Path("frontend/src/components/StreamPlayer.tsx")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old in text:
        text = text.replace(old, new, 1)
        return
    if new in text:
        return
    raise SystemExit(f"{label} anchor not found")


replace_once(
    "const MAX_SILENT_BUFFERING_RESYNCS = 2;",
    "const MAX_SILENT_BUFFERING_RESYNCS = 2;\nconst VLC_FROZEN_PROGRESS_MS = 15_000;\nconst VLC_BUFFERING_FAIL_MS = 22_000;",
    "VLC watchdog constants",
)

replace_once(
    '''  const playerRef = useRef<any>(null);\n  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);''',
    '''  const playerRef = useRef<any>(null);\n  const vlcHasPlayedRef = useRef(false);\n  const vlcProgressSeenRef = useRef(false);\n  const vlcLastProgressAtRef = useRef(Date.now());\n  const vlcBufferingSinceRef = useRef<number | null>(null);\n  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);''',
    "VLC watchdog refs",
)

replace_once(
    '''  useEffect(() => {\n    if (!blocked) return;\n    hardStop();\n  }, [blocked, hardStop]);\n\n  if (blocked || !VLCPlayer) return null;''',
    '''  useEffect(() => {\n    if (!blocked) return;\n    hardStop();\n  }, [blocked, hardStop]);\n\n  useEffect(() => {\n    if (mode === "preview" || paused || blocked) return;\n    const watchdog = setInterval(() => {\n      if (!activeRef.current || tearingDownRef.current || paused || blocked) return;\n      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n      if (!vlcHasPlayedRef.current) return;\n      const now = Date.now();\n      const bufferingSince = vlcBufferingSinceRef.current;\n      const bufferingStalled = bufferingSince != null && now - bufferingSince >= VLC_BUFFERING_FAIL_MS;\n      const progressStalled =\n        vlcProgressSeenRef.current &&\n        now - vlcLastProgressAtRef.current >= VLC_FROZEN_PROGRESS_MS;\n      if (!bufferingStalled && !progressStalled) return;\n      vlcBufferingSinceRef.current = null;\n      vlcHasPlayedRef.current = false;\n      fail();\n    }, 1000);\n    return () => clearInterval(watchdog);\n  }, [blocked, fail, mode, paused, sessionGeneration, sessionRole]);\n\n  if (blocked || !VLCPlayer) return null;''',
    "VLC watchdog effect",
)

replace_once(
    '''      onOpen={() => activeRef.current && !tearingDownRef.current && emit("loading")}\n      onBuffering={() => activeRef.current && !tearingDownRef.current && emit("loading")}\n      onPlaying={() => {''',
    '''      onOpen={() => activeRef.current && !tearingDownRef.current && emit("loading")}\n      onBuffering={() => {\n        if (!activeRef.current || tearingDownRef.current) return;\n        if (vlcHasPlayedRef.current && vlcBufferingSinceRef.current == null) {\n          vlcBufferingSinceRef.current = Date.now();\n        }\n        emit("loading");\n      }}\n      onProgress={() => {\n        if (!activeRef.current || tearingDownRef.current) return;\n        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n        vlcProgressSeenRef.current = true;\n        vlcLastProgressAtRef.current = Date.now();\n        vlcBufferingSinceRef.current = null;\n      }}\n      onPlaying={() => {''',
    "VLC event callbacks",
)

replace_once(
    '''        if (!activeRef.current || tearingDownRef.current) return;\n        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n        recordStablePlayback(sessionRole, engine, uri);''',
    '''        if (!activeRef.current || tearingDownRef.current) return;\n        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n        vlcHasPlayedRef.current = true;\n        vlcLastProgressAtRef.current = Date.now();\n        vlcBufferingSinceRef.current = null;\n        recordStablePlayback(sessionRole, engine, uri);''',
    "VLC playing state",
)

path.write_text(text, encoding="utf-8")
