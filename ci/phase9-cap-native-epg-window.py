from pathlib import Path

path = Path("frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt")
text = path.read_text(encoding="utf-8")
old = "    private const val GUIDE_WINDOW_MS = 72L * 60L * 60L * 1000L\n"
new = "    // TiViMate-style bounded active-window retention: keep at most the largest\n    // user-selectable Guide horizon in the native XMLTV index. The UI defaults\n    // to 12h and can opt into 24h; retaining 72h here only increases parse/disk\n    // work and does not improve the visible Guide.\n    private const val GUIDE_WINDOW_MS = 24L * 60L * 60L * 1000L\n"
if old not in text:
    raise SystemExit("native EPG forward-window constant not found")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")

# Regression: default visible Guide is 12h, native retention never exceeds the
# largest explicit 24h user option.
test = Path("frontend/tests/guideWindowPolicy.test.mjs")
test.write_text('''import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst store = fs.readFileSync(new URL("../src/store.tsx", import.meta.url), "utf8");\nconst native = fs.readFileSync(new URL("../android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt", import.meta.url), "utf8");\nassert.match(store, /DEFAULT_GUIDE_WINDOW_HOURS = readGuideWindowHours\\(process\\.env\\.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 12\\)/);\nassert.match(store, /n === 6 \\|\\| n === 8 \\|\\| n === 12 \\|\\| n === 24/);\nassert.match(native, /GUIDE_WINDOW_MS = 24L \\* 60L \\* 60L \\* 1000L/);\nassert.doesNotMatch(native, /GUIDE_WINDOW_MS = 72L/);\nconsole.log("guide window policy regression: ok");\n''', encoding="utf-8")

runner = Path("frontend/tests/run-tests.mjs")
r = runner.read_text(encoding="utf-8")
entry = 'import "./guideWindowPolicy.test.mjs";\n'
if entry not in r:
    r += entry
    runner.write_text(r, encoding="utf-8")

print("Native EPG forward window capped to 24h; visible Guide default remains 12h.")
