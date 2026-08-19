from pathlib import Path

# StreamPlayer: add pause + scaling props, low-RAM-aware buffers, SurfaceView fullscreen.
p = Path('frontend/src/components/StreamPlayer.tsx')
s = p.read_text()
s = s.replace('import { usePlayerCompatibilityPreferences } from "@/src/core/playerCompatibilityPreferences";\n', 'import { usePlayerCompatibilityPreferences } from "@/src/core/playerCompatibilityPreferences";\nimport { shouldUseLowRamTuning, useDeviceMemoryProfile } from "@/src/core/deviceMemoryProfile";\n')
s = s.replace('export type StreamTrack = {\n', 'export type PlayerScaleMode = "fit" | "zoom" | "stretch";\n\nexport type StreamTrack = {\n')
s = s.replace('  bufferProfile?: PlaybackBufferProfile;\n};', '  bufferProfile?: PlaybackBufferProfile;\n  paused?: boolean;\n  scaleMode?: PlayerScaleMode;\n};')
s = s.replace('  bufferProfile = "balanced",\n}: EngineProps) {', '  bufferProfile = "balanced",\n  paused = false,\n  scaleMode = "fit",\n}: EngineProps) {', 1)
s = s.replace('  const playerCompat = usePlayerCompatibilityPreferences();\n  const initOptions = useMemo(() => {\n    const fullMs = bufferProfile === "low_latency" ? 900 : bufferProfile === "stable" ? 3200 : 1800;', '  const playerCompat = usePlayerCompatibilityPreferences();\n  const deviceMemory = useDeviceMemoryProfile();\n  const lowRam = shouldUseLowRamTuning(deviceMemory);\n  const initOptions = useMemo(() => {\n    const requestedMs = bufferProfile === "low_latency" ? 900 : bufferProfile === "stable" ? 3200 : 1800;\n    const fullMs = lowRam ? Math.min(requestedMs, 1800) : requestedMs;')
s = s.replace('    bufferProfile,\n    mode,', '    bufferProfile,\n    lowRam,\n    mode,', 1)
s = s.replace('      paused={false}\n      autoplay\n      autoAspectRatio\n      resizeMode="contain"', '      paused={paused}\n      autoplay={!paused}\n      autoAspectRatio={scaleMode !== "stretch"}\n      resizeMode={scaleMode === "zoom" ? "cover" : scaleMode === "stretch" ? "stretch" : "contain"}')

# ExpoStream signature (second occurrence).
needle = '  bufferProfile = "balanced",\n}: EngineProps) {'
pos = s.find(needle, s.find('function ExpoStream'))
if pos == -1:
    raise SystemExit('ExpoStream signature anchor missing')
s = s[:pos] + s[pos:].replace(needle, '  bufferProfile = "balanced",\n  paused = false,\n  scaleMode = "fit",\n}: EngineProps) {', 1)
s = s.replace('  const playerCompat = usePlayerCompatibilityPreferences();\n  useEffect(() => {', '  const playerCompat = usePlayerCompatibilityPreferences();\n  const deviceMemory = useDeviceMemoryProfile();\n  const lowRam = shouldUseLowRamTuning(deviceMemory);\n  useEffect(() => {', 1)
s = s.replace('      const full = profile === "low_latency"\n        ? {\n            preferredForwardBufferDuration: media3Audio === "ffmpeg" ? 2.0 : 1.5,\n            maxBufferBytes: (media3Audio === "ffmpeg" ? 36 : 28) * 1024 * 1024,\n          }\n        : profile === "stable"\n          // Cap Stable below the old 72MB ceiling — Fire TV sticks OOM when the\n          // guide preview + fullscreen decoder both retain large forward buffers.\n          ? { preferredForwardBufferDuration: 6, maxBufferBytes: 48 * 1024 * 1024 }\n          : {\n              preferredForwardBufferDuration: media3Audio === "ffmpeg" ? 3.5 : 3,\n              maxBufferBytes: (media3Audio === "ffmpeg" ? 56 : 48) * 1024 * 1024,\n            };', '      const full = profile === "low_latency"\n        ? {\n            preferredForwardBufferDuration: lowRam ? 1.2 : (media3Audio === "ffmpeg" ? 2.0 : 1.5),\n            maxBufferBytes: (lowRam ? 18 : (media3Audio === "ffmpeg" ? 36 : 28)) * 1024 * 1024,\n          }\n        : profile === "stable"\n          ? { preferredForwardBufferDuration: lowRam ? 3.5 : 6, maxBufferBytes: (lowRam ? 28 : 48) * 1024 * 1024 }\n          : {\n              preferredForwardBufferDuration: lowRam ? 2.2 : (media3Audio === "ffmpeg" ? 3.5 : 3),\n              maxBufferBytes: (lowRam ? 24 : (media3Audio === "ffmpeg" ? 56 : 48)) * 1024 * 1024,\n            };')
s = s.replace('    mode,\n    player,', '    lowRam,\n    mode,\n    player,', 1)
# Do not auto-play while paused after replace.
s = s.replace('          player.play();\n', '          if (!paused) player.play();\n', 1)
s = s.replace('  }, [blocked, emit, engine, headers, kind, mode, muted, player, sessionGeneration, sessionRole, setBlocked, uri]);', '  }, [blocked, emit, engine, headers, kind, mode, muted, paused, player, sessionGeneration, sessionRole, setBlocked, uri]);')
# Hot pause/resume without remount.
anchor = '  useEffect(() => {\n    try {\n      player.muted = muted;'
if anchor not in s:
    raise SystemExit('Expo mute effect anchor missing')
pause_effect = '  useEffect(() => {\n    if (!mediaReady || blocked) return;\n    try {\n      if (paused) player.pause();\n      else player.play();\n    } catch {}\n  }, [blocked, mediaReady, paused, player]);\n\n'
s = s.replace(anchor, pause_effect + anchor, 1)
s = s.replace('      contentFit="contain"\n      surfaceType={Platform.OS === "android" ? "textureView" : undefined}', '      contentFit={scaleMode === "zoom" ? "cover" : scaleMode === "stretch" ? "fill" : "contain"}\n      // Keep preview compositable above the Guide; fullscreen gets the cheaper hardware SurfaceView.\n      surfaceType={Platform.OS === "android" ? (mode === "preview" ? "textureView" : "surfaceView") : undefined}')
# Public StreamPlayer params and forwarding.
s = s.replace('  bufferProfile,\n}: Props) {', '  bufferProfile,\n  paused = false,\n  scaleMode = "fit",\n}: Props) {')
s = s.replace('        bufferProfile={effectiveBufferProfile}\n      />', '        bufferProfile={effectiveBufferProfile}\n        paused={paused}\n        scaleMode={scaleMode}\n      />', 1)
s = s.replace('      bufferProfile={effectiveBufferProfile}\n    />', '      bufferProfile={effectiveBufferProfile}\n      paused={paused}\n      scaleMode={scaleMode}\n    />', 1)
p.write_text(s)

# Player UI: real play/pause, stop, aspect cycle.
p = Path('frontend/app/player.tsx')
s = p.read_text()
s = s.replace('  type StreamTrack,\n} from "@/src/components/StreamPlayer";', '  type StreamTrack,\n  type PlayerScaleMode,\n} from "@/src/components/StreamPlayer";')
s = s.replace('  const [decoderArmed, setDecoderArmed] = useState(true);', '  const [decoderArmed, setDecoderArmed] = useState(true);\n  const [playbackPaused, setPlaybackPaused] = useState(false);\n  const [scaleMode, setScaleMode] = useState<PlayerScaleMode>("fit");')
s = s.replace('      setDecoderArmed(true);\n      setRetryToken((value) => value + 1);', '      setPlaybackPaused(false);\n      setDecoderArmed(true);\n      setRetryToken((value) => value + 1);', 1)
s = s.replace('    setChannelId(id);\n    addRecent(target);', '    setChannelId(id);\n    setPlaybackPaused(false);\n    addRecent(target);', 1)
# Add scale cycle callback before restartStream.
anchor = '  const restartStream = useCallback((clearCircuit: boolean) => {'
if anchor not in s:
    raise SystemExit('restartStream anchor missing')
insert = '''  const cycleScaleMode = useCallback(() => {\n    setScaleMode((current) => {\n      const next: PlayerScaleMode = current === "fit" ? "zoom" : current === "zoom" ? "stretch" : "fit";\n      showNotice(next === "fit" ? "Aspect: Fit" : next === "zoom" ? "Aspect: Zoom" : "Aspect: Stretch");\n      return next;\n    });\n    revealControls({ claimChannelsFocus: false });\n  }, [revealControls, showNotice]);\n\n'''
s = s.replace(anchor, insert + anchor, 1)
# Pass props to StreamPlayer.
s = s.replace('            textTrack={textTrackId}\n            onTracksAvailable=', '            textTrack={textTrackId}\n            paused={playbackPaused}\n            scaleMode={scaleMode}\n            onTracksAvailable=', 1)
# Replace fake hide control with real play/pause, add aspect and stop labels around controls.
old = '''              <Pressable\n                accessibilityLabel="Hide player controls"\n                onPress={() => {\n                  controlsRef.current = false;\n                  setControls(false);\n                  setChannelsOpen(false);\n                }}\n                style={({ focused }: any) => [styles.pauseControl, focused && styles.focused]}\n              >\n                <Ionicons name="eye-off-outline" size={18} color="#fff" />\n              </Pressable>'''
new = '''              <Pressable\n                accessibilityLabel={playbackPaused ? "Play stream" : "Pause stream"}\n                onPress={() => {\n                  setPlaybackPaused((value) => !value);\n                  revealControls({ claimChannelsFocus: false });\n                }}\n                style={({ focused }: any) => [styles.pauseControl, focused && styles.focused]}\n              >\n                <Ionicons name={playbackPaused ? "play" : "pause"} size={18} color="#fff" />\n              </Pressable>'''
if old not in s:
    raise SystemExit('fake hide control anchor missing')
s = s.replace(old, new, 1)
# Add aspect button after Audio/CC control.
needle = '''              <Pressable\n                onPress={() => setTracksOpen((value) => !value)}\n                style={({ focused }: any) => [styles.textControl, tracksOpen && styles.controlActive, focused && styles.focused]}\n              >\n                <Ionicons name="musical-notes-outline" size={15} color="#fff" />\n                <Text style={styles.controlLabel}>Audio/CC</Text>\n              </Pressable>'''
addition = needle + '''\n              <Pressable onPress={cycleScaleMode} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}>\n                <Ionicons name="resize-outline" size={15} color="#fff" />\n                <Text style={styles.controlLabel}>{scaleMode === "fit" ? "Fit" : scaleMode === "zoom" ? "Zoom" : "Stretch"}</Text>\n              </Pressable>'''
if needle not in s:
    raise SystemExit('Audio/CC anchor missing')
s = s.replace(needle, addition, 1)
# Make exit explicit Stop button instead of bare close icon.
old = '''              <Pressable onPress={stopAndExit} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}>\n                <Ionicons name="close" size={18} color="#fff" />\n              </Pressable>'''
new = '''              <Pressable onPress={stopAndExit} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}>\n                <Ionicons name="stop" size={15} color="#fff" />\n                <Text style={styles.controlLabel}>Stop</Text>\n              </Pressable>'''
if old not in s:
    raise SystemExit('exit button anchor missing')
s = s.replace(old, new, 1)
p.write_text(s)

# Extend architecture assertions.
p = Path('frontend/scripts/verify-overhaul-architecture.mjs')
s = p.read_text()
checks = '''\n// Player controls and playback-memory architecture.\nrequireText("src/components/StreamPlayer.tsx", "paused?: boolean", "player pause state is not wired through engines");\nrequireText("src/components/StreamPlayer.tsx", "mode === \\"preview\\" ? \\"textureView\\" : \\"surfaceView\\"", "fullscreen Media3 is not using SurfaceView");\nrequireText("src/components/StreamPlayer.tsx", "shouldUseLowRamTuning", "player buffers are not low-RAM adaptive");\nrequireText("app/player.tsx", "Pause stream", "real play/pause player control is missing");\nrequireText("app/player.tsx", ">Stop<", "explicit player Stop control is missing");\nrequireText("app/player.tsx", "cycleScaleMode", "aspect-ratio cycling is missing");\n'''
marker = 'console.log("TiViMate architecture-overhaul conflict scan passed.");'
if 'Player controls and playback-memory architecture.' not in s:
    s = s.replace(marker, checks + '\n' + marker)
p.write_text(s)
