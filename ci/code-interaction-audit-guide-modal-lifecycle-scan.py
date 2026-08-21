from pathlib import Path
import sys

ROOT = Path("frontend")
critical: list[str] = []


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="replace")


quick = read("src/components/TvQuickActionsOverlay.tsx")
program_modal = read("src/components/ProgramModal.tsx")
guide = read("app/(tabs)/guide.tsx")
main_activity = read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt")

# A root Quick Actions modal must tell Guide to release preview/native focus while
# the modal owns the remote. Closing or unmounting restores eligibility.
for required in (
    'DeviceEventEmitter.emit("CharmQuickActionsVisibility", true)',
    'DeviceEventEmitter.emit("CharmQuickActionsVisibility", false)',
    'setRemoteContext("modal")',
):
    if required not in quick:
        critical.append(f"Quick Actions visibility/input lifecycle missing: {required}")

for required in (
    'const [quickActionsOpen, setQuickActionsOpen] = useState(false)',
    'DeviceEventEmitter.addListener("CharmQuickActionsVisibility"',
    '!!pinPromptGroup || quickActionsOpen || !isFocused ? null : previewId',
    '!activeProgram && !pinPromptGroup && !quickActionsOpen && !drawerOpen && !groupDrawerOpen',
):
    if required not in guide:
        critical.append(f"Guide modal disarm invariant missing: {required}")

# PIN is not merely a visual sheet. It must become a true modal key owner so
# Page/Channel buttons and held Select cannot operate the hidden Guide behind it.
for required in (
    'const pinModalOwnedRef = useRef(false)',
    'if (quickActionsOpen || activeProgram || pinPromptGroup)',
    'setGuideNavigationActive(false)',
    'pinModalOwnedRef.current = true',
    'setRemoteContext("modal")',
    'const fallback = groupDrawerOpen ? "guide_groups" : drawerOpen ? "main_drawer" : "guide"',
    'resetRemoteContextIfOwned("modal", fallback)',
    'setPreviewId(null)',
    'setPreviewActionsFocused(false)',
):
    if required not in guide:
        critical.append(f"Guide PIN/modal input ownership missing: {required}")

# The PIN focus trap must keep native Android focus inside the sheet while it
# owns the semantic remote context.
if 'testID="guide-pin-overlay"' not in guide or 'trapFocusUp trapFocusDown trapFocusLeft trapFocusRight' not in guide:
    critical.append("Guide PIN focus trap is incomplete")

# Program Details is another Guide/player modal and already owns semantic input;
# the Guide modal state machine must therefore disarm Guide page-key routing for
# activeProgram as well rather than allowing hidden channel-page movement.
for required in ('setRemoteContext("modal")', 'resetRemoteContextIfOwned("modal", restore)'):
    if required not in program_modal:
        critical.append(f"Program Details modal remote ownership regressed: {required}")

# MainActivity routes Channel/Page buttons from this independent flag. This is
# why every Guide overlay owner must explicitly lower the flag while visible.
if 'TvRemoteModule.guideNavigationActive' not in main_activity or 'emitRemoteEvent("TvGuidePageKey", pageKey)' not in main_activity:
    critical.append("native Guide page-key ownership contract changed; manual audit required")

# Drawers and program details must continue participating in preview disarm.
for required in ('drawerOpen || groupDrawerOpen', '!!activeProgram'):
    if required not in guide:
        critical.append(f"existing Guide overlay preview disarm regressed: {required}")

report = Path("ci/code-interaction-audit-guide-modal-lifecycle-report.txt")
report.write_text("\n".join([
    "CharmIPTV Guide modal/preview/input ownership scan",
    f"critical_findings={len(critical)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
]) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
