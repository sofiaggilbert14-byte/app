# Purple Next Android TV validation

Run on at least one low-memory Fire TV device and one Android TV emulator. Begin each case from a stopped app process and note device model, OS build, available storage, network type, playlist size, EPG size, and APK SHA-256.

## PR #36 permanent regressions

- [ ] Favorite at least 15 channels, surf all of them, and confirm previews continue to start.
- [ ] Open Live TV and press Right; focus lands on row-zero channel logo beside the sidebar.
- [ ] Open a program, change its reminder, close with Back, then repeat with X; focus returns to the originating guide cell.
- [ ] Hold Down for 100 rows, reverse immediately, and repeat five times; guide remains populated and responsive.
- [ ] Rapidly press Next/Previous across healthy and failing streams; Retry never steals focus.
- [ ] Repeat guide→preview→player→guide 20 times; no leaked audio or black overlay remains.

## Navigation matrix

- [ ] Back from every tab, Settings section, modal, channel strip, and fullscreen player has one deterministic destination.
- [ ] Empty Favorites, Recent, category, and search results retain a usable focus target.
- [ ] Left/right timeline navigation works at the beginning, current time, and end of the loaded window.
- [ ] Group changes do not reclaim focus from the selected chip.
- [ ] App background/foreground restores one logical focus target without starting duplicate decoders.

## Source and recovery matrix

- [ ] Cached offline launch remains usable.
- [ ] Playlist HTTP error retains the last-good guide.
- [ ] EPG HTTP error retains the last-good guide and reports diagnostics.
- [ ] Corrupt channel metadata cache recovers without a crash.
- [ ] Interrupted EPG refresh never exposes a partially replaced database.
- [ ] Favorites backup contains no stream URLs and restores exact, renamed, ambiguous, and unavailable channels correctly.

## Evidence

Attach videos for focus failures, `adb shell dumpsys meminfo`, decoder/audio observations, benchmark JSON, CI run URL, APK checksum, and a completed copy of this checklist to the candidate release.
