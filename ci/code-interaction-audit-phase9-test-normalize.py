from pathlib import Path

path = Path("frontend/tests/guideLiveClock.test.mjs")
text = path.read_text(encoding="utf-8")
text = text.replace(
    'const native = await text("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");',
    'const native = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");',
)
path.write_text(text, encoding="utf-8")
print("Phase 9 live-clock regression test helper normalized")
