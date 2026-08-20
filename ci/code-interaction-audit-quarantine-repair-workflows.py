from pathlib import Path

WORKFLOWS = [
    ".github/workflows/phase9-live-tv-repair-pr.yml",
    ".github/workflows/phase9-live-tv-repair-v2.yml",
    ".github/workflows/phase9-live-tv-repair-v3.yml",
    ".github/workflows/phase9-live-tv-repair-v4.yml",
    ".github/workflows/phase9-media3-guide-live-repair.yml",
    ".github/workflows/phase9-media3-guide-liveclock-repair.yml",
    ".github/workflows/phase9-player-fullstack-audit-repair.yml",
    ".github/workflows/phase9-player-rc1-baseline-repair.yml",
]

for raw_path in WORKFLOWS:
    path = Path(raw_path)
    text = path.read_text(encoding="utf-8")
    if "on:\n  workflow_dispatch:" in text:
        continue
    start = text.find("on:")
    permissions = text.find("permissions:", start)
    if start < 0 or permissions < 0:
        raise SystemExit(f"workflow trigger anchor missing: {raw_path}")
    text = text[:start] + "on:\n  workflow_dispatch:\n\n" + text[permissions:]
    path.write_text(text, encoding="utf-8")
