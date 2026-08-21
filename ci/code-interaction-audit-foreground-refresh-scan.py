#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EPG = (ROOT / "frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt").read_text(encoding="utf-8")
CUSTOM = (ROOT / "frontend/android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt").read_text(encoding="utf-8")
DB = (ROOT / "frontend/android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt").read_text(encoding="utf-8")
PLAYLIST = (ROOT / "frontend/android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt").read_text(encoding="utf-8")
SCHEDULER = (ROOT / "frontend/src/components/SourceRefreshScheduler.tsx").read_text(encoding="utf-8")

checks = {
    "primary EPG raw parser yields to interactive TV owner": (
        '(rawProgrammeCount and 0x1ffL) == 0L' in EPG
        and 'EPG refresh deferred for active TV interaction' in EPG
        and 'owner == "player"' in EPG
    ),
    "custom EPG raw parser still yields to interactive TV owner": (
        '(rawProgrammeCount and 0x1ffL) == 0L' in CUSTOM
        and 'Custom EPG refresh deferred for active TV interaction' in CUSTOM
    ),
    "EPG staging still checks owner before accepted batches": (
        'if (interactiveTvOwnsPriority()) throw IllegalStateException("EPG refresh deferred for active Guide/player")' in DB
    ),
    "EPG final swap still checks owner": (
        DB.count('if (interactiveTvOwnsPriority()) throw IllegalStateException("EPG refresh deferred before final swap")') >= 2
    ),
    "playlist stream yields after foreground ownership changes": (
        '(rawLineCount and 0xffL) == 0L' in PLAYLIST
        and 'Playlist refresh deferred for active TV interaction' in PLAYLIST
        and 'owner == "player"' in PLAYLIST
    ),
    "scheduler refuses to start provider work on player or guide": (
        ('!pathname?.startsWith("/guide")' in SCHEDULER or '!pathname.startsWith("/guide")' in SCHEDULER)
        and ('!pathname?.startsWith("/player")' in SCHEDULER or '!pathname.startsWith("/player")' in SCHEDULER)
        and 'if (!screenIsSafe()) return;' in SCHEDULER
    ),
}

failed = [name for name, ok in checks.items() if not ok]
report = ROOT / "ci/code-interaction-audit-foreground-refresh-report.txt"
report.write_text(
    "\n".join([
        "Code Interaction Audit - Foreground Refresh Ownership",
        "=====================================================",
        *[f"{'PASS' if ok else 'FAIL'}: {name}" for name, ok in checks.items()],
        "",
        f"critical_findings={len(failed)}",
    ]) + "\n",
    encoding="utf-8",
)

if failed:
    for name in failed:
        print(f"RED X: {name}")
    raise SystemExit(1)
print("Foreground refresh ownership scan passed")
