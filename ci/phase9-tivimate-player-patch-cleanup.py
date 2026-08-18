from pathlib import Path

path = Path('frontend/patches/expo-video+3.0.16.patch')
text = path.read_text(encoding='utf-8')

# Tune the already-existing shared Charm player pool; do not stack a second
# DataSourceUtils patch on top of the same source file.
text = text.replace(
    '.connectionPool(ConnectionPool(8, 5, TimeUnit.MINUTES))',
    '.connectionPool(ConnectionPool(15, 5, TimeUnit.MINUTES))',
    1,
)
text = text.replace('.connectTimeout(8, TimeUnit.SECONDS)', '.connectTimeout(5, TimeUnit.SECONDS)', 1)
text = text.replace('.readTimeout(15, TimeUnit.SECONDS)', '.readTimeout(5, TimeUnit.SECONDS)', 1)

header = 'diff --git a/node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt b/node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt'
positions = []
start = 0
while True:
    idx = text.find(header, start)
    if idx < 0:
        break
    positions.append(idx)
    start = idx + len(header)

if len(positions) > 1:
    duplicate_start = positions[1]
    next_header = 'diff --git a/node_modules/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayerLoadControl.kt b/node_modules/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayerLoadControl.kt'
    duplicate_end = text.find(next_header, duplicate_start)
    if duplicate_end < 0:
        raise SystemExit('could not find load-control patch after duplicate datasource patch')
    text = text[:duplicate_start] + text[duplicate_end:]

if text.count(header) != 1:
    raise SystemExit(f'expected one DataSourceUtils patch, found {text.count(header)}')
if 'bufferForPlaybackAfterRebufferMs = maxOf(1_000L, safeBufferForPlayback)' not in text:
    raise SystemExit('expected TiviMate-style rebuffer floor patch is missing')

path.write_text(text, encoding='utf-8')
