from pathlib import Path
import sys

ROOT = Path("frontend")
critical: list[str] = []
warnings: list[str] = []

ROUTES = {
    "app/(tabs)/index.tsx": "LiveTvHomeScreen",
    "app/(tabs)/guide.tsx": "PurpleGuideScreen",
    "app/(tabs)/channels.tsx": "ChannelsScreen",
    "app/(tabs)/movies.tsx": "MoviesScreen",
    "app/(tabs)/series.tsx": "SeriesScreen",
    "app/(tabs)/favorites.tsx": "FavoritesScreen",
    "app/(tabs)/reminders.tsx": "RemindersScreen",
    "app/(tabs)/search.tsx": "SearchScreen",
    "app/(tabs)/settings.tsx": "SettingsScreen",
    "app/(tabs)/epg-sources.tsx": "EpgSourcesScreen",
}


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="replace")

helper = read("src/components/FocusedTabMount.tsx")
if "useIsFocused" not in helper or "return isFocused ? <>{children}</> : null" not in helper:
    critical.append("FocusedTabMount does not explicitly unmount hidden tab content")

mounted = 0
for path, name in ROUTES.items():
    source = read(path)
    for marker in (
        'import { FocusedTabMount } from "@/src/components/FocusedTabMount";',
        f"function {name}Content()",
        f"export default function {name}()",
        f"<{name}Content />",
    ):
        if marker not in source:
            critical.append(f"inactive tab teardown missing in {path}: {marker}")
    if "<FocusedTabMount>" in source:
        mounted += 1

# Do not substitute render freezing for lifecycle cleanup. Frozen trees can keep
# timers/listeners/native subscriptions resident and make teardown ownership opaque.
layout = read("app/(tabs)/_layout.tsx")
if "freezeOnBlur" in layout:
    critical.append("tab navigator uses freezeOnBlur instead of explicit hidden-content teardown")

# Guide is safe to unmount because its return anchor is module/session scoped and
# its focus cleanup already releases preview/runway/native Guide ownership.
guide = read("app/(tabs)/guide.tsx")
for marker in (
    'let guideSessionGroup = "All"',
    "let guideSessionChannelId: string | null = null",
    "releaseGuideSlidingCache();",
    "setPreviewId(null);",
    "setViewportGuideChannelIds(null);",
):
    if marker not in guide:
        critical.append(f"Guide hidden-tab restore/cleanup invariant missing: {marker}")

# Search owns native FTS only while its content is mounted; in-flight completion
# must still be cancelled on unmount.
search = read("app/(tabs)/search.tsx")
for marker in ("let cancelled = false", "return () => { cancelled = true; }", "searchNativeEpg"):
    if marker not in search:
        critical.append(f"Search FTS teardown invariant missing: {marker}")

# EPG Settings subscriptions must expose a cleanup callback so unmount removes
# source diagnostics listeners instead of receiving provider events under Player.
epg = read("app/(tabs)/epg-sources.tsx")
if "return subscribeSource(load);" not in epg:
    critical.append("EPG Settings source subscription does not clean up on tab unmount")

# Root maintenance is not tab-owned and therefore needs its own Player exclusion.
root = read("app/_layout.tsx")
if 'reminders.length === 0 || pathname?.startsWith("/player")' not in root:
    critical.append("root reminder cleanup can still wake during fullscreen playback")

# Source scheduler remains the only automatic provider-work owner and must not
# run while Player or Guide owns the foreground.
scheduler = read("src/components/SourceRefreshScheduler.tsx")
for marker in ('!pathname?.startsWith("/guide")', '!pathname?.startsWith("/player")'):
    if marker not in scheduler:
        critical.append(f"source scheduler foreground exclusion missing: {marker}")

report = Path("ci/code-interaction-audit-tab-lifecycle-report.txt")
report.write_text("\n".join([
    "CharmIPTV inactive-tab lifecycle/RAM scan",
    f"expected_tabs={len(ROUTES)}",
    f"focused_mount_gates={mounted}",
    f"critical_findings={len(critical)}",
    f"warnings={len(warnings)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
    "",
    "WARNINGS",
    *(warnings or ["none"]),
]) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
