from pathlib import Path
import re

path = Path("frontend/app/player.tsx")
text = path.read_text(encoding="utf-8")

# Normalize the current player-owned OPEN_TRACKS command before the OSD
# consolidation pass. Older/current audit snapshots differ only by the local
# More-panel close line, so use the semantic command boundary instead of a
# brittle byte-for-byte source block.
pattern = re.compile(
    r'''      if \(command === "OPEN_TRACKS"\) \{\n'''
    r'''(?:        .*\n)+?'''
    r'''        scheduleHide\(\);\n'''
    r'''      \}'''
)
replacement = '''      if (command === "OPEN_TRACKS") {\n        controlsRef.current = true;\n        setControls(true);\n        setChannelsOpen(false);\n        setTracksOpen(true);\n        overlayOpenerRef.current = null;\n        scheduleHide();\n        return;\n      }\n      if (command === "PREVIOUS_CHANNEL") {\n        returnToPreviousChannel();\n        return;\n      }\n      if (command === "SAVE_DIAGNOSTICS") {\n        saveAudioReportRef.current();\n      }'''

if 'if (command === "PREVIOUS_CHANNEL")' not in text:
    text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"player Quick Actions command normalization expected one OPEN_TRACKS block, found {count}")

path.write_text(text, encoding="utf-8")
print("player Quick Actions command bridge normalized")
