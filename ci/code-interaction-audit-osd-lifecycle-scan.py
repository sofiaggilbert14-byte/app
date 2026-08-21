from pathlib import Path
import sys

ROOT = Path("frontend")
critical: list[str] = []

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="replace")

player = read("app/player.tsx")
quick = read("src/components/TvQuickActionsOverlay.tsx")
remote = read("src/utils/tvRemote.ts")

# One Actions/Quick-Actions owner. Channels and Tracks are subordinate player
# surfaces; there must be no second local More panel with its own focus/timers.
for forbidden in (
    '"channels" | "tracks" | "more"',
    'playerOverlay === "more"',
    'setMoreOpen',
    'morePanel:',
    'morePanelContent:',
    'moreFirstActionRef',
):
    if forbidden in player:
        critical.append(f"duplicate local player More owner remains: {forbidden}")
if 'emitTvQuickActions("player")' not in player:
    critical.append("player Quick Actions button does not route to the global owner")
if 'export function emitTvQuickActions(context: TvQuickActionsContext)' not in remote:
    critical.append("shared Quick Actions semantic trigger missing")

# Player-owned state remains inside PlayerScreen; global drawer sends semantic
# commands instead of directly mutating track/aspect/previous/diagnostic internals.
for command in ("OPEN_TRACKS", "CYCLE_ASPECT", "PREVIOUS_CHANNEL", "SAVE_DIAGNOSTICS"):
    if command not in remote or command not in quick or command not in player:
        critical.append(f"player semantic command bridge incomplete: {command}")

# Construction-sensitive settings close modal ownership before changing. The
# remount then occurs through StreamPlayer's generation/decoder-stop contract.
for marker in (
    'label="Playback buffer"',
    'const next = nextValue(BUFFER_ORDER, bufferProfile); close(); requestAnimationFrame(() => setBufferProfile(next));',
    'label="Player engine"',
    'const next = nextValue(ENGINE_ORDER, playerEngine); close(); requestAnimationFrame(() => setPlayerEngine(next));',
):
    if marker not in quick:
        critical.append(f"player setting modal/remount isolation missing: {marker}")

# EPG configuration remains Guide-only and cannot run XMLTV refresh underneath player OSD.
if "refreshNativeSourceGuide" in quick:
    critical.append("player Quick Actions still owns an XMLTV refresh path")
if 'context === "guide" ? <Action icon="git-compare-outline" label="Assign custom EPG"' not in quick:
    critical.append("EPG mapping not restricted to Guide Quick Actions")

report = Path("ci/code-interaction-audit-osd-lifecycle-report.txt")
report.write_text("\n".join([
    "CharmIPTV player OSD ownership scan",
    f"critical_findings={len(critical)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
]) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
