from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")


stream_path = Path("frontend/src/components/StreamPlayer.tsx")
stream = stream_path.read_text(encoding="utf-8")

# Preview is best-effort and already has isolated circuits/session generations.
# Keep successful-engine memory isolated too: a Guide preview must never choose
# the decoder used by the next fullscreen tune.
stream = replace_once(
    stream,
    '''        stableRef.current = true;\n        rememberSuccessfulStreamEngine(engineMemoryKey, engine);\n        setSessionPhase(role, sessionGeneration, "playing");''',
    '''        stableRef.current = true;\n        if (role === "fullscreen") rememberSuccessfulStreamEngine(engineMemoryKey, engine);\n        setSessionPhase(role, sessionGeneration, "playing");''',
    "preview/fullscreen engine-memory isolation",
)

# A preview that played and then freezes must not retain a hung native decoder
# forever. Run the same bounded clock/progress watchdog while preview is visible;
# preview still has its own session generation/circuit isolation and unmounts on
# error, so recovery work cannot poison fullscreen.
stream = replace_once(
    stream,
    '''  useEffect(() => {\n    if (mode === "preview" || paused || blocked) return;\n    const watchdog = setInterval(() => {''',
    '''  useEffect(() => {\n    if (paused || blocked) return;\n    const watchdog = setInterval(() => {''',
    "VLC preview watchdog",
)
stream = replace_once(
    stream,
    '''    if (mode === "preview" || paused || blocked || !mediaReady) {\n      return () => progressSub.remove();\n    }''',
    '''    if (paused || blocked || !mediaReady) {\n      return () => progressSub.remove();\n    }''',
    "Media3 preview watchdog",
)

stream_path.write_text(stream, encoding="utf-8")


# Preview failures are presentation failures, not proof that fullscreen playback
# is bad. Only PlayerScreen owns the app-wide failed-stream registry.
guide_path = Path("frontend/app/(tabs)/guide.tsx")
guide = guide_path.read_text(encoding="utf-8")
guide = replace_once(
    guide,
    '''import {\n  clearStreamFailure,\n  failedStreamCount,\n  isFailedChannel,\n  noteStreamFailure,\n} from "@/src/core/streamFailureRegistry";''',
    '''import {\n  failedStreamCount,\n  isFailedChannel,\n} from "@/src/core/streamFailureRegistry";''',
    "Guide preview failure-registry imports",
)
guide = replace_once(
    guide,
    '''  useEffect(() => {\n    if (!channel?.id) return;\n    if (previewStatus === "error") noteStreamFailure(channel.id);\n    if (previewStatus === "playing") clearStreamFailure(channel.id);\n  }, [channel?.id, previewStatus]);\n\n''',
    '''''',
    "Guide preview failure-registry mutation",
)
guide_path.write_text(guide, encoding="utf-8")


test_path = Path("frontend/tests/playerLiveStability.test.mjs")
test = test_path.read_text(encoding="utf-8")
marker = '''test("late stable-stream failure clears the stable gate and bounds fallback startup", async () => {'''
case = '''test("Guide preview cannot rewrite fullscreen engine memory", async () => {\n  const player = await source("src/components/StreamPlayer.tsx");\n  assert.match(player, /if \\(role === "fullscreen"\\) rememberSuccessfulStreamEngine\\(engineMemoryKey, engine\\)/);\n  assert.doesNotMatch(player, /stableRef\\.current = true;\\s*rememberSuccessfulStreamEngine\\(engineMemoryKey, engine\\);/);\n});\n\ntest("Guide preview stalls are bounded and cannot poison fullscreen health state", async () => {\n  const [player, guide] = await Promise.all([\n    source("src/components/StreamPlayer.tsx"),\n    source("app/(tabs)/guide.tsx"),\n  ]);\n  assert.doesNotMatch(player, /if \\(mode === "preview" \\|\\| paused \\|\\| blocked\\) return;/);\n  assert.doesNotMatch(player, /if \\(mode === "preview" \\|\\| paused \\|\\| blocked \\|\\| !mediaReady\\)/);\n  assert.match(player, /const VLC_FROZEN_PROGRESS_MS = 15_000/);\n  assert.match(player, /const MEDIA3_FROZEN_CLOCK_MS = 9000/);\n  assert.doesNotMatch(guide, /noteStreamFailure/);\n  assert.doesNotMatch(guide, /clearStreamFailure/);\n});\n\n'''
if case not in test:
    if marker not in test:
        raise SystemExit("player live-stability insertion point not found")
    # Remove the older one-case insertion if present so this stays idempotent.
    old_case = '''test("Guide preview cannot rewrite fullscreen engine memory", async () => {\n  const player = await source("src/components/StreamPlayer.tsx");\n  assert.match(player, /if \\(role === "fullscreen"\\) rememberSuccessfulStreamEngine\\(engineMemoryKey, engine\\)/);\n  assert.doesNotMatch(player, /stableRef\\.current = true;\\s*rememberSuccessfulStreamEngine\\(engineMemoryKey, engine\\);/);\n});\n\n'''
    test = test.replace(old_case, "", 1)
    test = test.replace(marker, case + marker, 1)
test_path.write_text(test, encoding="utf-8")
