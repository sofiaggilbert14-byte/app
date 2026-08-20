from pathlib import Path

patch_path = Path("frontend/patches/expo-video+3.0.16.patch")
text = patch_path.read_text(encoding="utf-8")

old_comment = "// for every VideoSource. Short socket timeouts let the buffering watchdog\n// recover a hung provider connection instead of waiting tens of seconds."
new_comment = "// for every VideoSource. Keep connect failure detection fast, but give live\n// segment/body reads enough jitter tolerance that a brief provider stall does\n// not abort an otherwise healthy long-running IPTV session. The JS playback\n// clock watchdog remains responsible for recovering a genuinely frozen decoder."
text = text.replace(old_comment, new_comment)

old_timeout = ".readTimeout(5, TimeUnit.SECONDS)"
new_timeout = ".readTimeout(30, TimeUnit.SECONDS)"
if old_timeout not in text and new_timeout not in text:
    raise SystemExit("shared OkHttp read timeout block not found")
text = text.replace(old_timeout, new_timeout)
patch_path.write_text(text, encoding="utf-8")

player_path = Path("frontend/app/player.tsx")
player = player_path.read_text(encoding="utf-8")
old_commit = '''      const pending = pendingChannelIdRef.current;\n      channelIdRef.current = pending;\n      setChannelId(pending);'''
new_commit = '''      const pending = pendingChannelIdRef.current;\n      // Strip focus updates the visible channel before its decoder is armed.\n      // Preserve the actually tuned channel at commit time so Previous channel\n      // remains correct after a debounced strip-based zap. Next/Prev already\n      // updates this history earlier, so the equality guard keeps that path intact.\n      const previous = channelIdRef.current;\n      if (previous && previous !== pending) previousChannelIdRef.current = previous;\n      channelIdRef.current = pending;\n      setChannelId(pending);'''
if old_commit in player:
    player = player.replace(old_commit, new_commit, 1)
elif "Preserve the actually tuned channel at commit time" not in player:
    raise SystemExit("player debounced commit anchor not found")
player_path.write_text(player, encoding="utf-8")

native_guide_path = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt")
native_guide = native_guide_path.read_text(encoding="utf-8")
while "import kotlin.math.abs\nimport kotlin.math.abs\n" in native_guide:
    native_guide = native_guide.replace(
        "import kotlin.math.abs\nimport kotlin.math.abs\n",
        "import kotlin.math.abs\n",
    )
if native_guide.count("import kotlin.math.abs\n") != 1:
    raise SystemExit("NativeGuideView abs import normalization failed")
native_guide_path.write_text(native_guide, encoding="utf-8")

activity_path = Path("frontend/android/app/src/main/java/com/charmiptv/app/MainActivity.kt")
activity = activity_path.read_text(encoding="utf-8")
old_owner = '(context == "guide_groups" && boundaryKey != null)'
new_owner = '(context == "guide_groups" && (boundaryKey == "LEFT" || boundaryKey == "RIGHT"))'
if old_owner in activity:
    activity = activity.replace(old_owner, new_owner, 1)
elif new_owner not in activity:
    raise SystemExit("guide groups native boundary owner anchor not found")
activity_path.write_text(activity, encoding="utf-8")

groups_path = Path("frontend/src/components/PurpleGuideGroupDrawer.tsx")
groups = groups_path.read_text(encoding="utf-8")
groups = groups.replace(
    "// The groups drawer owns horizontal/back remote actions. Up/Down and OK stay",
    "// The groups drawer owns horizontal remote actions. BACK stays with the",
    1,
)
groups = groups.replace(
    "// with Android's native focus engine inside the drawer, so only one layer\n    // responds to a physical key at a time.",
    "// Guide Back hierarchy so each drawer transition keeps its deliberate\n    // double-Back gesture. Up/Down and OK stay with Android native focus.",
    1,
)
old_back = '      if (key === "LEFT" || key === "BACK") {'
new_back = '      if (key === "LEFT") {'
if old_back in groups:
    groups = groups.replace(old_back, new_back, 1)
elif new_back not in groups:
    raise SystemExit("Guide Groups BACK ownership anchor not found")
groups_path.write_text(groups, encoding="utf-8")
