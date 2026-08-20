from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


path = Path("frontend/app/player.tsx")
text = path.read_text(encoding="utf-8")

text = replace_once(
    text,
    'import { addPlayerQuickCommandListener, addTvKeyListener, addTvLongPressListener, addTvShortcutListener, setRemoteContext } from "@/src/utils/tvRemote";',
    'import { addPlayerQuickCommandListener, addTvKeyListener, addTvLongPressListener, addTvShortcutListener, resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";',
    "player remote ownership import",
)

text = replace_once(
    text,
    '''  useEffect(() => {\n    if (!isTV) return;\n    setRemoteContext("player");\n    return () => setRemoteContext("default");\n  }, [isTV]);''',
    '''  useEffect(() => {\n    if (!isTV) return;\n    setRemoteContext("player");\n    // Route transitions can install the next owner before this screen's cleanup\n    // runs. Never let stale player cleanup clobber that newer focus context.\n    return () => resetRemoteContextIfOwned("player", "default");\n  }, [isTV]);''',
    "player remote cleanup ownership",
)

text = replace_once(
    text,
    '''          onReset={() => {\n            stopAllPlaybackSessions("crashed");\n            setDecoderArmed(true);\n            setRetryToken((value) => value + 1);\n          }}''',
    '''          onReset={() => {\n            // A render/native crash follows the same codec-release contract as\n            // normal retries. Media3 replaceAsync(null) and LibVLC stop are not\n            // instantaneous, so disarm before remounting the replacement view.\n            stopAllPlaybackSessions("crashed");\n            if (zapTimer.current) clearTimeout(zapTimer.current);\n            const generation = generationRef.current;\n            setDecoderArmed(false);\n            setStatus("loading");\n            setFailReason(null);\n            setRetryToken((value) => value + 1);\n            zapTimer.current = setTimeout(() => {\n              if (generation === generationRef.current) setDecoderArmed(true);\n            }, DECODER_RESTART_SETTLE_MS);\n          }}''',
    "ErrorBoundary decoder settle",
)

path.write_text(text, encoding="utf-8")
