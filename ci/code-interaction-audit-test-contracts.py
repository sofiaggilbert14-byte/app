from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# The live-stability audit intentionally removed Media3's transient `playing`
# flag from frozen-clock detection. Once fullscreen playback has genuinely
# started, the native playback clock + ready state are the authoritative stall
# signal, matching the newer playerLiveStability coverage.
playback_path = Path("frontend/tests/playbackSession.test.mjs")
playback = playback_path.read_text(encoding="utf-8")
playback = replace_once(
    playback,
    '  assert.match(player, /Boolean\\(\\(player as any\\)\\.playing\\)/);',
    '  assert.match(player, /hasPlayedRef\\.current &&\\s*mediaReady &&\\s*now - lastPlaybackAdvanceAtRef\\.current >= MEDIA3_FROZEN_CLOCK_MS/);\n  assert.doesNotMatch(player, /Boolean\\(\\(player as any\\)\\.playing\\)/);',
    "Media3 frozen-clock contract",
)
playback_path.write_text(playback, encoding="utf-8")


# Preview-action handoff now keeps the native Guide active until a real preview
# action receives Android focus. Likewise, wall-clock movement uses one bounded
# native Runnable rather than scheduling invalidates from onDraw.
guide_path = Path("frontend/tests/guideShellPolish.test.mjs")
guide = guide_path.read_text(encoding="utf-8")
guide = replace_once(
    guide,
    '  assert.match(guide, /setPreviewActionsFocused\\(true\\)/);',
    '  assert.doesNotMatch(guide, /const onGuideUpBoundary = useCallback\\([\\s\\S]{0,520}setPreviewActionsFocused\\(true\\)/);',
    "Guide preview focus ownership contract",
)
guide = replace_once(
    guide,
    '  assert.match(guide, /requestAnimationFrame\\(\\(\\) => focusGuidePreviewSurface\\(\\)\\)/);',
    '  assert.match(guide, /requestAnimationFrame\\(\\(\\) => \\{[\\s\\S]{0,160}focusGuidePreviewSurface\\(\\)/);',
    "Guide animation-frame focus request contract",
)
guide = replace_once(
    guide,
    '  assert.match(nativeGuide, /postInvalidateDelayed\\(30_000L\\)/);',
    '  assert.match(nativeGuide, /LIVE_CLOCK_TICK_MS = 30_000L/);\n  assert.match(nativeGuide, /postDelayed\\(liveClockRunnable, LIVE_CLOCK_TICK_MS\\)/);\n  assert.doesNotMatch(nativeGuide, /postInvalidateDelayed\\(30_000L\\)/);',
    "Guide live clock contract",
)
guide_path.write_text(guide, encoding="utf-8")
