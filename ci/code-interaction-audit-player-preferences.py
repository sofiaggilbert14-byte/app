from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def write(path: str, transform) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    target.write_text(transform(text), encoding="utf-8")


# Engine preference: an initial async storage read must never reinstall an old
# engine after Settings already selected a newer one.
def patch_engine(text: str) -> str:
    if "let mutationEpoch = 0;" not in text:
        text = replace_once(
            text,
            "let loadPromise: Promise<PlayerEnginePreference> | null = null;\nconst listeners",
            "let loadPromise: Promise<PlayerEnginePreference> | null = null;\nlet mutationEpoch = 0;\nconst listeners",
            "engine mutation epoch",
        )
    if "const loadEpoch = mutationEpoch;" not in text:
        text = replace_once(
            text,
            "  if (loadPromise) return loadPromise;\n\n  loadPromise = (async () => {",
            "  if (loadPromise) return loadPromise;\n  const loadEpoch = mutationEpoch;\n\n  loadPromise = (async () => {",
            "engine load epoch",
        )
    text = replace_once(
        text,
        '''    const stored = await storage.getItem<PlayerEnginePreference>(PLAYER_ENGINE_KEY, "vlc");\n    cachedPreference = stored === "vlc" || stored === "media3" ? stored : "default";\n    loaded = true;\n    return cachedPreference;''',
        '''    const stored = await storage.getItem<PlayerEnginePreference>(PLAYER_ENGINE_KEY, "vlc");\n    const next = stored === "vlc" || stored === "media3" ? stored : "default";\n    if (loaded || loadEpoch !== mutationEpoch) return cachedPreference;\n    cachedPreference = next;\n    loaded = true;\n    return cachedPreference;''',
        "engine stale hydration guard",
    )
    if "export async function setPlayerEnginePreference(value: PlayerEnginePreference): Promise<void> {\n  mutationEpoch += 1;" not in text:
        text = replace_once(
            text,
            "export async function setPlayerEnginePreference(value: PlayerEnginePreference): Promise<void> {\n  cachedPreference = value;",
            "export async function setPlayerEnginePreference(value: PlayerEnginePreference): Promise<void> {\n  mutationEpoch += 1;\n  cachedPreference = value;",
            "engine setter ownership",
        )
    return text


# Buffer profile follows the same ownership rule.
def patch_buffer(text: str) -> str:
    if "let mutationEpoch = 0;" not in text:
        text = replace_once(
            text,
            "let loadPromise: Promise<PlaybackBufferProfile> | null = null;\nconst listeners",
            "let loadPromise: Promise<PlaybackBufferProfile> | null = null;\nlet mutationEpoch = 0;\nconst listeners",
            "buffer mutation epoch",
        )
    if "const loadEpoch = mutationEpoch;" not in text:
        text = replace_once(
            text,
            "  if (loadPromise) return loadPromise;\n  loadPromise = storage.getItem<PlaybackBufferProfile>(KEY, \"stable\")",
            "  if (loadPromise) return loadPromise;\n  const loadEpoch = mutationEpoch;\n  loadPromise = storage.getItem<PlaybackBufferProfile>(KEY, \"stable\")",
            "buffer load epoch",
        )
    text = replace_once(
        text,
        '''    .then((stored) => {\n      value = normalize(stored);\n      loaded = true;\n      return value;\n    });''',
        '''    .then((stored) => {\n      const next = normalize(stored);\n      if (loaded || loadEpoch !== mutationEpoch) return value;\n      value = next;\n      loaded = true;\n      return value;\n    });''',
        "buffer stale hydration guard",
    )
    if "return [current, useCallback((next: PlaybackBufferProfile) => {\n    mutationEpoch += 1;" not in text:
        text = replace_once(
            text,
            "  return [current, useCallback((next: PlaybackBufferProfile) => {\n    value = normalize(next);",
            "  return [current, useCallback((next: PlaybackBufferProfile) => {\n    mutationEpoch += 1;\n    value = normalize(next);",
            "buffer setter ownership",
        )
    return text


# Codec/output preferences can remount the active engine. Prevent an old startup
# read from unexpectedly flipping those values after playback has already begun.
def patch_compat(text: str) -> str:
    if "let mutationEpoch = 0;" not in text:
        text = replace_once(
            text,
            "let loadPromise: Promise<Snapshot> | null = null;\nconst listeners",
            "let loadPromise: Promise<Snapshot> | null = null;\nlet mutationEpoch = 0;\nconst listeners",
            "compat mutation epoch",
        )
    if "const loadEpoch = mutationEpoch;" not in text:
        text = replace_once(
            text,
            "  if (loadPromise) return loadPromise;\n  loadPromise = (async () => {",
            "  if (loadPromise) return loadPromise;\n  const loadEpoch = mutationEpoch;\n  loadPromise = (async () => {",
            "compat load epoch",
        )
    text = replace_once(
        text,
        '''    cached = {\n      silentAudioFallback: silent !== false,\n      vlcAudioOutput: normalizeVlcAudio(vlcAudio),\n      vlcHardwareDecode: vlcHw !== false,\n      media3AudioMode: normalizeMedia3Audio(media3Audio),\n      media3Tunneling: !!media3Tunnel,\n    };\n    loaded = true;\n    return cached;''',
        '''    const resolvedVideoDecoder = normalizeVideoDecoder(videoDecoder, vlcHw !== false);\n    const next: Snapshot = {\n      silentAudioFallback: silent !== false,\n      vlcAudioOutput: normalizeVlcAudio(vlcAudio),\n      vlcHardwareDecode: resolvedVideoDecoder === "device",\n      videoDecoderMode: resolvedVideoDecoder,\n      media3AudioMode: normalizeMedia3Audio(media3Audio),\n      media3Tunneling: !!media3Tunnel,\n    };\n    if (loaded || loadEpoch !== mutationEpoch) return cached;\n    cached = next;\n    loaded = true;\n    return cached;''',
        "compat stale hydration guard",
    )
    setters = [
        "setSilentAudioFallback: useCallback((next: boolean) => {",
        "setVlcAudioOutput: useCallback((next: VlcAudioOutput) => {",
        "setVlcHardwareDecode: useCallback((next: boolean) => {",
        "setVideoDecoderMode: useCallback((next: VideoDecoderMode) => {",
        "setMedia3AudioMode: useCallback((next: Media3AudioMode) => {",
        "setMedia3Tunneling: useCallback((next: boolean) => {",
    ]
    for label in setters:
        owned = label + "\n      mutationEpoch += 1;"
        if owned not in text:
            text = replace_once(text, label, owned, f"compat ownership {label}")
    return text


# Subtitle settings use the same multi-key hydration shape.
def patch_subtitles(text: str) -> str:
    if "let mutationEpoch = 0;" not in text:
        text = replace_once(
            text,
            "let loadPromise: Promise<Snapshot> | null = null;\nconst listeners",
            "let loadPromise: Promise<Snapshot> | null = null;\nlet mutationEpoch = 0;\nconst listeners",
            "subtitle mutation epoch",
        )
    if "const loadEpoch = mutationEpoch;" not in text:
        text = replace_once(
            text,
            "  if (loadPromise) return loadPromise;\n  loadPromise = (async () => {",
            "  if (loadPromise) return loadPromise;\n  const loadEpoch = mutationEpoch;\n  loadPromise = (async () => {",
            "subtitle load epoch",
        )
    text = replace_once(
        text,
        '''    cached = {\n      defaultLanguage: typeof lang === "string" ? lang.slice(0, 16) : "",\n      size: size === "small" || size === "large" ? size : "normal",\n      background: bg === "none" || bg === "solid" ? bg : "dim",\n    };\n    loaded = true;\n    return cached;''',
        '''    const next: Snapshot = {\n      defaultLanguage: typeof lang === "string" ? lang.slice(0, 16) : "",\n      size: size === "small" || size === "large" ? size : "normal",\n      background: bg === "none" || bg === "solid" ? bg : "dim",\n    };\n    if (loaded || loadEpoch !== mutationEpoch) return cached;\n    cached = next;\n    loaded = true;\n    return cached;''',
        "subtitle stale hydration guard",
    )
    for label in [
        "setDefaultLanguage: useCallback((next: string) => {",
        "setSize: useCallback((size: SubtitleSize) => {",
        "setBackground: useCallback((background: SubtitleBg) => {",
    ]:
        owned = label + "\n      mutationEpoch += 1;"
        if owned not in text:
            text = replace_once(text, label, owned, f"subtitle ownership {label}")
    return text


# Audio track preferences were the only player preference family with no shared
# hydration promise at all. Coalesce the read and protect edits made while it is
# in flight, including per-channel remembered track choices.
def patch_audio(text: str) -> str:
    if "let loaded = false;" not in text:
        text = replace_once(
            text,
            "let cached: Snapshot = { defaultLanguage: \"\", byChannel: {} };\nconst listeners",
            "let cached: Snapshot = { defaultLanguage: \"\", byChannel: {} };\nlet loaded = false;\nlet loadPromise: Promise<Snapshot> | null = null;\nlet mutationEpoch = 0;\nconst listeners",
            "audio hydration state",
        )
    old_effect = '''  useEffect(() => {\n    let mounted = true;\n    void Promise.all([\n      storage.getItem<string>(LANG_KEY, ""),\n      storage.getItem<Record<string, TrackId>>(CHANNEL_KEY, {}),\n    ]).then(([defaultLanguage, byChannel]) => {\n      const trimmed = trimChannelTracks(byChannel);\n      cached = {\n        defaultLanguage: normalizePreferredAudioLanguage(defaultLanguage),\n        byChannel: trimmed,\n      };\n      // Persist pruning once so stale/unbounded historical maps do not return on next boot.\n      if (Object.keys(byChannel || {}).length !== Object.keys(trimmed).length) {\n        void storage.setItem(CHANNEL_KEY, trimmed);\n      }\n      if (mounted) setSnapshot(cached);\n      emit();\n    });\n    const listener = (next: Snapshot) => mounted && setSnapshot(next);'''
    new_effect = '''  useEffect(() => {\n    let mounted = true;\n    void load().then((next) => { if (mounted) setSnapshot(next); });\n    const listener = (next: Snapshot) => mounted && setSnapshot(next);'''
    if old_effect in text:
        text = text.replace(old_effect, new_effect, 1)
    elif new_effect not in text:
        raise SystemExit("audio hook hydration block not found")

    if "async function load(): Promise<Snapshot>" not in text:
        anchor = '''function emit() {\n  for (const listener of Array.from(listeners)) {\n    if (!listeners.has(listener)) continue;\n    try {\n      listener(cached);\n    } catch {\n      // A settings observer must never interrupt player control.\n    }\n  }\n}\n\n'''
        loader = '''async function load(): Promise<Snapshot> {\n  if (loaded) return cached;\n  if (loadPromise) return loadPromise;\n  const loadEpoch = mutationEpoch;\n  loadPromise = (async () => {\n    const [defaultLanguage, byChannel] = await Promise.all([\n      storage.getItem<string>(LANG_KEY, ""),\n      storage.getItem<Record<string, TrackId>>(CHANNEL_KEY, {}),\n    ]);\n    const trimmed = trimChannelTracks(byChannel);\n    const next: Snapshot = {\n      defaultLanguage: normalizePreferredAudioLanguage(defaultLanguage),\n      byChannel: trimmed,\n    };\n    if (loaded || loadEpoch !== mutationEpoch) return cached;\n    cached = next;\n    loaded = true;\n    // Persist pruning only for the snapshot that actually won hydration.\n    if (Object.keys(byChannel || {}).length !== Object.keys(trimmed).length) {\n      void storage.setItem(CHANNEL_KEY, trimmed);\n    }\n    return cached;\n  })();\n  try {\n    return await loadPromise;\n  } finally {\n    loadPromise = null;\n  }\n}\n\n'''
        text = replace_once(text, anchor, anchor + loader, "audio shared loader")
    for label in [
        "setDefaultLanguage: useCallback((raw: string) => {",
        "rememberChannelTrack: useCallback((channelId: string, trackId: TrackId) => {",
    ]:
        owned = label + "\n      mutationEpoch += 1;\n      loaded = true;"
        if owned not in text:
            text = replace_once(text, label, owned, f"audio ownership {label}")
    return text


# Remote shortcuts are player-scoped settings too. Coalesce their hydration and
# build patches from authoritative cached state rather than a stale React render.
def patch_remote(text: str) -> str:
    if "let loadPromise: Promise<RemoteShortcutPreferences> | null = null;" not in text:
        text = replace_once(
            text,
            "let cached = DEFAULTS;\nlet loaded = false;\nconst listeners",
            "let cached = DEFAULTS;\nlet loaded = false;\nlet loadPromise: Promise<RemoteShortcutPreferences> | null = null;\nlet mutationEpoch = 0;\nconst listeners",
            "remote hydration state",
        )
    old_load = '''async function load(): Promise<RemoteShortcutPreferences> {\n  if (loaded) return cached;\n  cached = normalize(await storage.getItem<RemoteShortcutPreferences>(KEY, DEFAULTS));\n  loaded = true;\n  return cached;\n}'''
    new_load = '''async function load(): Promise<RemoteShortcutPreferences> {\n  if (loaded) return cached;\n  if (loadPromise) return loadPromise;\n  const loadEpoch = mutationEpoch;\n  loadPromise = (async () => {\n    const next = normalize(await storage.getItem<RemoteShortcutPreferences>(KEY, DEFAULTS));\n    if (loaded || loadEpoch !== mutationEpoch) return cached;\n    cached = next;\n    loaded = true;\n    return cached;\n  })();\n  try { return await loadPromise; } finally { loadPromise = null; }\n}'''
    text = replace_once(text, old_load, new_load, "remote stale hydration guard")
    if "export async function setRemoteShortcutPreferences(value: RemoteShortcutPreferences): Promise<void> {\n  mutationEpoch += 1;" not in text:
        text = replace_once(
            text,
            "export async function setRemoteShortcutPreferences(value: RemoteShortcutPreferences): Promise<void> {\n  cached = normalize(value);",
            "export async function setRemoteShortcutPreferences(value: RemoteShortcutPreferences): Promise<void> {\n  mutationEpoch += 1;\n  cached = normalize(value);",
            "remote setter ownership",
        )
    text = replace_once(
        text,
        '''  const update = useCallback((patch: Partial<RemoteShortcutPreferences>) => {\n    const next = normalize({ ...value, ...patch });\n    setValue(next);\n    void setRemoteShortcutPreferences(next);\n  }, [value]);''',
        '''  const update = useCallback((patch: Partial<RemoteShortcutPreferences>) => {\n    const next = normalize({ ...cached, ...patch });\n    setValue(next);\n    void setRemoteShortcutPreferences(next);\n  }, []);''',
        "remote authoritative patch base",
    )
    return text


write("frontend/src/playerEnginePreference.ts", patch_engine)
write("frontend/src/core/playbackBufferProfile.ts", patch_buffer)
write("frontend/src/core/playerCompatibilityPreferences.ts", patch_compat)
write("frontend/src/core/subtitlePreferences.ts", patch_subtitles)
write("frontend/src/core/audioTrackPreferences.ts", patch_audio)
write("frontend/src/core/remoteShortcutPreferences.ts", patch_remote)
