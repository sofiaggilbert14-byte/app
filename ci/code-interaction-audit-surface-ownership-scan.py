from pathlib import Path
import sys

ROOT = Path("frontend")
critical: list[str] = []


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="replace")


shell = read("src/components/PurpleTvShell.tsx")
groups = read("src/components/PurpleGuideGroupDrawer.tsx")
preview = read("src/components/GuidePreviewRail.tsx")
quick = read("src/components/TvQuickActionsOverlay.tsx")
player = read("app/player.tsx")
stream = read("src/components/StreamPlayer.tsx")
scheduler = read("src/components/SourceRefreshScheduler.tsx")

# Main drawer: exactly one remote/focus owner while open, owner-safe teardown,
# bounded focus, animation/timer/listener cleanup, and forced release before a
# destination route mounts. This mirrors the TiViMate single-window-owner model.
for required in (
    'setRemoteContext("main_drawer")',
    'resetRemoteContextIfOwned("main_drawer", "guide")',
    'resetRemoteContextIfOwned("main_drawer", "default")',
    'closeDrawer({ force: true })',
    'animation.stop()',
    'return () => sub.remove();',
    'pointerEvents={drawerOpen ? "auto" : "none"}',
    '<FocusGuide style={styles.sidebar} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>',
    'focusable={drawerOpen}',
    'if (deferredDrawerCloseTimer.current) clearTimeout(deferredDrawerCloseTimer.current)',
    'if (exitHintTimer.current) clearTimeout(exitHintTimer.current)',
):
    if required not in shell:
        critical.append(f"main drawer ownership/cleanup missing: {required}")

# Guide-groups drawer: no competing Guide navigation owner, one open-scoped
# remote listener set, explicit focus retry cancellation, and owner-safe return.
for required in (
    'if (!open) return null;',
    'setGuideNavigationActive(false);',
    'setRemoteContext("guide_groups")',
    'resetRemoteContextIfOwned("guide_groups", "guide")',
    'offKey();',
    'offLongPress();',
    'cancelFocus?.();',
    'clearTimeout(clearPreferred);',
    'return () => sub.remove();',
    '<FocusGuide style={styles.drawer} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>',
):
    if required not in groups:
        critical.append(f"Guide group drawer ownership/cleanup missing: {required}")

# Live preview rail: exactly one preview decoder, role-scoped and muted, only
# mounted for a visible playable channel, with bounded one-shot action focus.
if preview.count("<StreamPlayer") != 1:
    critical.append(f"Guide preview StreamPlayer mount count={preview.count('<StreamPlayer')}")
for required in (
    'previewVisible && channel?.url',
    'mode="preview"',
    'sessionRole="preview"',
    'muted={muted}',
    'setTimeout(() => setPreferPlayFocus(false), 320)',
    'return () => clearTimeout(timer);',
    'testID="guide-preview-play"',
    'testID="guide-preview-favorite"',
    'testID="guide-preview-remind"',
    'testID="guide-preview-drawer"',
    'testID="guide-preview-mute"',
    'testID="guide-preview-hide"',
):
    if required not in preview:
        critical.append(f"live preview rail contract missing: {required}")

# Quick Actions is a modal/UI owner only. It may assign EPG mappings from Guide
# context, but may not refresh/download XMLTV or create another decoder.
for forbidden in ("refreshNativeSourceGuide", "refreshNativeUserGuide", "<StreamPlayer"):
    if forbidden in quick:
        critical.append(f"Quick Actions owns forbidden foreground work: {forbidden}")
for required in (
    'resetRemoteContextIfOwned("modal", restore)',
    'setRemoteContext("modal")',
    'DeviceEventEmitter.emit("CharmQuickActionsVisibility", true)',
    'DeviceEventEmitter.emit("CharmQuickActionsVisibility", false)',
):
    if required not in quick:
        critical.append(f"Quick Actions modal lifecycle missing: {required}")

# Fullscreen and preview must never coexist as uncontrolled decoders. Route/app
# blur fully removes StreamPlayer, zaps disarm before remount, and source refresh
# yields to Guide/player foreground ownership.
for required in (
    'if (!playbackFocused || !uri || !sessionGeneration) return null;',
    'surfaceType={Platform.OS === "android" ? "textureView" : undefined}',
):
    if required not in stream:
        critical.append(f"StreamPlayer ownership invariant missing: {required}")
for obsolete in ("getRememberedStreamEngine", "rememberSuccessfulStreamEngine", "engineMemoryKey"):
    if obsolete in stream:
        critical.append(f"stale engine memory can override format routing: {obsolete}")
for required in (
    'pauseSessionDecoders("fullscreen")',
    'setDecoderArmed(false)',
    'stopFullscreenSession()',
):
    if required not in player:
        critical.append(f"fullscreen player teardown/remount missing: {required}")
for required in (
    '!pathname?.startsWith("/guide")',
    '!pathname?.startsWith("/player")',
    '!isGuideSurfing()',
    'clearTimeout(initialTimer)',
    'clearInterval(timer)',
    'sub.remove()',
):
    if required not in scheduler:
        critical.append(f"background source owner exclusion/cleanup missing: {required}")

report = Path("ci/code-interaction-audit-surface-ownership-report.txt")
lines = [
    "CharmIPTV drawer/overlay/live-preview/player surface ownership scan",
    f"critical_findings={len(critical)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
]
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
