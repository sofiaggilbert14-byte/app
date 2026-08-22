from pathlib import Path
import re
import sys

ROOT = Path("frontend")
critical: list[str] = []
warnings: list[str] = []

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="replace")

settings = read("app/(tabs)/settings.tsx")
epg_settings = read("app/(tabs)/epg-sources.tsx")
epg_custom = read("app/epg-custom.tsx")
epg_source = read("app/epg-source.tsx")
groups = read("app/group-settings.tsx")
quick = read("src/components/TvQuickActionsOverlay.tsx")
store = read("src/store.tsx")
scheduler = read("src/components/SourceRefreshScheduler.tsx")
player = read("app/player.tsx")
stream = read("src/components/StreamPlayer.tsx")
native_guide = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt")

# Every visible Settings family that can influence UI, Guide, sources, player,
# cache/memory, focus, or startup must stay represented in this audit.
expected_labels = [
    "Guide layout", "Guide density", "Live preview", "Channel numbers", "Channel logos",
    "Logos off while surfing", "Instant Guide / reduce motion", "Power profile", "24-hour clock",
    "Start screen", "Video player", "Controls timeout", "Remote · Long Down", "Playback buffer",
    "Auto retry streams", "Sleep timer", "Preferred audio language", "Silent-audio fallback",
    "Video decoder", "Audio decoder", "Media3 tunneling", "VLC audio output",
    "Default language", "Subtitle size", "Subtitle background", "Mute preview by default",
    "Hide preview by default", "Channel Up button", "Channel Down button", "Play/Pause media button",
    "Long Down", "Pointer mode", "Device layout", "Mute guide preview", "Hide guide preview",
]
for label in expected_labels:
    if label not in settings:
        critical.append(f"Settings option missing from audit inventory: {label}")

expected_epg_labels = [
    "Guide opens on", "Show raw provider/M3U groups", "Guide EPG filter", "Guide window",
    "Prefer tvg-id matching only", "Playlist auto refresh", "EPG auto refresh", "Past days to keep EPG",
    "Update EPG on app start", "Update EPG when playlist changes", "Channel logos priority",
    "Add another EPG source", "Manage Guide groups & custom tabs", "Custom EPG & channel assignments",
]
for label in expected_epg_labels:
    if label not in epg_settings:
        critical.append(f"EPG setting missing from audit inventory: {label}")

# Mapping/group screens must stay bounded for 6k+ channel lists.
for required in ("PLAYLIST_PAGE_SIZE = 60", "XMLTV_PAGE_SIZE = 60", "queryGeneration = useRef(0)"):
    if required not in epg_custom:
        critical.append(f"legacy custom EPG paging/generation guard missing: {required}")
for required in ("const PAGE = 50", "queryGeneration = useRef(0)"):
    if required not in epg_source:
        critical.append(f"additional EPG paging/generation guard missing: {required}")
for required in ("const PAGE_SIZE = 100", "stable IDs", "provider names stay untouched"):
    if required not in groups:
        warnings.append(f"group/tab bounded-identity marker missing: {required}")


# Every long Phase 9 customization surface uses one bounded Android-TV focus
# corridor. The Back row gets deterministic initial focus and ScrollView owns
# vertical traversal rather than letting Android focus escape off-screen.
for name, source in (("Custom EPG", epg_custom), ("additional EPG", epg_source), ("Guide groups/tabs", groups)):
    for required in ("FocusGuide", "trapFocusUp", "trapFocusDown", "trapFocusLeft", "trapFocusRight", "scrollRef", "nestedScrollEnabled", 'contentInsetAdjustmentBehavior="never"'):
        if required not in source:
            critical.append(f"{name} TV focus/scroll containment missing: {required}")

# TiViMate-style live Guide behavior: expired time keeps sliding left while the
# channel-name rail remains a fixed canvas region. Manual horizontal browsing
# still disables live follow, so users can inspect past/future programs.
for required in ("liveWindowHistoryMs", "liveWindowAdvanceThresholdMs", "val rollingStart = now - liveWindowHistoryMs", "windowStartMs = rollingStart", "windowEndMs = rollingStart + configuredWindowMs"):
    if required not in native_guide:
        critical.append(f"native Guide rolling live window missing: {required}")
for required in ("liveFollowEnabled = false", "return channelWidth +", "canvas.drawRect(0f, top, channelWidth", "canvas.drawRect(channelWidth, top, width.toFloat()"):
    if required not in native_guide:
        critical.append(f"native Guide fixed-rail/manual-browse invariant missing: {required}")

# Fullscreen Quick Actions is an OSD owner, not a provider-refresh owner. EPG
# mapping can be done from Guide/EPG Settings, but must not download/index XMLTV
# next to an active decoder.
if quick.count("const openPathRef = useRef<string | null>(null);") != 1:
    critical.append("Quick Actions route-owner ref is duplicated or missing")
if "refreshNativeSourceGuide" in quick:
    critical.append("Quick Actions can launch custom XMLTV refresh beside fullscreen playback")
if 'context === "guide" ? <Action icon="git-compare-outline" label="Assign custom EPG"' not in quick:
    critical.append("custom EPG mapping is not isolated to Guide context")
if 'context === "guide" && (legacyOwnerId || extraOwner)' not in quick:
    critical.append("automatic EPG mapping reset is not isolated to Guide context")

# Automatic source work follows TiViMate-style ownership: never compete with
# Guide surfing or fullscreen playback.
for required in ('!pathname?.startsWith("/guide")', '!pathname?.startsWith("/player")', "!isGuideSurfing()"):
    if required not in scheduler:
        critical.append(f"source scheduler foreground exclusion missing: {required}")
if "!isPreviewPlaybackAllowed()" not in store:
    critical.append("root Guide maintenance has no fullscreen playback ownership gate")
if "isGuideScreenActive() || isGuideSurfing() || fullscreenPlaybackOwnsDecoder()" not in store:
    critical.append("hourly Guide maintenance can run during fullscreen playback")
if "isGuideSurfing() || fullscreenPlaybackOwnsDecoder()" not in store:
    critical.append("source-driven Guide refresh can run during fullscreen playback")

# Root settings bootstrap uses per-setting sticky touch ownership. A setting a
# user changes during startup must not be overwritten by an older AsyncStorage read.
if "const settingsTouchedRef = useRef(new Set<string>());" not in store:
    critical.append("root settings bootstrap has no per-setting stale hydration guard")
for key in (
    "PMODE_KEY", "GUIDE_LAYOUT_KEY", "GUIDE_DENSITY_KEY", "SAFE_PREVIEW_MODE_KEY",
    "CHANNEL_NUMBERS_KEY", "CHANNEL_LOGOS_KEY", "DEVICE_LAYOUT_MODE_KEY", "PLAYER_TIMEOUT_KEY",
    "AUTO_RETRY_KEY", "PREFER_TVG_ID_ONLY_KEY", "POWER_PROFILE_KEY", "LOGOS_OFF_SURF_KEY",
    "INSTANT_GUIDE_KEY", "EPG_GUIDE_FILTER_KEY", "EPG_MANUAL_REMAPS_KEY", "FAVORITE_FOLDERS_KEY",
    "GUIDE_WINDOW_HOURS_KEY", "CLOCK_24H_KEY", "START_SCREEN_KEY", "SLEEP_TIMER_MINUTES_KEY",
):
    if f"settingsTouchedRef.current.add({key})" not in store:
        critical.append(f"root setting does not claim startup mutation ownership: {key}")
    if f"settingsTouchedRef.current.has({key})" not in store:
        critical.append(f"root setting hydration is not guarded: {key}")

# Preference families used by Settings must all prevent stale initial reads from
# overwriting newer user mutations.
guarded_modules = {
    "src/playerEnginePreference.ts": "mutationEpoch",
    "src/core/playbackBufferProfile.ts": "mutationEpoch",
    "src/core/playerCompatibilityPreferences.ts": "mutationEpoch",
    "src/core/audioTrackPreferences.ts": "mutationEpoch",
    "src/core/subtitlePreferences.ts": "mutationEpoch",
    "src/core/remoteShortcutPreferences.ts": "mutationEpoch",
    "src/core/guideUiPreferences.ts": "mutationEpoch",
    "src/core/sourceRefreshPreferences.ts": "mutationEpoch",
    "src/core/epgSourcePreferences.ts": "mutationEpoch",
    "src/core/guideGroupTabPersistence.ts": "mutationEpoch",
    "src/core/customGuideGroups.ts": "mutationEpoch",
    "src/core/channelCustomize.ts": "mutationEpoch",
    "src/core/multiEpgSources.ts": "mutationEpoch",
    "src/core/logoPreferences.ts": "mutationEpoch",
    "src/core/parentalPin.ts": "mutationEpoch",
}
for path, marker in guarded_modules.items():
    source = read(path)
    if marker not in source or "loadEpoch" not in source:
        critical.append(f"stale hydration protection missing: {path}")

calibration = read("src/tvCalibration.tsx")
for required in ("hydrationMutationRef", "loadEpoch !== hydrationMutationRef.current"):
    if required not in calibration:
        critical.append(f"TV calibration hydration ownership missing: {required}")

# Additional EPG source registry stays bounded and one-owner-per-channel updates
# remove old custom-source ownership rather than accumulating duplicate mappings.
multi = read("src/core/multiEpgSources.ts")
for required in ("const MAX_SOURCES = 7", ".slice(0, 10_000)", "filter(([id]) => id !== channel)", "afterHydration"):
    if required not in multi:
        critical.append(f"additional EPG ownership/RAM bound missing: {required}")

# Player-facing settings: presentation/track operations remain hot; engine and
# compatibility construction stays inside the single StreamPlayer owner.
if player.count("<StreamPlayer") != 1:
    critical.append(f"fullscreen player StreamPlayer mount count={player.count('<StreamPlayer')}")
for required in (
    'pauseSessionDecoders("fullscreen")', "DECODER_RESTART_SETTLE_MS = 120",
    'setDecoderArmed(false)', 'stopFullscreenSession()',
):
    if required not in player:
        critical.append(f"player controlled decoder rebuild contract missing: {required}")
for required in (
    'sessionRole="fullscreen"', 'surfaceType={Platform.OS === "android" ? "textureView" : undefined}',
    'if (!playbackFocused || !uri || !sessionGeneration) return null;',
):
    if required not in player + "\n" + stream:
        critical.append(f"player/preview ownership invariant missing: {required}")

# Audit report includes actual visible label counts so changes to Settings surface
# are obvious in CI even when they are not yet dangerous.
label_count = len(re.findall(r'label="[^"]+"', settings))
epg_label_count = len(re.findall(r'label="[^"]+"', epg_settings))
report = Path("ci/code-interaction-audit-settings-lifecycle-report.txt")
lines = [
    "CharmIPTV complete settings/Guide/EPG/player lifecycle scan",
    f"settings_static_label_sites={label_count}",
    f"epg_settings_static_label_sites={epg_label_count}",
    f"critical_findings={len(critical)}",
    f"warnings={len(warnings)}",
    "",
    "CRITICAL",
    *(critical or ["none"]),
    "",
    "WARNINGS",
    *(warnings or ["none"]),
]
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if critical:
    sys.exit(1)
