from pathlib import Path

path = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt")
text = path.read_text(encoding="utf-8")

live_clock = "    private const val LIVE_CLOCK_TICK_MS = 30_000L\n"
while text.count(live_clock) > 1:
    text = text.replace(live_clock + live_clock, live_clock, 1)
if text.count(live_clock) != 1:
    raise SystemExit(f"expected exactly one LIVE_CLOCK_TICK_MS declaration, found {text.count(live_clock)}")

abs_import = "import kotlin.math.abs\n"
while text.count(abs_import) > 1:
    text = text.replace(abs_import + abs_import, abs_import, 1)
if text.count(abs_import) != 1:
    raise SystemExit(f"expected exactly one kotlin.math.abs import, found {text.count(abs_import)}")

path.write_text(text, encoding="utf-8")
