from pathlib import Path

# Player consumes safe remappable long-press actions.
path = Path('frontend/app/player.tsx')
text = path.read_text()
anchor = 'import { addTvKeyListener, addTvLongPressListener } from "@/src/utils/tvRemote";\n'
if anchor not in text: raise SystemExit('player remote import missing')
if 'useRemoteShortcutPreferences' not in text:
    text = text.replace(anchor, anchor + 'import { useRemoteShortcutPreferences } from "@/src/core/remoteShortcutPreferences";\n', 1)
anchor = '  const audioPreferences = useAudioTrackPreferences();\n'
if anchor not in text: raise SystemExit('player preference hook anchor missing')
if 'const remoteShortcuts = useRemoteShortcutPreferences();' not in text:
    text = text.replace(anchor, anchor + '  const remoteShortcuts = useRemoteShortcutPreferences();\n', 1)
old = '''    return addTvLongPressListener((key) => {\n      if (key === "DOWN") {\n        controlsRef.current = true;\n        setControls(true);\n        setChannelsOpen(true);\n        scheduleHide();\n        return;\n      }\n      if (key === "SELECT") revealControls({ claimChannelsFocus: true });\n    });\n  }, [isTV, revealControls, scheduleHide]);\n'''
new = '''    return addTvLongPressListener((key) => {\n      if (key === "DOWN") {\n        if (remoteShortcuts.longDown === "guide") {\n          goGuide();\n          return;\n        }\n        if (remoteShortcuts.longDown === "channels") {\n          controlsRef.current = true;\n          setControls(true);\n          setChannelsOpen(true);\n          scheduleHide();\n        }\n        return;\n      }\n      if (key === "SELECT") {\n        if (remoteShortcuts.longSelect === "guide") {\n          goGuide();\n          return;\n        }\n        if (remoteShortcuts.longSelect === "controls") revealControls({ claimChannelsFocus: true });\n      }\n    });\n  }, [goGuide, isTV, remoteShortcuts.longDown, remoteShortcuts.longSelect, revealControls, scheduleHide]);\n'''
if old not in text: raise SystemExit('player long press block missing')
text = text.replace(old,new,1)
path.write_text(text)

# Settings exposes safe mappings; directional arrows remain reserved for focus.
path = Path('frontend/app/(tabs)/settings.tsx')
text = path.read_text()
anchor = 'import { type LogoPriority, useLogoPriority } from "@/src/core/logoPreferences";\n'
if anchor not in text: raise SystemExit('settings logo import missing')
if 'remoteShortcutPreferences' not in text:
    text = text.replace(anchor, anchor + '''import {\n  type LongDownAction,\n  type LongSelectAction,\n  useRemoteShortcutPreferences,\n} from "@/src/core/remoteShortcutPreferences";\n''',1)
anchor = '  const [logoPriority, setLogoPriority] = useLogoPriority();\n'
if anchor not in text: raise SystemExit('settings hook anchor missing')
if 'const remoteShortcuts = useRemoteShortcutPreferences();' not in text:
    text = text.replace(anchor, anchor + '  const remoteShortcuts = useRemoteShortcutPreferences();\n',1)
anchor = '''                <ChoiceRow<PlaybackBufferProfile>\n                  label="Playback buffer"'''
controls = '''                <ChoiceRow<LongDownAction>\n                  label="Remote · Long Down"\n                  value={remoteShortcuts.longDown}\n                  options={[\n                    { label: "Open channel bar", value: "channels" },\n                    { label: "Open TV Guide", value: "guide" },\n                    { label: "No shortcut", value: "none" },\n                  ]}\n                  onChange={remoteShortcuts.setLongDown}\n                />\n                <ChoiceRow<LongSelectAction>\n                  label="Remote · Long OK/Select"\n                  value={remoteShortcuts.longSelect}\n                  options={[\n                    { label: "Show player controls", value: "controls" },\n                    { label: "Open TV Guide", value: "guide" },\n                    { label: "No shortcut", value: "none" },\n                  ]}\n                  onChange={remoteShortcuts.setLongSelect}\n                />\n                <Text style={styles.help}>Directional D-pad keys stay reserved for deterministic focus/navigation. Only safe long-press shortcuts are remappable.</Text>\n'''
if controls not in text:
    if anchor not in text: raise SystemExit('settings player control anchor missing')
    text = text.replace(anchor, controls + anchor,1)
path.write_text(text)

# Architecture checks.
path = Path('frontend/scripts/verify-overhaul-architecture.mjs')
text = path.read_text()
checks = '''\nrequireText("src/core/remoteShortcutPreferences.ts", "Directional", "remote shortcut preference file is malformed");\nrequireText("app/(tabs)/settings.tsx", "Remote · Long Down", "long-Down mapping setting is missing");\nrequireText("app/(tabs)/settings.tsx", "Remote · Long OK/Select", "long-Select mapping setting is missing");\nrequireText("app/player.tsx", "remoteShortcuts.longDown", "player does not consume configured long-Down action");\n'''
# Preference file intentionally doesn't contain Directional; use actual symbol instead.
checks = checks.replace('"Directional"', '"LongDownAction"')
if 'long-Down mapping setting is missing' not in text:
    text = text.replace('console.log("TiViMate architecture-overhaul conflict scan passed.");', checks + '\nconsole.log("TiViMate architecture-overhaul conflict scan passed.");')
path.write_text(text)
