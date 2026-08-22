#!/usr/bin/env python3
from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path("frontend")
EXTS = {".ts", ".tsx", ".js", ".mjs", ".kt", ".java"}
SKIP = {"node_modules", "build", ".gradle", ".expo", "dist"}
# Immutable repair-entry baseline. Build 8 remains in this commit's ancestry,
# while this ref also includes the later verified EPG ownership work that was
# already present when the deep-player repair resumed.
BASELINE_REF = "a98c49e8631f2c0e90be7cfb630395c75ada09ec"
MAIN_REF = "origin/main"
SHIPPED_PREFIXES = (
    "frontend/app/",
    "frontend/src/",
    "frontend/android/",
    "frontend/plugins/",
)

critical: list[str] = []
main_notes: list[str] = []
metrics = Counter()


def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def git_show(ref: str, path: str) -> str:
    return subprocess.check_output(
        ["git", "show", f"{ref}:{path}"],
        text=True,
        encoding="utf-8",
        errors="replace",
        stderr=subprocess.DEVNULL,
    )


def git_paths(ref: str) -> list[str]:
    out = subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", ref, "frontend"],
        text=True,
        encoding="utf-8",
        errors="replace",
        stderr=subprocess.DEVNULL,
    )
    return [
        p
        for p in out.splitlines()
        if Path(p).suffix in EXTS and not any(part in SKIP for part in Path(p).parts)
    ]


def shipped_source(rel: str) -> bool:
    return rel.startswith(SHIPPED_PREFIXES)


current_files: list[Path] = []
for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix not in EXTS:
        continue
    if any(part in SKIP for part in path.parts):
        continue
    current_files.append(path)

# Every checked-in app source file participates in this census. This is broader
# than the focused player scan and catches lifecycle/network owners that can
# indirectly starve or overlap playback on weak Fire TV devices.
for path in current_files:
    data = read_file(path)
    rel = path.as_posix()
    metrics["current_files"] += 1
    metrics["current_functions"] += len(
        re.findall(r"\b(?:function|fun)\s+[A-Za-z_$][\w$]*\s*\(", data)
    )
    metrics["current_timers"] += (
        data.count("setTimeout(") + data.count("setInterval(") + data.count("postDelayed(")
    )
    metrics["current_listeners"] += data.count("addListener(") + data.count("addEventListener(")
    metrics["current_fetch_sites"] += data.count("fetch(") + data.count("HttpURLConnection")

    # Tests are allowed to mention Catch-Up only as a negative regression guard.
    # Shipped app/native/plugin source must contain no Catch-Up route, label,
    # screen, feature, or implementation remnant at all.
    if shipped_source(rel):
        lower_rel = rel.lower()
        lower_data = data.lower()
        if (
            "catchup" in lower_rel
            or "catch-up" in lower_rel
            or "catch up" in lower_data
            or "catch-up" in lower_data
            or "catchup" in lower_data
        ):
            critical.append(f"Catch-Up shipped source remnant: {rel}")

    if path.suffix in {".ts", ".tsx"} and rel != "frontend/src/components/StreamPlayer.tsx":
        decoder_tokens = [
            token
            for token in (
                "useVideoPlayer(",
                "<VideoView",
                "RCTVLCPlayer",
                "<VLCPlayer",
                "react-native-vlc-media-player",
            )
            if token in data
        ]
        if decoder_tokens:
            critical.append(f"decoder owner outside StreamPlayer: {rel}: {', '.join(decoder_tokens)}")

    if "setInterval(" in data and "clearInterval(" not in data:
        critical.append(f"interval has no file-local cleanup: {rel}")
    if (
        "AppState.addEventListener" in data
        and ".remove()" not in data
        and "sub.remove()" not in data
    ):
        critical.append(f"AppState listener has no obvious cleanup: {rel}")

# Exact repair-entry transport baseline: the player repair must not mutate the
# already-established Android M3U/XMLTV ownership implementation.
for rel in (
    "frontend/src/source.native.ts",
    "frontend/src/nativeEpg.ts",
    "frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt",
):
    current = Path(rel).read_text(encoding="utf-8", errors="replace")
    try:
        baseline = git_show(BASELINE_REF, rel)
    except Exception as exc:
        critical.append(f"repair-entry baseline unavailable for {rel}: {exc}")
        continue
    # The player may add this read-through helper without altering the verified
    # native playlist/EPG transport. Compare the transport after removing only
    # that tightly bounded additive API.
    if rel == "frontend/src/source.native.ts":
        helper_start = current.find("\n/** Refresh only M3U rows and return the latest URL for one logical channel. */")
        helper_end = current.find("\n/** Check persisted independent playlist/EPG clocks", helper_start + 1)
        if helper_start >= 0 and helper_end > helper_start:
            current = current[:helper_start] + current[helper_end:]
    if current != baseline:
        critical.append(f"repair changed M3U/EPG transport: {rel}")

# Background workers are optional architecture. If present, they may only set
# due flags; they must never download or parse playlist/EPG data themselves.
# This preserves the verified foreground owner without requiring obsolete worker
# classes to exist just to satisfy a scanner.
worker_flags = {
    "EpgUpdateWorker.kt": "epg_refresh_due",
    "PlaylistUpdateWorker.kt": "playlist_refresh_due",
}
for path in current_files:
    if path.suffix != ".kt" or not path.name.endswith("Worker.kt"):
        continue
    data = read_file(path)
    rel = path.as_posix()
    required_flag = worker_flags.get(path.name)
    if required_flag and required_flag not in data:
        critical.append(f"background worker due flag missing: {rel}: {required_flag}")
    for risky in (
        "HttpURLConnection",
        "GZIPInputStream",
        "XmlPullParser",
        "fetchPlaylist",
        "refreshNativeEpg",
        "parseM3U",
    ):
        if risky in data:
            critical.append(f"heavy refresh work leaked into background worker: {rel}: {risky}")

scheduler = read_file(ROOT / "src/components/SourceRefreshScheduler.tsx")
for required in (
    '!pathname?.startsWith("/guide")',
    '!pathname?.startsWith("/player")',
    '!isGuideSurfing()',
):
    if required not in scheduler:
        critical.append(f"foreground source scheduler can compete with playback: {required}")

main_activity = read_file(ROOT / "android/app/src/main/java/com/charmiptv/app/MainActivity.kt")
for required in (
    "ViewConfiguration.getLongPressTimeout()",
    "selectLongPressRunnable",
    "TvRemoteQuickActions",
):
    if required not in main_activity:
        critical.append(f"central Select/Quick Actions ownership missing: {required}")

# Main is scanned as a complete reference tree so future merges cannot silently
# reintroduce playback hazards. Main findings are reported separately because the
# verified APK is built from the repair head, not by blindly mutating main.
try:
    main_paths = git_paths(MAIN_REF)
    metrics["main_files"] = len(main_paths)
    for rel in main_paths:
        data = git_show(MAIN_REF, rel)
        metrics["main_functions"] += len(
            re.findall(r"\b(?:function|fun)\s+[A-Za-z_$][\w$]*\s*\(", data)
        )
        metrics["main_timers"] += (
            data.count("setTimeout(") + data.count("setInterval(") + data.count("postDelayed(")
        )
        metrics["main_listeners"] += data.count("addListener(") + data.count("addEventListener(")
        metrics["main_fetch_sites"] += data.count("fetch(") + data.count("HttpURLConnection")
        if rel != "frontend/src/components/StreamPlayer.tsx" and Path(rel).suffix in {".ts", ".tsx"}:
            decoder_tokens = [
                token
                for token in (
                    "useVideoPlayer(",
                    "<VideoView",
                    "RCTVLCPlayer",
                    "<VLCPlayer",
                    "react-native-vlc-media-player",
                )
                if token in data
            ]
            if decoder_tokens:
                main_notes.append(
                    f"main decoder owner outside StreamPlayer: {rel}: {', '.join(decoder_tokens)}"
                )

    main_stream = git_show(MAIN_REF, "frontend/src/components/StreamPlayer.tsx")
    if 'if (fallbackUsed || forceVlc || forceMedia3)' not in main_stream:
        main_notes.append(
            "main startup-timeout path can override a forced engine instead of terminating the owned decoder"
        )
    if 'hardStop();\n      recordFailure(sessionRole, engine, uri, "stream-error");' not in main_stream:
        main_notes.append(
            "main does not consistently release Media3 before publishing a fatal stream error"
        )
    if "MEDIA3_FROZEN_CLOCK_MS" in main_stream or "const frozenReadyClock =" in main_stream:
        main_notes.append("main contains clock-silence-only Media3 reload logic")
except Exception as exc:
    critical.append(f"main whole-tree scan unavailable: {exc}")

report = Path("ci/tivimate-whole-repo-player-interaction-report.txt")
report.write_text(
    "\n".join(
        [
            "CharmIPTV whole-repository player interaction scan",
            f"current_files_scanned={metrics['current_files']}",
            f"current_function_declarations={metrics['current_functions']}",
            f"current_timer_sites={metrics['current_timers']}",
            f"current_listener_sites={metrics['current_listeners']}",
            f"current_network_fetch_sites={metrics['current_fetch_sites']}",
            f"main_files_scanned={metrics['main_files']}",
            f"main_function_declarations={metrics['main_functions']}",
            f"main_timer_sites={metrics['main_timers']}",
            f"main_listener_sites={metrics['main_listeners']}",
            f"main_network_fetch_sites={metrics['main_fetch_sites']}",
            f"candidate_critical_findings={len(critical)}",
            f"main_reference_findings={len(main_notes)}",
            "",
            "CANDIDATE_CRITICAL",
            *(critical or ["none"]),
            "",
            "MAIN_REFERENCE_FINDINGS",
            *(main_notes or ["none"]),
        ]
    )
    + "\n",
    encoding="utf-8",
)
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
