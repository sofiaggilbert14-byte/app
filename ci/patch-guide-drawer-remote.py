from pathlib import Path

path = Path("frontend/app/(tabs)/guide.tsx")
text = path.read_text()

# Remove now-obsolete native Back-target bookkeeping and preview-left handoff imports.
text = text.replace('import { requestNativeFocus } from "@/src/utils/tvFocus";\n', '')
text = text.replace('  focusGuidePreviewSurface,\n', '')

old = '''  const guideFocusRegionRef = useRef<"channel" | "program">("program");\n  const channelLogoNodeRef = useRef<unknown>(null);\n  const onGuideBackTarget = useCallback((region: "channel" | "program", logoNode: unknown) => {\n    guideFocusRegionRef.current = region;\n    if (logoNode) channelLogoNodeRef.current = logoNode;\n  }, []);\n\n  // Back in the guide: step to the channel logo first. Only at the left edge does\n  // Back defer to the shell double-Back drawer arm — never opens on a single press.\n  useTvBackHandler(\n    useCallback(() => {\n      if (drawerOpen || activeProgram) return false;\n      if (guideFocusRegionRef.current === "program" && channelLogoNodeRef.current) {\n        requestNativeFocus(channelLogoNodeRef.current);\n        guideFocusRegionRef.current = "channel";\n        return true;\n      }\n      return false;\n    }, [activeProgram, drawerOpen]),\n  );\n'''
new = '''  // TiViMate-style Guide Back behavior: when the Guide owns the remote and no\n  // modal is blocking, one Back opens the group/navigation drawer immediately.\n  // The drawer itself consumes the next Back to close and Guide focus is restored\n  // through the existing focusClaimNonce/session-channel path.\n  useTvBackHandler(\n    useCallback(() => {\n      if (drawerOpen || activeProgram) return false;\n      openDrawer();\n      return true;\n    }, [activeProgram, drawerOpen, openDrawer]),\n  );\n'''
if old not in text:
    raise SystemExit("guide Back routing block not found")
text = text.replace(old, new, 1)

old = '''  const onGuideLeftBoundary = useCallback(() => {\n    // The preview/details/actions panel is the Guide's only left neighbor.\n    focusGuidePreviewSurface();\n  }, []);\n'''
new = '''  const onGuideLeftBoundary = useCallback(() => {\n    // From the left-most channel/logo column, another Left enters the drawer.\n    // Do not focus the preview rail first: group navigation is the Guide's\n    // deterministic left boundary and the active group receives drawer focus.\n    if (!drawerOpen && !activeProgram) openDrawer();\n  }, [activeProgram, drawerOpen, openDrawer]);\n'''
if old not in text:
    raise SystemExit("guide left-boundary block not found")
text = text.replace(old, new, 1)

# TimelineGrid no longer needs to report Back target state; Back is screen-level.
text = text.replace('                  onBackTargetChange={onGuideBackTarget}\n', '')

# Update comments that still describe the preview rail as the left focus destination.
text = text.replace(
'''                  // Preview is the native Left neighbor; the closed drawer has\n                  // no mounted focus tree and therefore needs no self-lock.\n                  lockLeftEdge={false}\n''',
'''                  // Left from the channel boundary opens the drawer; keep the\n                  // row edge unlocked so the boundary callback owns navigation.\n                  lockLeftEdge={false}\n''',
)

path.write_text(text)

# Extend architecture verification so this behavior cannot regress quietly.
path = Path("frontend/scripts/verify-overhaul-architecture.mjs")
text = path.read_text()
checks = '''\n// Guide remote navigation must expose the drawer predictably.\nrequireText("app/(tabs)/guide.tsx", "one Back opens the group/navigation drawer immediately", "Guide single-Back drawer behavior is missing");\nrequireText("app/(tabs)/guide.tsx", "another Left enters the drawer", "Guide left boundary no longer enters the drawer");\nforbidText("app/(tabs)/guide.tsx", "onBackTargetChange={onGuideBackTarget}", "obsolete Guide Back-target tracking returned");\nforbidText("app/(tabs)/guide.tsx", "focusGuidePreviewSurface();", "Guide left boundary detours through preview rail again");\n'''
if 'Guide single-Back drawer behavior is missing' not in text:
    marker = '\nconsole.log("TiViMate architecture-overhaul conflict scan passed.");\n'
    if marker not in text:
        raise SystemExit("architecture verifier console marker not found")
    text = text.replace(marker, checks + marker, 1)
path.write_text(text)
