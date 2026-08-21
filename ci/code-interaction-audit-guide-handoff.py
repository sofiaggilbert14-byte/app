from pathlib import Path

GUIDE = Path("frontend/app/(tabs)/guide.tsx")
RAIL = Path("frontend/src/components/GuidePreviewRail.tsx")
HANDOFF_TEST = Path("frontend/tests/guideActionHandoff.test.mjs")
PLAYER_FOCUS_TEST = Path("frontend/tests/playerAndFocus.test.mjs")
SHELL_TEST = Path("frontend/tests/guideShellPolish.test.mjs")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} anchor not found")
    return text.replace(old, new, 1)


# RC.5 had a reliable explicit TV preferred-focus claim when the native Guide
# handed Up to the six preview actions. Keep that interaction pattern, but make
# it one-shot: the current Guide stays active until Android confirms a real
# Pressable focus event, so a missed handoff cannot strand focus or touch the
# decoder/player lifecycle.
rail = RAIL.read_text(encoding="utf-8")
rail = replace_once(
    rail,
    'import React, { useCallback, useMemo, useRef } from "react";',
    'import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";',
    "GuidePreviewRail React hooks",
)
rail = replace_once(
    rail,
    '  onActionsFocusChange: (focused: boolean) => void;\n  guideFocusTag?: number | null;',
    '  onActionsFocusChange: (focused: boolean) => void;\n  focusRequestToken: number;\n  guideFocusTag?: number | null;',
    "GuidePreviewRail focus token prop",
)
rail = replace_once(
    rail,
    '  onOpenDrawer,\n  onActionsFocusChange,\n  guideFocusTag,',
    '  onOpenDrawer,\n  onActionsFocusChange,\n  focusRequestToken,\n  guideFocusTag,',
    "GuidePreviewRail focus token destructure",
)
rail = replace_once(
    rail,
    '  const showFocus = usePreviewFocusNode("show-preview");\n  const nowDate = useMemo(() => new Date(now), [now]);',
    '  const showFocus = usePreviewFocusNode("show-preview");\n  const [preferPlayFocus, setPreferPlayFocus] = useState(false);\n  useEffect(() => {\n    if (focusRequestToken <= 0) return;\n    setPreferPlayFocus(true);\n    const timer = setTimeout(() => setPreferPlayFocus(false), 320);\n    return () => clearTimeout(timer);\n  }, [focusRequestToken]);\n  const nowDate = useMemo(() => new Date(now), [now]);',
    "GuidePreviewRail one-shot focus claim",
)
rail = replace_once(
    rail,
    '            ref={playFocus.setRef}\n            disabled={!channel}',
    '            ref={playFocus.setRef}\n            hasTVPreferredFocus={preferPlayFocus}\n            disabled={!channel}',
    "GuidePreviewRail Play preferred focus",
)
RAIL.write_text(rail, encoding="utf-8")


guide = GUIDE.read_text(encoding="utf-8")
guide = replace_once(
    guide,
    '  onOpenDrawer,\n  onActionsFocusChange,\n  guideFocusTag,',
    '  onOpenDrawer,\n  onActionsFocusChange,\n  focusRequestToken,\n  guideFocusTag,',
    "GuideSelectionPreview focus token destructure",
)
guide = replace_once(
    guide,
    '  onOpenDrawer: () => void;\n  onActionsFocusChange: (focused: boolean) => void;\n  guideFocusTag?: number | null;',
    '  onOpenDrawer: () => void;\n  onActionsFocusChange: (focused: boolean) => void;\n  focusRequestToken: number;\n  guideFocusTag?: number | null;',
    "GuideSelectionPreview focus token type",
)
guide = replace_once(
    guide,
    '      onOpenDrawer={onOpenDrawer}\n      onActionsFocusChange={onActionsFocusChange}\n      guideFocusTag={guideFocusTag}',
    '      onOpenDrawer={onOpenDrawer}\n      onActionsFocusChange={onActionsFocusChange}\n      focusRequestToken={focusRequestToken}\n      guideFocusTag={guideFocusTag}',
    "GuideSelectionPreview rail focus token pass",
)
guide = replace_once(
    guide,
    '  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");\n  const [previewActionsFocused, setPreviewActionsFocused] = useState(false);\n  const [nativeGuideFocusTag, setNativeGuideFocusTag] = useState<number | null>(null);',
    '  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");\n  const [previewActionsFocused, setPreviewActionsFocused] = useState(false);\n  const [previewFocusRequestToken, setPreviewFocusRequestToken] = useState(0);\n  const [nativeGuideFocusTag, setNativeGuideFocusTag] = useState<number | null>(null);',
    "Guide preview focus request state",
)
old_boundary = '''  const onGuideUpBoundary = useCallback(() => {\n    // Keep the native Guide active until Android confirms focus on a real\n    // preview action. GuidePreviewRail's onFocus owns the transition to\n    // previewActionsFocused=true; if this request misses during a route/decoder\n    // handoff, focus stays safely in the Guide instead of disappearing.\n    requestAnimationFrame(() => {\n      focusGuidePreviewSurface();\n    });\n  }, []);'''
new_boundary = '''  const onGuideUpBoundary = useCallback(() => {\n    // RC.5 used a short preferred-focus claim for this boundary. Restore that\n    // reliable TV behavior without restoring its old playback lifecycle: the\n    // native Guide remains active until a real action receives Android focus.\n    setPreviewFocusRequestToken((value) => value + 1);\n    requestAnimationFrame(() => {\n      focusGuidePreviewSurface();\n    });\n  }, []);'''
guide = replace_once(guide, old_boundary, new_boundary, "Guide Up-boundary handoff")
guide = replace_once(
    guide,
    '              onOpenDrawer={openDrawerFromPreview}\n              onActionsFocusChange={setPreviewActionsFocused}\n              guideFocusTag={nativeGuideFocusTag}',
    '              onOpenDrawer={openDrawerFromPreview}\n              onActionsFocusChange={setPreviewActionsFocused}\n              focusRequestToken={previewFocusRequestToken}\n              guideFocusTag={nativeGuideFocusTag}',
    "GuideSelectionPreview parent focus token pass",
)
GUIDE.write_text(guide, encoding="utf-8")


# The previous regression contracts intentionally prohibited preferred focus
# after a soft-only handoff experiment. The real RC.5 behavior is our functional
# reference now, so require the safer bounded form instead: one explicit token,
# a 320 ms Play claim, no direct native-Guide deactivation, and Down returning
# only after the sixth action.
test = HANDOFF_TEST.read_text(encoding="utf-8")
test = replace_once(
    test,
    '  assert.match(boundary, /focusGuidePreviewSurface\\(\\)/);\n  assert.doesNotMatch(boundary, /setPreviewActionsFocused\\(true\\)/);\n  assert.match(rail, /onActionsFocusChange\\(true\\)/);',
    '  assert.match(boundary, /setPreviewFocusRequestToken\\(\\(value\\) => value \\+ 1\\)/);\n  assert.match(boundary, /focusGuidePreviewSurface\\(\\)/);\n  assert.doesNotMatch(boundary, /setPreviewActionsFocused\\(true\\)/);\n  assert.match(rail, /const \\[preferPlayFocus, setPreferPlayFocus\\] = useState\\(false\\)/);\n  assert.match(rail, /hasTVPreferredFocus=\\{preferPlayFocus\\}/);\n  assert.match(rail, /setTimeout\\(\\(\\) => setPreferPlayFocus\\(false\\), 320\\)/);\n  assert.match(rail, /onActionsFocusChange\\(true\\)/);',
    "Guide action handoff regression assertions",
)
HANDOFF_TEST.write_text(test, encoding="utf-8")

player_focus = PLAYER_FOCUS_TEST.read_text(encoding="utf-8")
player_focus = replace_once(
    player_focus,
    '  assert.doesNotMatch(rail, /hasTVPreferredFocus=\\{preferPlayFocus\\}/);',
    '  assert.match(rail, /hasTVPreferredFocus=\\{preferPlayFocus\\}/);\n  assert.match(rail, /setTimeout\\(\\(\\) => setPreferPlayFocus\\(false\\), 320\\)/);',
    "six-action strip bounded preferred focus contract",
)
PLAYER_FOCUS_TEST.write_text(player_focus, encoding="utf-8")

shell_test = SHELL_TEST.read_text(encoding="utf-8")
shell_test = replace_once(
    shell_test,
    '  assert.doesNotMatch(guide, /setPreviewFocusRequestToken/);\n  assert.doesNotMatch(preview, /hasTVPreferredFocus=\\{preferPlayFocus\\}/);',
    '  assert.match(guide, /setPreviewFocusRequestToken\\(\\(value\\) => value \\+ 1\\)/);\n  assert.match(guide, /focusRequestToken=\\{previewFocusRequestToken\\}/);\n  assert.match(preview, /hasTVPreferredFocus=\\{preferPlayFocus\\}/);\n  assert.match(preview, /setTimeout\\(\\(\\) => setPreferPlayFocus\\(false\\), 320\\)/);',
    "Guide top-strip bounded RC.5 focus contract",
)
SHELL_TEST.write_text(shell_test, encoding="utf-8")

print("RC.5 Guide action handoff restored with current single-owner playback lifecycle")
