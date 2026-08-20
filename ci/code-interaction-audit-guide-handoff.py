from pathlib import Path

path = Path("frontend/app/(tabs)/guide.tsx")
text = path.read_text(encoding="utf-8")
old = '''  const onGuideUpBoundary = useCallback(() => {\n    setPreviewActionsFocused(true);\n    requestAnimationFrame(() => focusGuidePreviewSurface());\n  }, []);'''
new = '''  const onGuideUpBoundary = useCallback(() => {\n    // Keep the native Guide active until Android confirms focus on a real\n    // preview action. GuidePreviewRail's onFocus owns the transition to\n    // previewActionsFocused=true; if this request misses during a route/decoder\n    // handoff, focus stays safely in the Guide instead of disappearing.\n    requestAnimationFrame(() => {\n      focusGuidePreviewSurface();\n    });\n  }, []);'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit("Guide Up-boundary handoff anchor not found")
path.write_text(text, encoding="utf-8")
