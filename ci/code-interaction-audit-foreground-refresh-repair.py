#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EPG = ROOT / "frontend/android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt"
PLAYLIST = ROOT / "frontend/android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one repair anchor, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# TiViMate-style ownership rule adapted to Charm: background EPG work yields
# when an interactive TV surface takes priority. EpgDatabase already guards each
# accepted staging batch/final swap. This raw-program check closes the sparse-feed
# gap where the lazy parser could otherwise scan a large XMLTV payload before it
# produced the next accepted batch.
replace_once(
    EPG,
    """              rawProgrammeCount += 1L\n              if (rawProgrammeCount % PROGRESS_PROGRAMME_INTERVAL == 0L) {\n""",
    """              rawProgrammeCount += 1L\n              if ((rawProgrammeCount and 0x1ffL) == 0L) {\n                val owner = TvRemoteModule.remoteContext\n                if (owner == \"guide\" || owner == \"player\" || owner == \"modal\") {\n                  throw IllegalStateException(\"EPG refresh deferred for active TV interaction\")\n                }\n              }\n              if (rawProgrammeCount % PROGRESS_PROGRAMME_INTERVAL == 0L) {\n""",
    "primary EPG raw-program ownership gate",
)

# Automatic playlist refresh is started only from safe screens in JS, but route
# ownership can change while a slow provider response is still being streamed.
# Check periodically while reading instead of waiting for the 90s transport
# deadline, preserving the previous last-good playlist in the caller.
replace_once(
    PLAYLIST,
    """        var firstLine = true\n        while (true) {\n          val rawLine = reader.readLine() ?: break\n          var line = rawLine.trim()\n""",
    """        var firstLine = true\n        var rawLineCount = 0L\n        while (true) {\n          val rawLine = reader.readLine() ?: break\n          rawLineCount += 1L\n          if ((rawLineCount and 0xffL) == 0L) {\n            val owner = TvRemoteModule.remoteContext\n            if (owner == \"guide\" || owner == \"player\" || owner == \"modal\") {\n              throw IllegalStateException(\"Playlist refresh deferred for active TV interaction\")\n            }\n          }\n          var line = rawLine.trim()\n""",
    "playlist streaming ownership gate",
)

print("Applied foreground refresh ownership repairs")
