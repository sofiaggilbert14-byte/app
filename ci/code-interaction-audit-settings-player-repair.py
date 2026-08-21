from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")


def patch_quick_actions() -> None:
    path = Path("frontend/src/components/TvQuickActionsOverlay.tsx")
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        "  const openPathRef = useRef<string | null>(null);\n  const openPathRef = useRef<string | null>(null);",
        "  const openPathRef = useRef<string | null>(null);",
        1,
    )
    text = text.replace("  refreshNativeSourceGuide,\n", "", 1)
    text = text.replace(
        "        void refreshNativeSourceGuide(sourceChoice.id, sourceChoice.url).catch(() => undefined);\n",
        "",
        1,
    )
    text = replace_once(
        text,
        '            <Action icon="git-compare-outline" label="Assign custom EPG" value={ownerLabel} onPress={() => { setStatus(null); setMode("epg-source"); }} />\n            {(legacyOwnerId || extraOwner) ? <Action icon="refresh-outline" label="Use automatic EPG" onPress={() => void clearEpgAssignment()} disabled={busy} /> : null}',
        '            {context === "guide" ? <Action icon="git-compare-outline" label="Assign custom EPG" value={ownerLabel} onPress={() => { setStatus(null); setMode("epg-source"); }} /> : null}\n            {context === "guide" && (legacyOwnerId || extraOwner) ? <Action icon="refresh-outline" label="Use automatic EPG" onPress={() => void clearEpgAssignment()} disabled={busy} /> : null}',
        "Quick Actions EPG player isolation",
    )
    path.write_text(text, encoding="utf-8")


def patch_multi_epg() -> None:
    path = Path("frontend/src/core/multiEpgSources.ts")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "let loading: Promise<CustomEpgSourceRecord[]> | null = null;\nlet writeChain",
        "let loading: Promise<CustomEpgSourceRecord[]> | null = null;\nlet mutationEpoch = 0;\nlet writeChain",
        "multi EPG mutation epoch",
    )
    text = replace_once(
        text,
        "  if (loading) return loading;\n  loading = storage.getItem<CustomEpgSourceRecord[]>(KEY, []).then((raw) => {\n    cached = normalize(raw);",
        "  if (loading) return loading;\n  const loadEpoch = mutationEpoch;\n  loading = storage.getItem<CustomEpgSourceRecord[]>(KEY, []).then((raw) => {\n    if (loaded || loadEpoch !== mutationEpoch) return cached;\n    cached = normalize(raw);",
        "multi EPG stale hydration guard",
    )
    text = replace_once(
        text,
        "function commit(next: CustomEpgSourceRecord[]) {\n  cached = normalize(next); loaded = true;",
        "function commit(next: CustomEpgSourceRecord[]) {\n  mutationEpoch += 1;\n  cached = normalize(next); loaded = true;",
        "multi EPG commit ownership",
    )
    if "function afterHydration(action: () => void): void" not in text:
        anchor = "export async function getMultiEpgSources(): Promise<CustomEpgSourceRecord[]> { return [...(await load())]; }\n"
        helper = "function afterHydration(action: () => void): void {\n  if (loaded) { action(); return; }\n  void load().then(action).catch(() => action());\n}\n"
        text = replace_once(text, anchor, helper + anchor, "multi EPG hydration helper")
    text = replace_once(
        text,
        "export function saveMultiEpgSource(source: CustomEpgSourceRecord) {\n  const clean = normalizeRecord(source); if (!clean) return;\n  const index = cached.findIndex((item) => item.id === clean.id);\n  commit(index >= 0 ? cached.map((item, at) => at === index ? clean : item) : [...cached, clean]);\n}",
        "export function saveMultiEpgSource(source: CustomEpgSourceRecord) {\n  const clean = normalizeRecord(source); if (!clean) return;\n  afterHydration(() => {\n    const index = cached.findIndex((item) => item.id === clean.id);\n    commit(index >= 0 ? cached.map((item, at) => at === index ? clean : item) : [...cached, clean]);\n  });\n}",
        "multi EPG save hydration ownership",
    )
    text = replace_once(
        text,
        "export function removeMultiEpgSource(id: string) { commit(cached.filter((item) => item.id !== cleanId(id))); }",
        "export function removeMultiEpgSource(id: string) {\n  const clean = cleanId(id);\n  afterHydration(() => commit(cached.filter((item) => item.id !== clean)));\n}",
        "multi EPG remove hydration ownership",
    )
    # Keep assignment changes behind the authoritative loaded snapshot.
    text = text.replace(
        "export function clearMultiEpgChannelAssignments(channelId: string) {\n  const channel = String(channelId || \"\").trim();\n  if (!channel) return;\n  let changed = false;\n  const next = cached.map((source) => {",
        "export function clearMultiEpgChannelAssignments(channelId: string) {\n  const channel = String(channelId || \"\").trim();\n  if (!channel) return;\n  afterHydration(() => {\n  let changed = false;\n  const next = cached.map((source) => {",
        1,
    )
    text = text.replace(
        "  if (changed) commit(next);\n}\nexport function assignMultiEpgChannel",
        "  if (changed) commit(next);\n  });\n}\nexport function assignMultiEpgChannel",
        1,
    )
    text = text.replace(
        "  if (!owner || !channel || !xmltv) return;\n  commit(cached.map((source) => ({ ...source, overrides: source.id === owner\n    ? { ...source.overrides, [channel]: xmltv }\n    : Object.fromEntries(Object.entries(source.overrides).filter(([id]) => id !== channel)) })));\n}",
        "  if (!owner || !channel || !xmltv) return;\n  afterHydration(() => commit(cached.map((source) => ({ ...source, overrides: source.id === owner\n    ? { ...source.overrides, [channel]: xmltv }\n    : Object.fromEntries(Object.entries(source.overrides).filter(([id]) => id !== channel)) }))));\n}",
        1,
    )
    path.write_text(text, encoding="utf-8")


def patch_logo_preferences() -> None:
    path = Path("frontend/src/core/logoPreferences.ts")
    text = path.read_text(encoding="utf-8")
    text = replace_once(text, "let loadPromise: Promise<LogoPriority> | null = null;\nconst listeners", "let loadPromise: Promise<LogoPriority> | null = null;\nlet mutationEpoch = 0;\nconst listeners", "logo mutation epoch")
    text = replace_once(text, "  if (loadPromise) return loadPromise;\n  loadPromise = (async () => {", "  if (loadPromise) return loadPromise;\n  const loadEpoch = mutationEpoch;\n  loadPromise = (async () => {", "logo load epoch")
    text = replace_once(text, "    const value = await storage.getItem<LogoPriority>(KEY, DEFAULT_PRIORITY);\n    cached = value === \"epg\" ? \"epg\" : \"playlist\";", "    const value = await storage.getItem<LogoPriority>(KEY, DEFAULT_PRIORITY);\n    if (loaded || loadEpoch !== mutationEpoch) return cached;\n    cached = value === \"epg\" ? \"epg\" : \"playlist\";", "logo stale hydration guard")
    text = replace_once(text, "export async function setLogoPriority(value: LogoPriority): Promise<void> {\n  cached", "export async function setLogoPriority(value: LogoPriority): Promise<void> {\n  mutationEpoch += 1;\n  cached", "logo setter ownership")
    path.write_text(text, encoding="utf-8")


def patch_parental() -> None:
    path = Path("frontend/src/core/parentalPin.ts")
    text = path.read_text(encoding="utf-8")
    text = replace_once(text, "let loadPromise: Promise<Snapshot> | null = null;\nconst listeners", "let loadPromise: Promise<Snapshot> | null = null;\nlet mutationEpoch = 0;\nconst listeners", "parental mutation epoch")
    text = replace_once(text, "  if (loadPromise) return loadPromise;\n  loadPromise = (async () => {", "  if (loadPromise) return loadPromise;\n  const loadEpoch = mutationEpoch;\n  loadPromise = (async () => {", "parental load epoch")
    text = replace_once(
        text,
        "    const pin = securePin || plainPin;\n    setParentalPinMemory(pin);\n    cached = {\n      pin,\n      lockedGroups: Array.isArray(locked) ? locked.filter((item) => typeof item === \"string\").slice(0, 40) : [],\n    };",
        "    const pin = securePin || plainPin;\n    const next: Snapshot = {\n      pin,\n      lockedGroups: Array.isArray(locked) ? locked.filter((item) => typeof item === \"string\").slice(0, 40) : [],\n    };\n    if (loaded || loadEpoch !== mutationEpoch) return cached;\n    setParentalPinMemory(pin);\n    cached = next;",
        "parental stale hydration guard",
    )
    text = replace_once(text, "export async function setParentalPin(pin: string | null): Promise<void> {\n  const next", "export async function setParentalPin(pin: string | null): Promise<void> {\n  mutationEpoch += 1;\n  const next", "parental pin ownership")
    text = replace_once(text, "export async function setLockedGroups(groups: string[]): Promise<void> {\n  cached", "export async function setLockedGroups(groups: string[]): Promise<void> {\n  mutationEpoch += 1;\n  cached", "parental groups ownership")
    path.write_text(text, encoding="utf-8")


def patch_calibration() -> None:
    path = Path("frontend/src/tvCalibration.tsx")
    text = path.read_text(encoding="utf-8")
    text = replace_once(text, "  const saveInFlightRef = useRef(false);", "  const saveInFlightRef = useRef(false);\n  const hydrationMutationRef = useRef(0);", "calibration hydration ownership")
    text = replace_once(text, "  useEffect(() => {\n    let active = true;\n    storage.getItem", "  useEffect(() => {\n    let active = true;\n    const loadEpoch = hydrationMutationRef.current;\n    storage.getItem", "calibration load epoch")
    text = replace_once(text, "      if (!active || !saved) return;", "      if (!active || !saved || loadEpoch !== hydrationMutationRef.current) return;", "calibration stale hydration guard")
    text = replace_once(text, "  const setSide = useCallback((side: keyof TvCalibration, value: number) => {\n    setDraftCalibration", "  const setSide = useCallback((side: keyof TvCalibration, value: number) => {\n    hydrationMutationRef.current += 1;\n    setDraftCalibration", "calibration edit ownership")
    text = replace_once(text, "  const reset = useCallback(() => setDraftCalibration(DEFAULT_CALIBRATION), []);", "  const reset = useCallback(() => { hydrationMutationRef.current += 1; setDraftCalibration(DEFAULT_CALIBRATION); }, []);", "calibration reset ownership")
    text = replace_once(text, "  const discard = useCallback(() => setDraftCalibration(calibration), [calibration]);", "  const discard = useCallback(() => { hydrationMutationRef.current += 1; setDraftCalibration(calibration); }, [calibration]);", "calibration discard ownership")
    path.write_text(text, encoding="utf-8")


def patch_store() -> None:
    path = Path("frontend/src/store.tsx")
    text = path.read_text(encoding="utf-8")
    if 'getSessionPhase' not in text:
        text = replace_once(text, 'import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";', 'import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";\nimport { getSessionPhase } from "@/src/core/playbackSession";', "store playback session import")
    if "function fullscreenPlaybackOwnsDecoder()" not in text:
        anchor = 'const INSTANT_GUIDE_KEY = "gs_instant_guide";\n'
        helper = '\nfunction fullscreenPlaybackOwnsDecoder(): boolean {\n  return getSessionPhase("fullscreen") !== "idle";\n}\n'
        text = replace_once(text, anchor, anchor + helper, "store fullscreen helper")
    if "const settingsTouchedRef = useRef(new Set<string>());" not in text:
        text = replace_once(text, "  const guideEpochRef = useRef(0);", "  const guideEpochRef = useRef(0);\n  // Bootstrap storage reads are asynchronous. A user edit made before a read\n  // resolves owns that setting and must never be overwritten by the stale disk value.\n  const settingsTouchedRef = useRef(new Set<string>());", "store settings hydration ownership")

    touch_map = {
        "const setPointerMode = useCallback((v: boolean) => {": "PMODE_KEY",
        "const setGuideLayout = useCallback((v: GuideLayout) => {": "GUIDE_LAYOUT_KEY",
        "const setGuideDensity = useCallback((v: GuideDensity) => {": "GUIDE_DENSITY_KEY",
        "const setSafePreviewMode = useCallback((v: SafePreviewMode) => {": "SAFE_PREVIEW_MODE_KEY",
        "const setChannelNumbers = useCallback((v: boolean) => {": "CHANNEL_NUMBERS_KEY",
        "const setChannelLogos = useCallback((v: boolean) => {": "CHANNEL_LOGOS_KEY",
        "const setDeviceLayoutMode = useCallback((v: DeviceLayoutMode) => {": "DEVICE_LAYOUT_MODE_KEY",
        "const setPlayerControlsTimeoutMs = useCallback((v: PlayerControlsTimeoutMs) => {": "PLAYER_TIMEOUT_KEY",
        "const setAutoRetryStreams = useCallback((v: boolean) => {": "AUTO_RETRY_KEY",
        "const setPreferTvgIdOnly = useCallback((v: boolean) => {": "PREFER_TVG_ID_ONLY_KEY",
        "const setLogosOffWhileSurfing = useCallback((v: boolean) => {": "LOGOS_OFF_SURF_KEY",
        "const setInstantGuide = useCallback((v: boolean) => {": "INSTANT_GUIDE_KEY",
        "const setEpgGuideFilter = useCallback((v: EpgGuideFilter) => {": "EPG_GUIDE_FILTER_KEY",
        "const setEpgManualRemaps = useCallback((v: Record<string, string>) => {": "EPG_MANUAL_REMAPS_KEY",
        "const setFavoriteFolders = useCallback((folders: FavoriteFolder[]) => {": "FAVORITE_FOLDERS_KEY",
        "const addFavoriteFolder = useCallback((name: string) => {": "FAVORITE_FOLDERS_KEY",
        "const toggleFavoriteFolderChannel = useCallback((folderId: string, channelId: string) => {": "FAVORITE_FOLDERS_KEY",
        "const renameFavoriteFolderById = useCallback((folderId: string, name: string) => {": "FAVORITE_FOLDERS_KEY",
        "const removeFavoriteFolder = useCallback((id: string) => {": "FAVORITE_FOLDERS_KEY",
        "const setGuideWindowHours = useCallback((v: GuideWindowHours) => {": "GUIDE_WINDOW_HOURS_KEY",
        "const setClock24h = useCallback((v: boolean) => {": "CLOCK_24H_KEY",
        "const setStartScreen = useCallback((v: StartScreen) => {": "START_SCREEN_KEY",
        "const setSleepTimerMinutes = useCallback((v: SleepTimerMinutes) => {": "SLEEP_TIMER_MINUTES_KEY",
    }
    for header, key in touch_map.items():
        owned = header + f"\n    settingsTouchedRef.current.add({key});"
        if owned not in text:
            text = replace_once(text, header, owned, f"store touch {key}")
    power_header = "const setPowerProfile = useCallback((v: PowerProfile) => {"
    power_owned = power_header + "\n    settingsTouchedRef.current.add(POWER_PROFILE_KEY);\n    settingsTouchedRef.current.add(LOGOS_OFF_SURF_KEY);"
    if power_owned not in text:
        text = replace_once(text, power_header, power_owned, "store power profile ownership")

    old_boot = '''      setPointerModeState((await storage.getItem<boolean>(PMODE_KEY, false)) || false);\n      const storedGuideLayout = await storage.getItem<string | null>(GUIDE_LAYOUT_KEY, null);\n      setGuideLayoutState(resolveStoredGuideLayout(storedGuideLayout, Platform.isTV, Platform.OS));\n      const extraCompactDefaultApplied = await storage.getItem<boolean>(EXTRA_COMPACT_DEFAULT_MIGRATION_KEY, false);\n      const storedDensity = extraCompactDefaultApplied\n        ? await storage.getItem<GuideDensity>(GUIDE_DENSITY_KEY, "extra_compact")\n        : "extra_compact";\n      setGuideDensityState(storedDensity === "large" || storedDensity === "normal" || storedDensity === "compact" ? storedDensity : "extra_compact");\n      if (!extraCompactDefaultApplied) {\n        void storage.setItem(GUIDE_DENSITY_KEY, "extra_compact");\n        void storage.setItem(EXTRA_COMPACT_DEFAULT_MIGRATION_KEY, true);\n      }\n      setSafePreviewModeState((await storage.getItem<SafePreviewMode>(SAFE_PREVIEW_MODE_KEY, "surf")) || "surf");\n      setChannelNumbersState((await storage.getItem<boolean>(CHANNEL_NUMBERS_KEY, false)) || false);\n      setChannelLogosState((await storage.getItem<boolean>(CHANNEL_LOGOS_KEY, true)) ?? true);\n      setDeviceLayoutModeState((await storage.getItem<DeviceLayoutMode>(DEVICE_LAYOUT_MODE_KEY, "auto")) || "auto");\n      setPlayerControlsTimeoutMsState((await storage.getItem<PlayerControlsTimeoutMs>(PLAYER_TIMEOUT_KEY, 8000)) || 8000);\n      setAutoRetryStreamsState((await storage.getItem<boolean>(AUTO_RETRY_KEY, true)) ?? true);\n      const tvgOnly = (await storage.getItem<boolean>(PREFER_TVG_ID_ONLY_KEY, false)) || false;\n      setPreferTvgIdOnlyState(tvgOnly);\n      setPreferTvgIdOnlyMatching(tvgOnly);\n      const profile = resolvePowerProfile(await storage.getItem<string>(POWER_PROFILE_KEY, "normal"));\n      setPowerProfileState(profile);\n      const deviceMemory = await readDeviceMemoryProfile();\n      const lowRamDevice = shouldUseLowRamTuning(deviceMemory);\n      setDeviceLowRamCacheCap(lowRamDevice);\n      const memorySafeTuning = getPowerProfileTuning(profile);\n      setGuideProgramRowLimit(memorySafeTuning.programmeRowCacheLimit);\n      setProgrammeWindowCacheLimit(memorySafeTuning.programmeRowCacheLimit);\n      setChannelLogoMemoryProfile(profile === "weak" || lowRamDevice, deviceMemory?.logoMemoryBytes);\n      const rawLogosOffWhileSurfing = await storage.getItem<boolean | null>(LOGOS_OFF_SURF_KEY, null);\n      setLogosOffWhileSurfingState(typeof rawLogosOffWhileSurfing === "boolean" ? rawLogosOffWhileSurfing : getPowerProfileTuning(profile).logosOffWhileSurfingDefault);\n      setInstantGuideState((await storage.getItem<boolean>(INSTANT_GUIDE_KEY, true)) ?? true);\n      setEpgGuideFilterState(resolveEpgGuideFilter(await storage.getItem<string>(EPG_GUIDE_FILTER_KEY, "all")));\n      const manualRemaps = sanitizeEpgManualRemap(await storage.getItem<Record<string, string>>(EPG_MANUAL_REMAPS_KEY, {}));\n      setEpgManualRemapsState(manualRemaps);\n      setManualEpgRemaps(manualRemaps);\n      const foldersSeeded = (await storage.getItem<boolean>(FAVORITE_FOLDERS_SEEDED_KEY, false)) || false;\n      const storedFolders = sanitizeFavoriteFolders(await storage.getItem<FavoriteFolder[]>(FAVORITE_FOLDERS_KEY, []));\n      if (!foldersSeeded && !storedFolders.length) {\n        const seeded: FavoriteFolder[] = [];\n        for (const name of DEFAULT_FOLDER_PRESETS) {\n          const folder = createFavoriteFolder(name, seeded);\n          if (folder) seeded.push(folder);\n        }\n        const next = sanitizeFavoriteFolders(seeded);\n        setFavoriteFoldersState(next);\n        void storage.setItem(FAVORITE_FOLDERS_KEY, next);\n        void storage.setItem(FAVORITE_FOLDERS_SEEDED_KEY, true);\n      } else {\n        setFavoriteFoldersState(storedFolders);\n        if (!foldersSeeded) void storage.setItem(FAVORITE_FOLDERS_SEEDED_KEY, true);\n      }\n      const storedGuideWindowHours = readGuideWindowHours(\n        await storage.getItem<number>(GUIDE_WINDOW_HOURS_KEY, DEFAULT_GUIDE_WINDOW_HOURS),\n        DEFAULT_GUIDE_WINDOW_HOURS,\n      );\n      guideWindowHoursRef.current = storedGuideWindowHours;\n      setGuideWindowHoursState(storedGuideWindowHours);\n      const storedClock24h = (await storage.getItem<boolean>(CLOCK_24H_KEY, false)) || false;\n      setClock24hState(storedClock24h);\n      setTimeFormat24h(storedClock24h);\n      setStartScreenState(resolveStartScreen(await storage.getItem<string>(START_SCREEN_KEY, "home")));\n      setSleepTimerMinutesState(resolveSleepTimerMinutes(await storage.getItem<number>(SLEEP_TIMER_MINUTES_KEY, 0)));'''
    new_boot = '''      const storedPointerMode = (await storage.getItem<boolean>(PMODE_KEY, false)) || false;\n      if (!settingsTouchedRef.current.has(PMODE_KEY)) setPointerModeState(storedPointerMode);\n      const storedGuideLayout = await storage.getItem<string | null>(GUIDE_LAYOUT_KEY, null);\n      if (!settingsTouchedRef.current.has(GUIDE_LAYOUT_KEY)) setGuideLayoutState(resolveStoredGuideLayout(storedGuideLayout, Platform.isTV, Platform.OS));\n      const extraCompactDefaultApplied = await storage.getItem<boolean>(EXTRA_COMPACT_DEFAULT_MIGRATION_KEY, false);\n      const storedDensity = extraCompactDefaultApplied\n        ? await storage.getItem<GuideDensity>(GUIDE_DENSITY_KEY, "extra_compact")\n        : "extra_compact";\n      if (!settingsTouchedRef.current.has(GUIDE_DENSITY_KEY)) {\n        setGuideDensityState(storedDensity === "large" || storedDensity === "normal" || storedDensity === "compact" ? storedDensity : "extra_compact");\n        if (!extraCompactDefaultApplied) void storage.setItem(GUIDE_DENSITY_KEY, "extra_compact");\n      }\n      if (!extraCompactDefaultApplied) void storage.setItem(EXTRA_COMPACT_DEFAULT_MIGRATION_KEY, true);\n      const storedSafePreviewMode = (await storage.getItem<SafePreviewMode>(SAFE_PREVIEW_MODE_KEY, "surf")) || "surf";\n      if (!settingsTouchedRef.current.has(SAFE_PREVIEW_MODE_KEY)) setSafePreviewModeState(storedSafePreviewMode);\n      const storedChannelNumbers = (await storage.getItem<boolean>(CHANNEL_NUMBERS_KEY, false)) || false;\n      if (!settingsTouchedRef.current.has(CHANNEL_NUMBERS_KEY)) setChannelNumbersState(storedChannelNumbers);\n      const storedChannelLogos = (await storage.getItem<boolean>(CHANNEL_LOGOS_KEY, true)) ?? true;\n      if (!settingsTouchedRef.current.has(CHANNEL_LOGOS_KEY)) setChannelLogosState(storedChannelLogos);\n      const storedDeviceLayout = (await storage.getItem<DeviceLayoutMode>(DEVICE_LAYOUT_MODE_KEY, "auto")) || "auto";\n      if (!settingsTouchedRef.current.has(DEVICE_LAYOUT_MODE_KEY)) setDeviceLayoutModeState(storedDeviceLayout);\n      const storedPlayerTimeout = (await storage.getItem<PlayerControlsTimeoutMs>(PLAYER_TIMEOUT_KEY, 8000)) || 8000;\n      if (!settingsTouchedRef.current.has(PLAYER_TIMEOUT_KEY)) setPlayerControlsTimeoutMsState(storedPlayerTimeout);\n      const storedAutoRetry = (await storage.getItem<boolean>(AUTO_RETRY_KEY, true)) ?? true;\n      if (!settingsTouchedRef.current.has(AUTO_RETRY_KEY)) setAutoRetryStreamsState(storedAutoRetry);\n      const tvgOnly = (await storage.getItem<boolean>(PREFER_TVG_ID_ONLY_KEY, false)) || false;\n      if (!settingsTouchedRef.current.has(PREFER_TVG_ID_ONLY_KEY)) {\n        setPreferTvgIdOnlyState(tvgOnly);\n        setPreferTvgIdOnlyMatching(tvgOnly);\n      }\n      const profile = resolvePowerProfile(await storage.getItem<string>(POWER_PROFILE_KEY, "normal"));\n      const deviceMemory = await readDeviceMemoryProfile();\n      const lowRamDevice = shouldUseLowRamTuning(deviceMemory);\n      setDeviceLowRamCacheCap(lowRamDevice);\n      if (!settingsTouchedRef.current.has(POWER_PROFILE_KEY)) {\n        setPowerProfileState(profile);\n        const memorySafeTuning = getPowerProfileTuning(profile);\n        setGuideProgramRowLimit(memorySafeTuning.programmeRowCacheLimit);\n        setProgrammeWindowCacheLimit(memorySafeTuning.programmeRowCacheLimit);\n        setChannelLogoMemoryProfile(profile === "weak" || lowRamDevice, deviceMemory?.logoMemoryBytes);\n      }\n      const rawLogosOffWhileSurfing = await storage.getItem<boolean | null>(LOGOS_OFF_SURF_KEY, null);\n      if (!settingsTouchedRef.current.has(LOGOS_OFF_SURF_KEY)) {\n        setLogosOffWhileSurfingState(typeof rawLogosOffWhileSurfing === "boolean" ? rawLogosOffWhileSurfing : getPowerProfileTuning(profile).logosOffWhileSurfingDefault);\n      }\n      const storedInstantGuide = (await storage.getItem<boolean>(INSTANT_GUIDE_KEY, true)) ?? true;\n      if (!settingsTouchedRef.current.has(INSTANT_GUIDE_KEY)) setInstantGuideState(storedInstantGuide);\n      const storedEpgGuideFilter = resolveEpgGuideFilter(await storage.getItem<string>(EPG_GUIDE_FILTER_KEY, "all"));\n      if (!settingsTouchedRef.current.has(EPG_GUIDE_FILTER_KEY)) setEpgGuideFilterState(storedEpgGuideFilter);\n      const manualRemaps = sanitizeEpgManualRemap(await storage.getItem<Record<string, string>>(EPG_MANUAL_REMAPS_KEY, {}));\n      if (!settingsTouchedRef.current.has(EPG_MANUAL_REMAPS_KEY)) {\n        setEpgManualRemapsState(manualRemaps);\n        setManualEpgRemaps(manualRemaps);\n      }\n      const foldersSeeded = (await storage.getItem<boolean>(FAVORITE_FOLDERS_SEEDED_KEY, false)) || false;\n      const storedFolders = sanitizeFavoriteFolders(await storage.getItem<FavoriteFolder[]>(FAVORITE_FOLDERS_KEY, []));\n      if (!settingsTouchedRef.current.has(FAVORITE_FOLDERS_KEY)) {\n        if (!foldersSeeded && !storedFolders.length) {\n          const seeded: FavoriteFolder[] = [];\n          for (const name of DEFAULT_FOLDER_PRESETS) {\n            const folder = createFavoriteFolder(name, seeded);\n            if (folder) seeded.push(folder);\n          }\n          const next = sanitizeFavoriteFolders(seeded);\n          setFavoriteFoldersState(next);\n          void storage.setItem(FAVORITE_FOLDERS_KEY, next);\n          void storage.setItem(FAVORITE_FOLDERS_SEEDED_KEY, true);\n        } else {\n          setFavoriteFoldersState(storedFolders);\n          if (!foldersSeeded) void storage.setItem(FAVORITE_FOLDERS_SEEDED_KEY, true);\n        }\n      }\n      const storedGuideWindowHours = readGuideWindowHours(\n        await storage.getItem<number>(GUIDE_WINDOW_HOURS_KEY, DEFAULT_GUIDE_WINDOW_HOURS),\n        DEFAULT_GUIDE_WINDOW_HOURS,\n      );\n      if (!settingsTouchedRef.current.has(GUIDE_WINDOW_HOURS_KEY)) {\n        guideWindowHoursRef.current = storedGuideWindowHours;\n        setGuideWindowHoursState(storedGuideWindowHours);\n      }\n      const storedClock24h = (await storage.getItem<boolean>(CLOCK_24H_KEY, false)) || false;\n      if (!settingsTouchedRef.current.has(CLOCK_24H_KEY)) {\n        setClock24hState(storedClock24h);\n        setTimeFormat24h(storedClock24h);\n      }\n      const storedStartScreen = resolveStartScreen(await storage.getItem<string>(START_SCREEN_KEY, "home"));\n      if (!settingsTouchedRef.current.has(START_SCREEN_KEY)) setStartScreenState(storedStartScreen);\n      const storedSleepTimer = resolveSleepTimerMinutes(await storage.getItem<number>(SLEEP_TIMER_MINUTES_KEY, 0));\n      if (!settingsTouchedRef.current.has(SLEEP_TIMER_MINUTES_KEY)) setSleepTimerMinutesState(storedSleepTimer);'''
    text = replace_once(text, old_boot, new_boot, "store per-setting hydration guard")

    text = text.replace("if (silent && isGuideSurfing()) {", "if (silent && (isGuideSurfing() || fullscreenPlaybackOwnsDecoder())) {", 2)
    text = replace_once(text, "        if (isGuideSurfing()) {\n          pendingSilentRefreshRef.current = true;", "        if (isGuideSurfing() || fullscreenPlaybackOwnsDecoder()) {\n          pendingSilentRefreshRef.current = true;", "source subscriber playback gate")
    text = replace_once(text, "      if (disposed || !pendingSilentRefreshRef.current) return;\n      pendingSilentRefreshRef.current = false;", "      if (disposed || !pendingSilentRefreshRef.current || fullscreenPlaybackOwnsDecoder()) return;\n      pendingSilentRefreshRef.current = false;", "surf settle playback gate")
    text = replace_once(text, "      if (busyRef.current || isGuideScreenActive() || isGuideSurfing()) return;", "      if (busyRef.current || isGuideScreenActive() || isGuideSurfing() || fullscreenPlaybackOwnsDecoder()) return;", "hourly refresh playback gate")
    path.write_text(text, encoding="utf-8")


patch_quick_actions()
patch_multi_epg()
patch_logo_preferences()
patch_parental()
patch_calibration()
patch_store()
print("settings/player lifecycle repair applied")
