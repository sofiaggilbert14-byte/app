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

# TiViMate-style top-level overlay ownership: Quick Actions immediately removes
# Guide page-key ownership, owns the semantic remote, and restores Guide only if
# the same modal still owns the context when it closes.
for required in (
    'DeviceEventEmitter.emit("CharmQuickActionsVisibility", true)',
    'DeviceEventEmitter.emit("CharmQuickActionsVisibility", false)',
    'if (nextContext === "guide") setGuideNavigationActive(false)',
    'setRemoteContext("modal")',
    'const restored = resetRemoteContextIfOwned("modal", restore)',
    'if (restored && restore === "guide") setGuideNavigationActive(true)',
):
    if required not in quick:
        critical.append(f"Quick Actions modal ownership missing: {required}")

# Guide must disarm preview and native canvas for every modal owner.
for required in (
    'const [quickActionsOpen, setQuickActionsOpen] = useState(false)',
    'DeviceEventEmitter.addListener("CharmQuickActionsVisibility"',
    '!!pinPromptGroup || quickActionsOpen || !isFocused ? null : previewId',
    '!activeProgram && !pinPromptGroup && !quickActionsOpen && !drawerOpen && !groupDrawerOpen',
    'if (quickActionsOpen || activeProgram || pinPromptGroup)',
):
    if required not in guide:
        critical.append(f"Guide modal disarm invariant missing: {required}")

# PIN must be a true modal transition, never a second focus owner stacked over
# the Guide group drawer. It synchronously claims modal input, tears down pending
# preview work, unmounts the drawer, owns Back, and restores the correct owner.
for required in (
    'const pinModalOwnedRef = useRef(false)',
    'const pinReturnToGroupsRef = useRef(false)',
    'const openPinPrompt = useCallback',
    'pinModalOwnedRef.current = true',
    'setGuideNavigationActive(false)',
    'setRemoteContext("modal")',
    'if (previewTimer.current)',
    'if (previewRecoverTimer.current)',
    'if (surfReleaseTimer.current)',
    'setPreviewId(null)',
    'setPreviewActionsFocused(false)',
    'if (returnToGroups) setGroupDrawerOpen(false)',
    'const closePinPrompt = useCallback',
    'setRemoteContext("guide_groups")',
    'setGroupDrawerOpen(true)',
    'resetRemoteContextIfOwned("modal", "guide")',
    'BackHandler.addEventListener("hardwareBackPress"',
    'closePinPrompt(true)',
    '!pinPromptGroup',
    'openPinPrompt(next, groupDrawerOpen)',
    'openPinPrompt(nextGroup, false)',
    'zIndex: 120, elevation: 120',
):
    if required not in guide:
        critical.append(f"Guide PIN serialized ownership missing: {required}")

if 'testID="guide-pin-overlay"' not in guide or 'trapFocusUp trapFocusDown trapFocusLeft trapFocusRight' not in guide:
    critical.append("Guide PIN focus trap is incomplete")

# Program Details is the same modal class of owner and must lower/restore the
# independent native Guide page-key flag together with semantic context.
for required in (
    'if (pathname?.startsWith("/guide")) setGuideNavigationActive(false)',
    'setRemoteContext("modal")',
    'const restored = resetRemoteContextIfOwned("modal", restore)',
    'if (restored && restore === "guide") setGuideNavigationActive(true)',
):
    if required not in program_modal:
        critical.append(f"Program Details modal ownership missing: {required}")

# MainActivity routes Channel/Page buttons from this independent flag. Every
# Guide overlay owner must therefore explicitly lower it while visible.
if 'TvRemoteModule.guideNavigationActive' not in main_activity or 'emitRemoteEvent("TvGuidePageKey", pageKey)' not in main_activity:
    critical.append("native Guide page-key ownership contract changed; manual audit required")

# Existing Guide drawers/program surfaces remain part of preview disarm.
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
