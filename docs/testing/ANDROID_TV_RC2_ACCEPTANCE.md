# Android TV RC2 Acceptance

Use a target Android TV/Fire TV device and complete this checklist before marking the draft PR ready.

## Guide focus and layout

- Hold Down for at least 60 seconds, reverse direction repeatedly, and reach both list boundaries.
- Switch groups at least 20 times and reopen the Guide after visiting Search, Settings, and Reminders.
- Open/close programme details and the navigation panel from top, middle, and bottom rows.
- Pass: no blank guide, overlap, focus escape, row-0 fallback, or wrong-channel restoration.

## Memory runway

- Record `adb shell dumpsys meminfo com.charmiptv.app.purple.next.sideload` after launch.
- Surf the Guide for 10 minutes, including long holds and group switches, then record it again.
- Pass: no low-memory kill or repeated decoder crash; final total PSS should settle rather than grow continuously. Investigate growth above 25% after repeating the same route twice.

## Playback and audio

- Switch through at least 50 mixed HLS/TS channels, including AC-3, E-AC-3, DTS, and TrueHD when available.
- Test fullscreen/preview handoff, rapid channel changes, app background/foreground, and a stream restart.
- Pass: no stale video/audio from the prior channel, no silent supported stream, and VLC fallback appears when Media3 cannot decode audio.

## Reminders

- Set and cancel reminders from both preview and programme details.
- Double-press during scheduling, deny/allow notification permission, and reboot before a scheduled reminder.
- Pass: one notification at most, canceled reminders do not fire, and both buttons always show the same state.

## Network and installation

- Confirm HTTPS playlists/EPG and at least one legacy HTTP stream in the sideload build.
- Confirm the tester package installs beside production without replacing its data.
- Production release builds must fail without the four `CHARM_UPLOAD_*` signing values.
