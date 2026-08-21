from pathlib import Path
import sys

native = Path("frontend/src/nativeEpg.ts").read_text(encoding="utf-8", errors="replace")
policy = Path("frontend/src/core/customEpgPolicy.ts").read_text(encoding="utf-8", errors="replace")
source_prefs = Path("frontend/src/core/sourceRefreshPreferences.ts").read_text(encoding="utf-8", errors="replace")
critical: list[str] = []

if 'options?: { clearRam?: boolean }' not in native:
    critical.append("native user-guide source configuration has no schedule-only cache-preservation option")
if 'options?.clearRam !== false && ramModule' not in native:
    critical.append("native user-guide configuration cannot preserve EPG RAM on schedule-only changes")
if '], { clearRam: false });' not in policy:
    critical.append("EPG refresh cadence/retention policy still clears native EPG RAM")
for marker in ("setEpgRefreshInterval", "setEpgPastDays", "syncNativeCustomEpgPolicy"):
    if marker not in source_prefs:
        critical.append(f"source refresh preference ownership marker missing: {marker}")

report = Path("ci/code-interaction-audit-epg-schedule-lifecycle-report.txt")
report.write_text("\n".join([
    "CharmIPTV EPG schedule/cache lifecycle scan",
    f"critical_findings={len(critical)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
]) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
