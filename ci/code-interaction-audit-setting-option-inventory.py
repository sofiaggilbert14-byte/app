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
    ("guide_epg_ownership_mapping", re.compile(r"guide opens on|provider.*groups|guide epg filter|guide window|tvg-id|custom epg|epg source|assign|mapping|automatic epg|guide groups|custom tabs|pinned|hidden group|playlist channel map|native epg cache|primary xmltv|xmltv|matched|unmatched", re.I)),
    ("source_schedule_or_explicit_refresh", re.compile(r"playlist auto refresh|epg auto refresh|past days|update epg|refresh playlist|refresh epg|rebuild|clear.*guide|refresh.*guide|refresh.*source|add another epg|enable.*source|disable.*source", re.I)),
    ("cache_memory_logo_maintenance", re.compile(r"power profile|logo.*priority|local logo|cache|prune|diagnostic|health|native codecs|failed streams|audio engine|audio mime|audio silent|audio tracks|advertised video", re.I)),
    ("channel_group_storage", re.compile(r"channels|arrange|order|number|hide|show|favorite|folder|group|rename|remove|clear custom|previous 100|next 100", re.I)),
    ("security_backup_general", re.compile(r"pin|lock session|parental|backup|restore|clear all favorites|pointer mode|account|profile|version|android build|interface|install package|core|all settings|settings|open tv guide|guide sources|return to guide", re.I)),
]

# Some component labels are terse verbs or context values. They are still
# audited, but their enclosing screen determines that they are UI/storage only.
EXACT_FALLBACK = {
    "Save", "Delete", "Cancel", "Done", "Reset", "Clear", "Enable", "Disable",
    "Name", "URL", "Refresh", "Source", "Status", "Guide", "Channels", "Player",
    "General", "Appearance", "Remote Control", "EPG", "Backup & Restore", "Account",
    "About", "Health", "Parental", "Diagnostics", "Favorite", "Stop", "Quick Actions",
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
        if category is None and label in EXACT_FALLBACK:
            category = "screen_scoped_ui_or_storage"
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
