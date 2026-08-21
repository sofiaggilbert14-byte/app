#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path("frontend")
critical: list[str] = []


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8", errors="replace")

main = read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt")
qa = read("src/components/TvQuickActionsOverlay.tsx")
stream = read("src/components/StreamPlayer.tsx")
player = read("app/player.tsx")
patch = read("patches/expo-video+3.0.16.patch")

# Fire TV long OK must be classified at the Activity/window boundary rather than
# relying on repeatCount. Short release is replayed exactly once after ownership
# is confirmed; long release is consumed by Quick Actions.
for token in (
    "private val selectHoldHandler = Handler(Looper.getMainLooper())",
    "ViewConfiguration.getLongPressTimeout().toLong()",
    'emitRemoteEvent("TvRemoteQuickActions", owner)',
    "if (owner == null || TvRemoteModule.remoteContext != owner) return true",
    "super.dispatchKeyEvent(down)",
    "super.dispatchKeyEvent(up)",
    "selectHoldHandler.removeCallbacks(selectLongPressRunnable)",
):
    if token not in main:
        critical.append(f"MainActivity timed Select ownership missing: {token}")
if 'event.repeatCount > 0' not in main:
    critical.append("generic Down/Back long-press repeat handling disappeared")

# Quick Actions owns first focus only after its modal window claim is active.
for token in (
    'import { requestNativeFocus } from "@/src/utils/tvFocus";',
    "const firstActionRef = useRef<any>(null);",
    'if (mode === "main") {',
    "requestNativeFocus(firstActionRef.current)",
    "buttonRef={firstActionRef}",
    "ref={buttonRef}",
):
    if token not in qa:
        critical.append(f"Quick Actions deterministic focus missing: {token}")

# Decoder recovery is single-owner and bounded. No clock-silence-only source
# reload and no rapid re-arming after a transient frame.
for token in (
    "const BUFFERING_FAIL_MS = 12_000;",
    "const MAX_SILENT_BUFFERING_RESYNCS = 1;",
    "const RESYNC_REARM_STABLE_MS = 30_000;",
    "const VLC_BUFFERING_FAIL_MS = 12_000;",
    "bufferingSince == null || Date.now() - bufferingSince < VLC_BUFFERING_FAIL_MS",
    "const stableProgressSinceRef = useRef<number | null>(null);",
    "if (bufferingSince == null) return;",
    "if (!hasPlayedRef.current) bufferingSinceRef.current = null;",
):
    if token not in stream:
        critical.append(f"StreamPlayer deep recovery contract missing: {token}")
for obsolete in ("MEDIA3_FROZEN_CLOCK_MS", "frozenReadyClock", "lastPlaybackAdvanceAtRef", "hasAdvancedPlaybackRef"):
    if obsolete in stream:
        critical.append(f"obsolete nested/frozen-clock recovery remains: {obsolete}")
for obsolete in (
    "VLC_FROZEN_PROGRESS_MS",
    "vlcLastProgressAtRef",
    "vlcProgressSeenRef",
    "--clock-jitter=0",
    "--clock-synchro=0",
):
    if obsolete in stream:
        critical.append(f"VLC false-freeze override remains: {obsolete}")

# Outer remount owner gets one 1/2/4 second sequence. A transient PLAYING event
# does not buy another sequence until 30 seconds stable on the same channel.
for token in (
    "const STREAM_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;",
    "const MAX_AUTO_STREAM_RETRIES = 3;",
    "const STABLE_RETRY_RESET_MS = 30_000;",
    "const stableRetryResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);",
    "stableRetryResetTimer.current = setTimeout(() => {",
):
    if token not in player:
        critical.append(f"PlayerScreen bounded retry contract missing: {token}")
if 'if (status === "playing") {\n      setRetryAttempt(0);' in player:
    critical.append("PlayerScreen immediately resets retry budget on PLAYING")

# Shared Media3 pooled sockets fail dead provider reads/writes promptly so the
# single recovery owner can act; old long read/write timeouts must not return.
for token in (
    "+    .connectTimeout(5, TimeUnit.SECONDS)",
    "+    .readTimeout(5, TimeUnit.SECONDS)",
    "+    .writeTimeout(5, TimeUnit.SECONDS)",
):
    if token not in patch:
        critical.append(f"Media3 socket failover contract missing: {token}")
if ".readTimeout(30, TimeUnit.SECONDS)" in patch or ".writeTimeout(15, TimeUnit.SECONDS)" in patch:
    critical.append("stale long Media3 socket timeout remains")

print("CharmIPTV TiViMate deep player + Quick Actions static scan")
print(f"critical_findings={len(critical)}")
for item in critical:
    print(f"CRITICAL: {item}")
if critical:
    sys.exit(1)
print("CRITICAL: none")
