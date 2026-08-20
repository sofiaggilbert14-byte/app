from pathlib import Path

path = Path('frontend/app/player.tsx')
text = path.read_text()

replacements = {
'''import { refreshPlaylistOnly } from "@/src/source";\n''': '',
'''const MAX_TOKEN_REFRESH_CHANNELS = 128;\n''': '',
'''  const tokenRefreshAttemptedRef = useRef(new Set<string>());\n''': '',
'''        const failedChannelId = channelIdRef.current;\n        if (!tokenRefreshAttemptedRef.current.has(failedChannelId)) {\n          tokenRefreshAttemptedRef.current.add(failedChannelId);\n          while (tokenRefreshAttemptedRef.current.size > MAX_TOKEN_REFRESH_CHANNELS) {\n            const oldest = tokenRefreshAttemptedRef.current.values().next().value;\n            if (!oldest) break;\n            tokenRefreshAttemptedRef.current.delete(oldest);\n          }\n          // Provider URLs often embed short-lived tokens. Refresh source data\n          // silently once, then normal store propagation remounts only if the\n          // channel URL actually changed.\n          void refreshPlaylistOnly().catch(() => undefined);\n        }\n''': '''        // Keep generic playback recovery local to the active decoder. A transient\n        // live-stream stall must not trigger a full 6k+ playlist download/parse\n        // while Media3/VLC is simultaneously retrying. Source refresh remains an\n        // explicit Settings/source operation instead of competing with playback.\n''',
'''        tokenRefreshAttemptedRef.current.delete(channelIdRef.current);\n''': '',
}

for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'expected player recovery anchor missing: {old[:80]!r}')
    text = text.replace(old, new, 1)

path.write_text(text)
