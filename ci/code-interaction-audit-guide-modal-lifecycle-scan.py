from pathlib import Path
import sys

ROOT = Path("frontend")
critical: list[str] = []

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="replace")

quick = read("src/components/TvQuickActionsOverlay.tsx")
guide = read("app/(tabs)/guide.tsx")

# A root Quick Actions modal must tell Guide to release preview/native focus while
# the modal owns the remote. Closing or unmounting the modal restores eligibility.
for required in (
    'DeviceEventEmitter.emit("CharmQuickActionsVisibility", true)',
    'DeviceEventEmitter.emit("CharmQuickActionsVisibility", false)',
):
    if required not in quick:
        critical.append(f"Quick Actions visibility lifecycle missing: {required}")
for required in (
    'const [quickActionsOpen, setQuickActionsOpen] = useState(false)',
    'DeviceEventEmitter.addListener("CharmQuickActionsVisibility"',
    '!!pinPromptGroup || quickActionsOpen || !isFocused ? null : previewId',
    '!activeProgram && !pinPromptGroup && !quickActionsOpen && !drawerOpen && !groupDrawerOpen',
):
    if required not in guide:
        critical.append(f"Guide modal disarm invariant missing: {required}")

# Drawers and program details already participate in the same preview-disarm rule.
for required in ('drawerOpen || groupDrawerOpen', '!!activeProgram'):
    if required not in guide:
        critical.append(f"existing Guide overlay preview disarm regressed: {required}")

report = Path("ci/code-interaction-audit-guide-modal-lifecycle-report.txt")
report.write_text("\n".join([
    "CharmIPTV Guide modal/preview ownership scan",
    f"critical_findings={len(critical)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
]) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
