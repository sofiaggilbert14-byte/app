#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAYER = ROOT / "frontend/app/player.tsx"
CALIBRATION = ROOT / "frontend/src/tvCalibration.tsx"
QUICK_ACTIONS = ROOT / "frontend/src/components/TvQuickActionsOverlay.tsx"

# Mandatory audit cycles rerun the repair scripts. A rerun must converge on the
# same source, never accumulate a second state/ref owner.
calibration = CALIBRATION.read_text(encoding="utf-8")
hydration_line = "  const hydrationMutationRef = useRef(0);\n"
if calibration.count(hydration_line) > 1:
    seen = False
    kept: list[str] = []
    for line in calibration.splitlines(keepends=True):
        if line == hydration_line:
            if seen:
                continue
            seen = True
        kept.append(line)
    calibration = "".join(kept)
CALIBRATION.write_text(calibration, encoding="utf-8")

# The TiViMate-style single Quick Actions repair removes the local More owner.
# Earlier normalization stripped its ref/dependency names before the exact
# effect-removal anchor ran, leaving an orphan useEffect. Remove the whole stale
# local owner block by semantic boundary rather than by its dependency spelling.
player = PLAYER.read_text(encoding="utf-8")
start = player.find('  useEffect(() => {\n    if (!moreOpen || !isTV) return;')
if start >= 0:
    end_marker = '\n  // Cold mount / explicit retry only'
    end = player.find(end_marker, start)
    if end < 0:
        raise SystemExit("stale local More focus effect found without a safe end boundary")
    player = player[:start] + player[end:]
PLAYER.write_text(player, encoding="utf-8")

# The OSD repair's Diagnostics insertion anchor is intentionally adjacent to
# Playback compatibility. On repeated audit cycles the old two-line anchor can
# still exist inside the repaired form, so collapse duplicate command rows back
# to one. One OSD action must map to one semantic player command.
quick = QUICK_ACTIONS.read_text(encoding="utf-8")
diag_line = '                <Action icon="bug-outline" label="Diagnostics" value="Save player report" onPress={() => runPlayerCommand("SAVE_DIAGNOSTICS")} />\n'
if quick.count(diag_line) > 1:
    seen = False
    kept = []
    for line in quick.splitlines(keepends=True):
        if line == diag_line:
            if seen:
                continue
            seen = True
        kept.append(line)
    quick = "".join(kept)
QUICK_ACTIONS.write_text(quick, encoding="utf-8")

print("Repair idempotence normalization complete")
