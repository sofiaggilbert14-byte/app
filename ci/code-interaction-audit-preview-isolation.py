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

stream_path.write_text(stream, encoding="utf-8")


test_path = Path("frontend/tests/playerLiveStability.test.mjs")
test = test_path.read_text(encoding="utf-8")
marker = '''test("late stable-stream failure clears the stable gate and bounds fallback startup", async () => {'''
case = '''test("Guide preview cannot rewrite fullscreen engine memory", async () => {\n  const player = await source("src/components/StreamPlayer.tsx");\n  assert.match(player, /if \\(role === "fullscreen"\\) rememberSuccessfulStreamEngine\\(engineMemoryKey, engine\\)/);\n  assert.doesNotMatch(player, /stableRef\\.current = true;\\s*rememberSuccessfulStreamEngine\\(engineMemoryKey, engine\\);/);\n});\n\n'''
if case not in test:
    if marker not in test:
        raise SystemExit("player live-stability insertion point not found")
    test = test.replace(marker, case + marker, 1)
test_path.write_text(test, encoding="utf-8")
