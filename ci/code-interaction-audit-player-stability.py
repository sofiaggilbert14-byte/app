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
