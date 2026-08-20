from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


path = Path("frontend/src/components/StreamPlayer.tsx")
text = path.read_text(encoding="utf-8")

text = replace_once(
    text,
    '''      if (status === "readyToPlay") {\n        lastPlaybackTimeRef.current = player.currentTime;\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        hasPlayedRef.current = true;\n        bufferingSinceRef.current = null;\n        // Do not clear the bounded resync count merely because Media3 reports\n        // readyToPlay. A wedged decoder can report ready without advancing its\n        // clock. The count resets only after real playback progress.\n        silentResyncInFlightRef.current = false;\n        setMediaReady(true);\n        reportAndSelectMedia3Tracks();\n        recordStablePlayback(sessionRole, engine, uri);\n        emit("playing");''',
    '''      if (status === "readyToPlay") {\n        lastPlaybackTimeRef.current = player.currentTime;\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        bufferingSinceRef.current = null;\n        // readyToPlay means Media3 prepared the stream, not that hardware has\n        // actually rendered/advanced it. Keep the wrapper startup timeout alive\n        // until the first real playback-clock advance proves the decoder is live.\n        // This mirrors TiViMate's first-frame stability gate without trusting the\n        // transient Media3 `playing` flag that can also drop during later stalls.\n        silentResyncInFlightRef.current = false;\n        setMediaReady(true);\n        reportAndSelectMedia3Tracks();''',
    "Media3 ready-to-play stability gate",
)

text = replace_once(
    text,
    '''    const progressSub = player.addListener("timeUpdate", ({ currentTime }) => {\n      if (currentTime > lastPlaybackTimeRef.current + 0.05) {\n        lastPlaybackTimeRef.current = currentTime;\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        hasAdvancedPlaybackRef.current = true;\n        // Real clock progress proves the decoder recovered. Only now reset the\n        // bounded recovery budget and clear any buffering watchdog.\n        silentResyncCountRef.current = 0;\n        bufferingSinceRef.current = null;\n      }\n    });''',
    '''    const progressSub = player.addListener("timeUpdate", ({ currentTime }) => {\n      if (!mediaReady) return;\n      if (currentTime > lastPlaybackTimeRef.current + 0.05) {\n        const firstProgress = !hasPlayedRef.current;\n        lastPlaybackTimeRef.current = currentTime;\n        lastPlaybackAdvanceAtRef.current = Date.now();\n        hasPlayedRef.current = true;\n        hasAdvancedPlaybackRef.current = true;\n        // Real clock progress proves startup/recovery succeeded. Only now reset\n        // the bounded recovery budget and publish stable playback to the parent.\n        silentResyncCountRef.current = 0;\n        bufferingSinceRef.current = null;\n        if (firstProgress && isSessionCurrent(sessionRole, sessionGeneration)) {\n          recordStablePlayback(sessionRole, engine, uri);\n          emit("playing");\n        }\n      }\n    });''',
    "Media3 first clock progress stability",
)

path.write_text(text, encoding="utf-8")
