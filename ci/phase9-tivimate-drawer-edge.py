from pathlib import Path

main = Path('frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt')
text = main.read_text(encoding='utf-8')
old = '''      val owned =\n        (context == "guide_groups" && boundaryKey != null) ||\n          (context == "main_drawer" && boundaryKey == "RIGHT")\n'''
new = '''      val owned =\n        (context == "guide_groups" && boundaryKey != null) ||\n          (context == "main_drawer" && boundaryKey == "RIGHT") ||\n          (context == "drawer_edge" && boundaryKey == "LEFT")\n'''
if old not in text:
    raise SystemExit('MainActivity owned-boundary block not found')
main.write_text(text.replace(old, new, 1), encoding='utf-8')

button = Path('frontend/src/components/PurpleDrawerButton.tsx')
text = button.read_text(encoding='utf-8')
text = text.replace(
    'import { addTvKeyListener } from "@/src/utils/tvRemote";',
    'import { addTvKeyListener, setRemoteContext } from "@/src/utils/tvRemote";',
    1,
)
old = '''  useEffect(() => {\n    if (!focused) return;\n    return addTvKeyListener((key) => {\n      if (key === "LEFT") open();\n    });\n  }, [focused, open]);\n'''
new = '''  useEffect(() => {\n    if (!focused) return;\n    // Declare this edge explicitly to the Activity-level router. Default TV\n    // pages do not mirror raw D-pad events into JS; the native router owns the\n    // LEFT boundary and emits exactly one semantic handoff while this control\n    // is focused.\n    setRemoteContext("drawer_edge");\n    const off = addTvKeyListener((key) => {\n      if (key === "LEFT") open();\n    });\n    return () => {\n      off();\n      setRemoteContext("default");\n    };\n  }, [focused, open]);\n'''
if old not in text:
    raise SystemExit('PurpleDrawerButton focus listener block not found')
button.write_text(text.replace(old, new, 1), encoding='utf-8')
