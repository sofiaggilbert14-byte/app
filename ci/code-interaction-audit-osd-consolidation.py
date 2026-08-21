from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")


def patch_remote() -> None:
    path = Path("frontend/src/utils/tvRemote.ts")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'export type PlayerQuickCommand = "OPEN_TRACKS" | "CYCLE_ASPECT";',
        'export type PlayerQuickCommand = "OPEN_TRACKS" | "CYCLE_ASPECT" | "PREVIOUS_CHANNEL" | "SAVE_DIAGNOSTICS";',
        "player quick command union",
    )
    helper = '''\n/** Open the same contextual Quick Actions owner used by native Long Select. */\nexport function emitTvQuickActions(context: TvQuickActionsContext): void {\n  DeviceEventEmitter.emit("TvRemoteQuickActions", context);\n}\n'''
    anchor = '''export function addTvQuickActionsListener(cb: (context: TvQuickActionsContext) => void): () => void {\n'''
    if helper not in text:
        pos = text.find(anchor)
        if pos < 0:
            raise SystemExit("quick actions listener anchor missing")
        # Place helper after listener implementation, before player command bridge.
        after = text.find("\n}\n", pos)
        if after < 0:
            raise SystemExit("quick actions listener end missing")
        after += 3
        text = text[:after] + helper + text[after:]
    path.write_text(text, encoding="utf-8")


def patch_global_quick_actions() -> None:
    path = Path("frontend/src/components/TvQuickActionsOverlay.tsx")
    text = path.read_text(encoding="utf-8")
    old = '''                <Action icon="calendar-outline" label="Open TV Guide" onPress={goGuide} />\n                <Action icon="resize-outline" label="Aspect ratio" value="Fit / Zoom / Stretch" onPress={() => runPlayerCommand("CYCLE_ASPECT")} />\n                <Action icon="musical-notes-outline" label="Audio / subtitles" value="Live tracks" onPress={() => runPlayerCommand("OPEN_TRACKS")} />\n                <Action icon="speedometer-outline" label="Playback buffer" value={bufferProfile.replace("_", " ")} onPress={() => setBufferProfile(nextValue(BUFFER_ORDER, bufferProfile))} />\n                <Action icon="play-circle-outline" label="Player engine" value={playerEngine === "default" ? "Auto" : playerEngine.toUpperCase()} onPress={() => setPlayerEngine(nextValue(ENGINE_ORDER, playerEngine))} />'''
    new = '''                <Action icon="return-up-back-outline" label="Previous channel" onPress={() => runPlayerCommand("PREVIOUS_CHANNEL")} />\n                <Action icon="calendar-outline" label="Open TV Guide" onPress={goGuide} />\n                <Action icon="resize-outline" label="Aspect ratio" value="Fit / Zoom / Stretch" onPress={() => runPlayerCommand("CYCLE_ASPECT")} />\n                <Action icon="musical-notes-outline" label="Audio / subtitles" value="Live tracks" onPress={() => runPlayerCommand("OPEN_TRACKS")} />\n                <Action icon="speedometer-outline" label="Playback buffer" value={bufferProfile.replace("_", " ")} onPress={() => { const next = nextValue(BUFFER_ORDER, bufferProfile); close(); requestAnimationFrame(() => setBufferProfile(next)); }} />\n                <Action icon="play-circle-outline" label="Player engine" value={playerEngine === "default" ? "Auto" : playerEngine.toUpperCase()} onPress={() => { const next = nextValue(ENGINE_ORDER, playerEngine); close(); requestAnimationFrame(() => setPlayerEngine(next)); }} />'''
    text = replace_once(text, old, new, "single global player actions")
    text = replace_once(
        text,
        '                <Action icon="options-outline" label="Playback compatibility" value="Advanced settings" onPress={openSettings} />\n                <Action icon="settings-outline" label="All Settings" onPress={openSettings} />',
        '                <Action icon="bug-outline" label="Diagnostics" value="Save player report" onPress={() => runPlayerCommand("SAVE_DIAGNOSTICS")} />\n                <Action icon="options-outline" label="Playback compatibility" value="Advanced settings" onPress={openSettings} />\n                <Action icon="settings-outline" label="All Settings" onPress={openSettings} />',
        "global diagnostics action",
    )
    path.write_text(text, encoding="utf-8")


def patch_player() -> None:
    path = Path("frontend/app/player.tsx")
    text = path.read_text(encoding="utf-8")
    text = text.replace("  ScrollView,\n", "", 1)
    text = replace_once(
        text,
        'import { addPlayerQuickCommandListener, addTvKeyListener, addTvLongPressListener, addTvShortcutListener, resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";',
        'import { addPlayerQuickCommandListener, addTvKeyListener, addTvLongPressListener, addTvShortcutListener, emitTvQuickActions, resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";',
        "player quick actions trigger import",
    )
    text = replace_once(
        text,
        '  const [playerOverlay, setPlayerOverlay] = useState<"channels" | "tracks" | "more" | null>(null);',
        '  const [playerOverlay, setPlayerOverlay] = useState<"channels" | "tracks" | null>(null);',
        "player subordinate overlay type",
    )
    text = text.replace('  const moreOpen = playerOverlay === "more";\n', '', 1)
    text = replace_once(
        text,
        '  const setOverlayOpen = useCallback((name: "channels" | "tracks" | "more", next: React.SetStateAction<boolean>) => {',
        '  const setOverlayOpen = useCallback((name: "channels" | "tracks", next: React.SetStateAction<boolean>) => {',
        "player subordinate overlay setter",
    )
    text = text.replace('  const setMoreOpen = useCallback((next: React.SetStateAction<boolean>) => setOverlayOpen("more", next), [setOverlayOpen]);\n', '', 1)
    text = text.replace('  const moreButtonRef = useRef<any>(null);\n', '', 1)
    text = text.replace('  const moreFirstActionRef = useRef<any>(null);\n', '', 1)
    if 'const saveAudioReportRef = useRef<() => void>(() => undefined);' not in text:
        text = replace_once(text, '  const overlayOpenerRef = useRef<any>(null);', '  const overlayOpenerRef = useRef<any>(null);\n  const saveAudioReportRef = useRef<() => void>(() => undefined);', "diagnostics command ref")
    text = text.replace('      setMoreOpen(false);\n', '', 4)
    text = text.replace(', setMoreOpen', '', 10)
    text = text.replace('setMoreOpen, ', '', 10)
    text = text.replace(', moreOpen', '', 10)
    text = text.replace('moreOpen, ', '', 10)

    # Extend player-owned command bridge.
    text = replace_once(
        text,
        '''      if (command === "OPEN_TRACKS") {\n        controlsRef.current = true;\n        setControls(true);\n        setChannelsOpen(false);\n        setTracksOpen(true);\n        overlayOpenerRef.current = null;\n        scheduleHide();\n      }''',
        '''      if (command === "OPEN_TRACKS") {\n        controlsRef.current = true;\n        setControls(true);\n        setChannelsOpen(false);\n        setTracksOpen(true);\n        overlayOpenerRef.current = null;\n        scheduleHide();\n        return;\n      }\n      if (command === "PREVIOUS_CHANNEL") {\n        returnToPreviousChannel();\n        return;\n      }\n      if (command === "SAVE_DIAGNOSTICS") {\n        saveAudioReportRef.current();\n      }''',
        "player quick command ownership",
    )
    # Add previous-channel dependency if needed.
    text = text.replace(
        '  }, [cycleScaleMode, isTV, scheduleHide, setChannelsOpen, setTracksOpen]);',
        '  }, [cycleScaleMode, isTV, returnToPreviousChannel, scheduleHide, setChannelsOpen, setTracksOpen]);',
        1,
    )

    # Remove local More focus effect.
    local_focus = '''\n  useEffect(() => {\n    if (!moreOpen || !isTV) return;\n    const frame = requestAnimationFrame(() => requestNativeFocus(moreFirstActionRef.current));\n    return () => cancelAnimationFrame(frame);\n  }, [isTV, moreOpen]);\n'''
    text = text.replace(local_focus, "\n", 1)

    # Back now only owns tracks/channels; global Quick Actions owns its own Back handler.
    more_back = '''      if (moreOpen) {\n        closeOverlayAndRestoreFocus();\n        scheduleHide();\n        return true;\n      }\n'''
    text = text.replace(more_back, "", 1)

    # Bind diagnostics ref after the callback exists.
    diag_end = '''  }, [channelMeta?.name, failReason, showNotice]);\n\n  const goGuide'''
    diag_new = '''  }, [channelMeta?.name, failReason, showNotice]);\n  saveAudioReportRef.current = () => { void saveAudioReport(); };\n\n  const goGuide'''
    text = replace_once(text, diag_end, diag_new, "diagnostics command binding")

    # Replace local More button with single global Actions owner trigger.
    old_button = '''              <Pressable\n                ref={moreButtonRef}\n                onPress={() => {\n                  overlayOpenerRef.current = moreButtonRef.current;\n                  setChannelsOpen(false);\n                  setTracksOpen(false);\n                  setMoreOpen((value) => !value);\n                  scheduleHide();\n                }}\n                style={({ focused }: any) => [styles.textControl, moreOpen && styles.controlActive, focused && styles.focused]}\n              >\n                <Ionicons name="ellipsis-horizontal" size={15} color="#fff" />\n                <Text style={styles.controlLabel}>More</Text>\n              </Pressable>'''
    new_button = '''              <Pressable\n                onPress={() => {\n                  setChannelsOpen(false);\n                  setTracksOpen(false);\n                  if (hideTimer.current) clearTimeout(hideTimer.current);\n                  emitTvQuickActions("player");\n                }}\n                style={({ focused }: any) => [styles.textControl, focused && styles.focused]}\n              >\n                <Ionicons name="ellipsis-horizontal" size={15} color="#fff" />\n                <Text style={styles.controlLabel}>Quick Actions</Text>\n              </Pressable>'''
    text = replace_once(text, old_button, new_button, "single player actions button")

    # Remove duplicate local More panel completely.
    start = text.find('            {moreOpen ? (\n              <ScrollView')
    end_marker = '            {tracksOpen ? ('
    if start >= 0:
        end = text.find(end_marker, start)
        if end < 0:
            raise SystemExit("local More panel end marker missing")
        text = text[:start] + text[end:]
    elif 'morePanel' in text and 'Previous channel' in text:
        raise SystemExit("local More panel shape changed")

    # Remove dead styles.
    text = text.replace('  morePanel: { maxHeight: 190, marginTop: 6, borderRadius: radius.sm, backgroundColor: "rgba(16,16,30,0.94)" },\n', '', 1)
    text = text.replace('  morePanelContent: { padding: 8, gap: 4 },\n', '', 1)
    path.write_text(text, encoding="utf-8")


patch_remote()
patch_global_quick_actions()
patch_player()
print("single player Quick Actions owner repair applied")
