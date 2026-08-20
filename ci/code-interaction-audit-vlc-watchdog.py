from pathlib import Path

path = Path("frontend/src/components/StreamPlayer.tsx")
text = path.read_text(encoding="utf-8")


def insert_after_once(anchor: str, addition: str, label: str) -> None:
    global text
    if addition.strip() in text:
        return
    index = text.find(anchor)
    if index < 0:
        raise SystemExit(f"{label} anchor not found")
    index += len(anchor)
    text = text[:index] + addition + text[index:]


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    text = text.replace(old, new, 1)


if "const VLC_FROZEN_PROGRESS_MS = 15_000;" not in text:
    insert_after_once(
        "const MAX_SILENT_BUFFERING_RESYNCS = 2;",
        "\nconst VLC_FROZEN_PROGRESS_MS = 15_000;\nconst VLC_BUFFERING_FAIL_MS = 22_000;",
        "VLC watchdog constants",
    )

if "const vlcHasPlayedRef = useRef(false);" not in text:
    insert_after_once(
        "  const playerRef = useRef<any>(null);",
        "\n  const vlcHasPlayedRef = useRef(false);\n  const vlcProgressSeenRef = useRef(false);\n  const vlcLastProgressValueRef = useRef<number | null>(null);\n  const vlcLastProgressAtRef = useRef(Date.now());\n  const vlcBufferingSinceRef = useRef<number | null>(null);",
        "VLC watchdog refs",
    )

# Older queued audit work may already have installed the first-generation VLC
# watchdog. Reconcile that partial state instead of adding duplicate props/refs.
if "const vlcLastProgressValueRef = useRef<number | null>(null);" not in text:
    insert_after_once(
        "  const vlcProgressSeenRef = useRef(false);",
        "\n  const vlcLastProgressValueRef = useRef<number | null>(null);",
        "VLC progress-value ref",
    )

watchdog = '''\n\n  useEffect(() => {\n    if (mode === "preview" || paused || blocked) return;\n    const watchdog = setInterval(() => {\n      if (!activeRef.current || tearingDownRef.current || paused || blocked) return;\n      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n      if (!vlcHasPlayedRef.current) return;\n      const now = Date.now();\n      const bufferingSince = vlcBufferingSinceRef.current;\n      const bufferingStalled = bufferingSince != null && now - bufferingSince >= VLC_BUFFERING_FAIL_MS;\n      const progressStalled =\n        vlcProgressSeenRef.current &&\n        now - vlcLastProgressAtRef.current >= VLC_FROZEN_PROGRESS_MS;\n      if (!bufferingStalled && !progressStalled) return;\n      vlcBufferingSinceRef.current = null;\n      vlcHasPlayedRef.current = false;\n      fail();\n    }, 1000);\n    return () => clearInterval(watchdog);\n  }, [blocked, fail, mode, paused, sessionGeneration, sessionRole]);'''
if "const progressStalled =" not in text:
    insert_after_once(
        "  }, [blocked, hardStop]);",
        watchdog,
        "VLC watchdog effect",
    )

replace_once(
    '      onBuffering={() => activeRef.current && !tearingDownRef.current && emit("loading")}',
    '''      onBuffering={() => {\n        if (!activeRef.current || tearingDownRef.current) return;\n        if (vlcHasPlayedRef.current && vlcBufferingSinceRef.current == null) {\n          vlcBufferingSinceRef.current = Date.now();\n        }\n        emit("loading");\n      }}''',
    "VLC buffering callback",
)

progress_callback = '''      onProgress={(info: any) => {\n        if (!activeRef.current || tearingDownRef.current) return;\n        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n        const currentTime = Number(info?.currentTime);\n        const position = Number(info?.position);\n        const progressValue = Number.isFinite(currentTime)\n          ? currentTime\n          : Number.isFinite(position)\n            ? position\n            : Number.NaN;\n        if (!Number.isFinite(progressValue)) return;\n        const previous = vlcLastProgressValueRef.current;\n        vlcLastProgressValueRef.current = progressValue;\n        if (previous == null || Math.abs(progressValue - previous) > 0.0001) {\n          if (previous != null) vlcProgressSeenRef.current = true;\n          vlcLastProgressAtRef.current = Date.now();\n          vlcBufferingSinceRef.current = null;\n        }\n      }}'''
if "onProgress={(info: any) =>" not in text:
    insert_after_once(
        '''      onBuffering={() => {\n        if (!activeRef.current || tearingDownRef.current) return;\n        if (vlcHasPlayedRef.current && vlcBufferingSinceRef.current == null) {\n          vlcBufferingSinceRef.current = Date.now();\n        }\n        emit("loading");\n      }}''',
        "\n" + progress_callback,
        "VLC progress callback",
    )

legacy_progress = '''      onProgress={() => {\n        if (!activeRef.current || tearingDownRef.current) return;\n        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n        vlcProgressSeenRef.current = true;\n        vlcLastProgressAtRef.current = Date.now();\n        vlcBufferingSinceRef.current = null;\n      }}\n'''
if "onProgress={(info: any) =>" in text:
    text = text.replace(legacy_progress, "", 1)
if text.count("onProgress=") != 1:
    raise SystemExit(f"VLC must have exactly one onProgress handler, found {text.count('onProgress=')}")

playing_anchor = '''        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n        recordStablePlayback(sessionRole, engine, uri);'''
playing_new = '''        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;\n        vlcHasPlayedRef.current = true;\n        vlcLastProgressAtRef.current = Date.now();\n        vlcBufferingSinceRef.current = null;\n        recordStablePlayback(sessionRole, engine, uri);'''
replace_once(playing_anchor, playing_new, "VLC playing state")

path.write_text(text, encoding="utf-8")
