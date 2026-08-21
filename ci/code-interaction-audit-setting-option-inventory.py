from pathlib import Path
import re
import sys

ROOT = Path("frontend")
TARGETS = [
    "app/(tabs)/settings.tsx",
    "app/(tabs)/epg-sources.tsx",
    "app/epg-custom.tsx",
    "app/epg-source.tsx",
    "app/group-settings.tsx",
    "src/components/TvCalibrationControls.tsx",
    "src/components/TvQuickActionsOverlay.tsx",
]

# Classification is about lifecycle ownership, not UI section names.
# Any new static option that does not match a category is a release-blocking
# audit gap until its player/Guide/cache/source impact has been reviewed.
RULES = [
    ("controlled_decoder_rebuild", re.compile(r"video player|playback buffer|media3 audio mode|media3 tunneling|vlc audio output|vlc hardware decode|player engine", re.I)),
    ("hot_player_policy_or_track", re.compile(r"controls timeout|auto retry|sleep timer|preferred audio|silent-audio|default language|subtitle|audio / subtitles|aspect|previous channel|channel up button|channel down button|play/pause media|long down|remote defaults", re.I)),
    ("guide_preview_visual_focus", re.compile(r"guide layout|guide density|live preview|channel numbers|channel logos|logos off|instant guide|24-hour|start screen|device layout|mute.*preview|hide.*preview|tv screen fit|left edge|right edge|top edge|bottom edge|save & apply|reset draft|discard", re.I)),
    ("guide_epg_ownership_mapping", re.compile(r"guide opens on|provider.*groups|guide epg filter|guide window|tvg-id|custom epg|epg source|assign|mapping|automatic epg|guide groups|custom tabs|pinned|hidden group|playlist channel map|native epg cache|primary xmltv|xmltv|matched|unmatched|ambiguous|guide data", re.I)),
    ("source_schedule_or_explicit_refresh", re.compile(r"playlist auto refresh|epg auto refresh|past days|update epg|refresh playlist|refresh epg|rebuild|clear.*guide|clear epg|refresh.*guide|refresh.*source|add another epg|enable.*source|disable.*source|update interval|refresh schedule|refresh in progress|epg refreshed|playlist refreshed", re.I)),
    ("cache_memory_logo_maintenance", re.compile(r"power profile|logo.*priority|local logo|channel logo sources|cache|prune|diagnostic|health|maintenance|native codecs|failed streams|audio engine|audio mime|audio silent|audio tracks|advertised video", re.I)),
    ("channel_group_storage", re.compile(r"channels|channel page|arrange|order|number|hide|show|favorite|folder|group|rename|remove|clear custom|previous 100|next 100", re.I)),
    ("security_backup_general", re.compile(r"pin|lock session|parental|backup|restore|clear all favorites|pointer mode|account|profile|version|android build|interface|install package|core|all settings|settings|open tv guide|guide sources|return to guide|about charmiptv", re.I)),
]

# These labels are deliberately inventoried even though they are not persisted
# settings. Their lifecycle has still been reviewed, but they are navigation,
# status, section-heading, or immediate action surfaces rather than storage
# owners. Keeping them explicit prevents the inventory from hiding future real
# settings behind an over-broad fallback.
EXACT_FALLBACK = {
    "Save": "screen_scoped_ui_or_storage",
    "Delete": "screen_scoped_ui_or_storage",
    "Cancel": "screen_scoped_ui_or_storage",
    "Done": "screen_scoped_ui_or_storage",
    "Reset": "screen_scoped_ui_or_storage",
    "Clear": "screen_scoped_ui_or_storage",
    "Enable": "source_schedule_or_explicit_refresh",
    "Disable": "source_schedule_or_explicit_refresh",
    "Enabled": "source_schedule_or_explicit_refresh",
    "Name": "screen_scoped_ui_or_storage",
    "URL": "screen_scoped_ui_or_storage",
    "Refresh": "source_schedule_or_explicit_refresh",
    "Source": "guide_epg_ownership_mapping",
    "Sources": "guide_epg_ownership_mapping",
    "Status": "screen_scoped_ui_or_storage",
    "Guide": "guide_preview_visual_focus",
    "Channels": "channel_group_storage",
    "Player": "hot_player_policy_or_track",
    "General": "screen_scoped_ui_or_storage",
    "Appearance": "screen_scoped_ui_or_storage",
    "Remote Control": "screen_scoped_ui_or_storage",
    "EPG": "guide_epg_ownership_mapping",
    "Backup & Restore": "security_backup_general",
    "Account": "security_backup_general",
    "About": "security_backup_general",
    "Health": "cache_memory_logo_maintenance",
    "Parental": "security_backup_general",
    "Diagnostics": "cache_memory_logo_maintenance",
    "Favorite": "channel_group_storage",
    "Stop": "hot_player_policy_or_track",
    "Quick Actions": "screen_scoped_ui_or_storage",
    "Playback": "screen_scoped_ui_or_storage",
    "Back": "screen_scoped_ui_or_storage",
    "Next": "screen_scoped_ui_or_storage",
    "Previous": "screen_scoped_ui_or_storage",
    "Playback compatibility": "screen_scoped_ui_or_storage",
    "Program details / reminder": "guide_preview_visual_focus",
    "Watch channel now": "hot_player_policy_or_track",
}

entries: list[tuple[str, str, str]] = []
unknown: list[tuple[str, str]] = []

for rel in TARGETS:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8", errors="replace")
    labels = set(re.findall(r'\blabel="([^"]+)"', text))
    # Settings card/source row titles are configuration surfaces too.
    labels.update(re.findall(r'<SettingsCard\s+title="([^"]+)"', text))
    labels.update(re.findall(r'<Card\s+title="([^"]+)"', text))
    labels.update(re.findall(r'<SourceRow\s+title="([^"]+)"', text))
    for label in sorted(labels):
        category = None
        for name, pattern in RULES:
            if pattern.search(label):
                category = name
                break
        if category is None:
            category = EXACT_FALLBACK.get(label)
        if category is None:
            unknown.append((rel, label))
            category = "UNCLASSIFIED"
        entries.append((rel, label, category))

report = Path("ci/code-interaction-audit-setting-option-inventory.txt")
lines = [
    "CharmIPTV complete settings/configuration option inventory",
    f"target_files={len(TARGETS)}",
    f"static_options={len(entries)}",
    f"unclassified={len(unknown)}",
    "",
]
for rel, label, category in entries:
    lines.append(f"{category}\t{rel}\t{label}")
if unknown:
    lines.extend(["", "UNCLASSIFIED"])
    lines.extend(f"{rel}\t{label}" for rel, label in unknown)
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
if unknown:
    sys.exit(1)
