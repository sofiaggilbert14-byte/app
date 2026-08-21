#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
player = (ROOT / "frontend/app/player.tsx").read_text(encoding="utf-8")
calibration = (ROOT / "frontend/src/tvCalibration.tsx").read_text(encoding="utf-8")
quick = (ROOT / "frontend/src/components/TvQuickActionsOverlay.tsx").read_text(encoding="utf-8")
critical: list[str] = []

if calibration.count("const hydrationMutationRef = useRef(0);") != 1:
    critical.append("calibration must have exactly one hydration mutation owner")

for forbidden in (
    "moreOpen",
    "moreButtonRef",
    "moreFirstActionRef",
    "morePanel:",
    "morePanelContent:",
):
    if forbidden in player:
        critical.append(f"stale local player More ownership remains after consolidation: {forbidden}")

if quick.count('runPlayerCommand("SAVE_DIAGNOSTICS")') != 1:
    critical.append("Player Quick Actions must expose exactly one Diagnostics command row")

report = ROOT / "ci/code-interaction-audit-repair-idempotence-report.txt"
report.write_text("\n".join([
    "CharmIPTV repair idempotence / one-owner scan",
    f"critical_findings={len(critical)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
]) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
