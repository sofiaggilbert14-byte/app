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

if "      onStopped={fail}" not in text:
    replace_once(
        "      onError={fail}\n",
        "      onError={fail}\n      onStopped={fail}\n",
        "VLC stopped callback",
    )

path.write_text(text, encoding="utf-8")


# Rejoin wall-clock follow when horizontal navigation lands back on the
# currently-airing programme. Manual future/past browsing still disables follow.
guide_path = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt")
guide = guide_path.read_text(encoding="utf-8")

helper = '''  private fun updateLiveFollowFromSelection() {\n    val now = System.currentTimeMillis()\n    val current = selectedProgram()\n    liveFollowEnabled = current?.let { now >= it.startMs && now < it.endMs }\n      ?: (abs(selectedTimeMs - now) <= 60_000L)\n  }\n\n'''
if "private fun updateLiveFollowFromSelection()" not in guide:
    anchor = "  private fun clampViewportStart(value: Long): Long {"
    if anchor not in guide:
        raise SystemExit("Guide live-follow helper anchor not found")
    guide = guide.replace(anchor, helper + anchor, 1)

left_old = '''        selectedTimeMs = nextTime\n        ensureSelectedTimeVisible()\n        loadPrograms()'''
left_new = '''        selectedTimeMs = nextTime\n        ensureSelectedTimeVisible()\n        updateLiveFollowFromSelection()\n        loadPrograms()'''
if left_new not in guide:
    if guide.count(left_old) < 1:
        raise SystemExit("Guide left live-follow anchor not found")
    guide = guide.replace(left_old, left_new, 1)

right_old = '''        selectedTimeMs = nextTime\n        ensureSelectedTimeVisible()\n        // Horizontal cache misses must request the newest runway even when the'''
right_new = '''        selectedTimeMs = nextTime\n        ensureSelectedTimeVisible()\n        updateLiveFollowFromSelection()\n        // Horizontal cache misses must request the newest runway even when the'''
if right_new not in guide:
    if right_old not in guide:
        raise SystemExit("Guide right live-follow anchor not found")
    guide = guide.replace(right_old, right_new, 1)

rail_old = '''        if (channelRailSelected) {\n          channelRailSelected = false\n          invalidate(); emitSelection(true)\n          return true\n        }'''
rail_new = '''        if (channelRailSelected) {\n          channelRailSelected = false\n          updateLiveFollowFromSelection()\n          invalidate(); emitSelection(true)\n          return true\n        }'''
if rail_new not in guide:
    if rail_old not in guide:
        raise SystemExit("Guide rail live-follow anchor not found")
    guide = guide.replace(rail_old, rail_new, 1)

guide_path.write_text(guide, encoding="utf-8")
