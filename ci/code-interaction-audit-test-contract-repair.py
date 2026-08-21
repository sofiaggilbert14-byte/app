#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one old contract, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


player_test = ROOT / "frontend/tests/playerAndFocus.test.mjs"
replace_once(
    player_test,
    '''test("player More panel owns focus and scrolls all actions", async () => {\n  const player = await source("app/player.tsx");\n  assert.match(player, /moreFirstActionRef/);\n  assert.match(player, /requestNativeFocus\\(moreFirstActionRef\\.current\\)/);\n  assert.match(player, /style=\\{styles\\.morePanel\\}/);\n  assert.match(player, /nestedScrollEnabled/);\n});''',
    '''test("player delegates More to the single global Quick Actions owner", async () => {\n  const [player, overlay, remote] = await Promise.all([\n    source("app/player.tsx"),\n    source("src/components/TvQuickActionsOverlay.tsx"),\n    source("src/utils/tvRemote.ts"),\n  ]);\n  assert.match(player, /emitTvQuickActions\\("player"\\)/);\n  assert.match(remote, /export function emitTvQuickActions/);\n  assert.match(overlay, /PLAYER QUICK ACTIONS/);\n  assert.doesNotMatch(player, /moreFirstActionRef/);\n  assert.doesNotMatch(player, /styles\\.morePanel/);\n  assert.doesNotMatch(player, /playerOverlay.*"more"/);\n});''',
    "single Quick Actions player test",
)

guide_test = ROOT / "frontend/tests/guideActionHandoff.test.mjs"
replace_once(
    guide_test,
    '''test("Guide stays active until a preview action actually receives focus", async () => {\n  const [guide, rail] = await Promise.all([\n    source("app/(tabs)/guide.tsx"),\n    source("src/components/GuidePreviewRail.tsx"),\n  ]);\n  const boundary = guide.match(/const onGuideUpBoundary = useCallback\\([\\s\\S]*?\\n  \\}, \\[\\]\\);/)?.[0] || "";\n  assert.match(boundary, /focusGuidePreviewSurface\\(\\)/);\n  assert.doesNotMatch(boundary, /setPreviewActionsFocused\\(true\\)/);\n  assert.match(rail, /onActionsFocusChange\\(true\\)/);\n  assert.match(guide, /active=\\{isFocused && !activeProgram && !drawerOpen && !groupDrawerOpen && !previewActionsFocused\\}/);\n});''',
    '''test("Guide stays active through preview handoff but disarms every modal owner", async () => {\n  const [guide, rail, programModal] = await Promise.all([\n    source("app/(tabs)/guide.tsx"),\n    source("src/components/GuidePreviewRail.tsx"),\n    source("src/components/ProgramModal.tsx"),\n  ]);\n  const boundary = guide.match(/const onGuideUpBoundary = useCallback\\([\\s\\S]*?\\n  \\}, \\[\\]\\);/)?.[0] || "";\n  assert.match(boundary, /focusGuidePreviewSurface\\(\\)/);\n  assert.doesNotMatch(boundary, /setPreviewActionsFocused\\(true\\)/);\n  assert.match(rail, /onActionsFocusChange\\(true\\)/);\n  assert.match(guide, /active=\\{isFocused && !activeProgram && !pinPromptGroup && !quickActionsOpen && !drawerOpen && !groupDrawerOpen && !previewActionsFocused\\}/);\n  assert.match(guide, /previewId=\\{safePreviewMode === "off" \\|\\| drawerOpen \\|\\| groupDrawerOpen \\|\\| !!activeProgram \\|\\| !!pinPromptGroup \\|\\| quickActionsOpen \\|\\| !isFocused \\? null : previewId\\}/);\n  assert.match(guide, /const pinModalOwnedRef = useRef\\(false\\)/);\n  assert.match(guide, /if \\(quickActionsOpen \\|\\| activeProgram \\|\\| pinPromptGroup\\) \\{\\s*setGuideNavigationActive\\(false\\)/);\n  assert.match(guide, /pinModalOwnedRef\\.current = true[\\s\\S]*setRemoteContext\\("modal"\\)/);\n  assert.match(guide, /const fallback = groupDrawerOpen \\? "guide_groups" : drawerOpen \\? "main_drawer" : "guide"/);\n  assert.match(guide, /resetRemoteContextIfOwned\\("modal", fallback\\)/);\n  assert.match(programModal, /setRemoteContext\\("modal"\\)/);\n  assert.match(programModal, /resetRemoteContextIfOwned\\("modal", restore\\)/);\n});''',
    "Guide modal/preview/input ownership test",
)

print("Regression tests aligned with single-OSD and Guide modal input ownership contracts")
