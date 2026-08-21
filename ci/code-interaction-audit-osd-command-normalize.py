from pathlib import Path
import re

path = Path("frontend/app/player.tsx")
text = path.read_text(encoding="utf-8")

# Normalize the current player-owned OPEN_TRACKS command before the OSD
# consolidation pass. Older/current audit snapshots differ by local More-panel
# cleanup lines, so use semantic command boundaries instead of byte-for-byte
# source assumptions.
command_pattern = re.compile(
    r'''      if \(command === "OPEN_TRACKS"\) \{\n'''
    r'''(?:        .*\n)+?'''
    r'''        scheduleHide\(\);\n'''
    r'''      \}'''
)
command_replacement = '''      if (command === "OPEN_TRACKS") {\n        controlsRef.current = true;\n        setControls(true);\n        setChannelsOpen(false);\n        setTracksOpen(true);\n        overlayOpenerRef.current = null;\n        scheduleHide();\n        return;\n      }\n      if (command === "PREVIOUS_CHANNEL") {\n        returnToPreviousChannel();\n        return;\n      }\n      if (command === "SAVE_DIAGNOSTICS") {\n        saveAudioReportRef.current();\n      }'''

if 'if (command === "PREVIOUS_CHANNEL")' not in text:
    text, count = command_pattern.subn(command_replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"player Quick Actions command normalization expected one OPEN_TRACKS block, found {count}")

# Normalize the legacy local More button into the one global Player Quick
# Actions trigger. Channels and Audio/Subtitles remain subordinate player-owned
# surfaces; this button must not keep a second Actions panel owner alive.
button_replacement = '''              <Pressable\n                onPress={() => {\n                  setChannelsOpen(false);\n                  setTracksOpen(false);\n                  if (hideTimer.current) clearTimeout(hideTimer.current);\n                  emitTvQuickActions("player");\n                }}\n                style={({ focused }: any) => [styles.textControl, focused && styles.focused]}\n              >\n                <Ionicons name="ellipsis-horizontal" size={15} color="#fff" />\n                <Text style={styles.controlLabel}>Quick Actions</Text>\n              </Pressable>'''
if 'emitTvQuickActions("player")' not in text:
    button_pattern = re.compile(
        r'''              <Pressable\n'''
        r'''                ref=\{moreButtonRef\}\n'''
        r'''.*?'''
        r'''              </Pressable>''',
        re.DOTALL,
    )
    text, count = button_pattern.subn(button_replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"player Quick Actions button normalization expected one legacy More button, found {count}")

# The local More surface is gone. Remove every obsolete focus-ref line regardless
# of LF/CRLF or indentation so no dead Android TV focus target survives.
text = "\n".join(line for line in text.splitlines() if "moreFirstActionRef" not in line) + "\n"

path.write_text(text, encoding="utf-8")
print("player Quick Actions command/button bridge normalized")
