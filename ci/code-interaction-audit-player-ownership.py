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

old_import = 'import { addPlayerQuickCommandListener, addTvKeyListener, addTvLongPressListener, addTvShortcutListener, setRemoteContext } from "@/src/utils/tvRemote";'
new_import = 'import { addPlayerQuickCommandListener, addTvKeyListener, addTvLongPressListener, addTvShortcutListener, resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";'
if new_import not in text:
    text = replace_once(text, old_import, new_import, "player remote ownership import")

original_cleanup = '''  useEffect(() => {\n    if (!isTV) return;\n    setRemoteContext("player");\n    return () => setRemoteContext("default");\n  }, [isTV]);'''
boolean_cleanup = '''  useEffect(() => {\n    if (!isTV) return;\n    setRemoteContext("player");\n    // Route transitions can install the next owner before this screen's cleanup\n    // runs. Never let stale player cleanup clobber that newer focus context.\n    return () => resetRemoteContextIfOwned("player", "default");\n  }, [isTV]);'''
void_cleanup = '''  useEffect(() => {\n    if (!isTV) return;\n    setRemoteContext("player");\n    // Route transitions can install the next owner before this screen's cleanup\n    // runs. Never let stale player cleanup clobber that newer focus context.\n    return () => {\n      resetRemoteContextIfOwned("player", "default");\n    };\n  }, [isTV]);'''
if void_cleanup not in text:
    if boolean_cleanup in text:
        text = text.replace(boolean_cleanup, void_cleanup, 1)
    elif original_cleanup in text:
        text = text.replace(original_cleanup, void_cleanup, 1)
    else:
        raise SystemExit("player remote cleanup ownership anchor not found")

original_reset = '''          onReset={() => {\n            stopAllPlaybackSessions("crashed");\n            setDecoderArmed(true);\n            setRetryToken((value) => value + 1);\n          }}'''
settled_reset = '''          onReset={() => {\n            // A render/native crash follows the same codec-release contract as\n            // normal retries. Media3 replaceAsync(null) and LibVLC stop are not\n            // instantaneous, so disarm before remounting the replacement view.\n            stopAllPlaybackSessions("crashed");\n            if (zapTimer.current) clearTimeout(zapTimer.current);\n            const generation = generationRef.current;\n            setDecoderArmed(false);\n            setStatus("loading");\n            setFailReason(null);\n            setRetryToken((value) => value + 1);\n            zapTimer.current = setTimeout(() => {\n              if (generation === generationRef.current) setDecoderArmed(true);\n            }, DECODER_RESTART_SETTLE_MS);\n          }}'''
if settled_reset not in text:
    text = replace_once(text, original_reset, settled_reset, "ErrorBoundary decoder settle")

path.write_text(text, encoding="utf-8")
