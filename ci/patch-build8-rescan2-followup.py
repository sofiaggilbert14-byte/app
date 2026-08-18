from pathlib import Path


def patch(path_str: str, old: str, new: str, label: str) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"{label}: anchor not found in {path_str}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

patch(
    "frontend/src/source.native.ts",
    '''    const backup = await FileSystem.getInfoAsync(CHANNEL_CACHE_BAK).catch(() => null);\n    if (backup?.exists) {\n      await FileSystem.moveAsync({ from: CHANNEL_CACHE_BAK, to: CHANNEL_CACHE }).catch(() => undefined);\n    }\n    throw error;\n''',
    '''    const backup = await FileSystem.getInfoAsync(CHANNEL_CACHE_BAK).catch(() => null);\n    if (backup?.exists) {\n      const restored = await FileSystem.moveAsync({ from: CHANNEL_CACHE_BAK, to: CHANNEL_CACHE })\n        .then(() => true)\n        .catch(() => false);\n      channelCacheKnownGood = restored;\n    }\n    throw error;\n''',
    "restored channel cache must remain known-good",
)

patch(
    "frontend/app/player.tsx",
    '''import { refreshPlaylistOnly } from "@/src/source";\n''',
    '''import { refreshPlaylistOnly } from "@/src/source";\nimport type { Channel } from "@/src/api";\n''',
    "player Channel type import",
)

# Extend the cache safety assertion so a restored backup stays protected on a
# second write attempt in the same process.
test = Path("frontend/tests/memoryCrossAudit.test.mjs")
text = test.read_text(encoding="utf-8")
old = '''  assert.match(source, /channelCacheKnownGood/);\n  assert.match(source, /priorityMatchChannelIds = \\[\\]/);\n});\n'''
new = '''  assert.match(source, /channelCacheKnownGood/);\n  assert.match(source, /channelCacheKnownGood = restored/);\n  assert.match(source, /priorityMatchChannelIds = \\[\\]/);\n});\n'''
if old not in text:
    raise SystemExit("memory test cache safety anchor not found")
test.write_text(text.replace(old, new, 1), encoding="utf-8")
