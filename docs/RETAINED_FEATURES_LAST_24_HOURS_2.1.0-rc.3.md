# Retained features added in the last 24 hours

This list is based on the final 2.1.0-rc.3 branch state and intentionally omits
anything that was added and then removed.

## 1. Double-Back drawer reopen

**What it does:** Prevents one Back press from unexpectedly stealing focus, but
still provides a remote-only way to reopen the full drawer.

**How to use:** With the drawer closed and no pop-up open, press **Back/Return**
twice within about 0.9 seconds. One press only arms the action.

## 2. Fixed Guide preview/details panel

**What it does:** Keeps video preview, programme title/time/description, and
actions in a fixed left panel while the Guide stays on the right.

**How to use:** Browse the Guide normally. Press **Left** at the channel edge to
enter the panel; press **Right** or choose **Guide** to return to the same row.

## 3. Guide preview action buttons

**What it does:** Adds retained **Play**, **Fav**, **Remind/Cancel**, **Guide**,
**Mute/Unmute**, and **Hide/Show** actions for the focused channel/programme.

**How to use:** Enter the left preview panel with the D-pad, focus an action,
and press **OK/Select**.

## 4. Immediate details with settled video preview

**What it does:** Updates programme metadata immediately while delaying only
the decoder tune, avoiding laggy text and decoder churn during rapid browsing.

**How to use:** Move quickly through channels/programmes. Read the details
immediately, then pause briefly for the live preview to tune.

## 5. Unified Remind/Cancel toggle

**What it does:** The Guide panel and programme pop-up now share one reminder
state, including remove/cancel behavior.

**How to use:** Focus a future programme and choose **Remind**. Choose it again
to cancel, or open the programme pop-up and use **Cancel reminder**.

## 6. Five-page Guide scan runway

**What it does:** Prepares five channel pages ahead and retains two behind,
refilling around the stopped focus without discarding the still-useful runway.

**How to use:** Hold **Up** or **Down** to scan rapidly. Release on the desired
row; no extra command is required.

## 7. Six-hour default Guide window

**What it does:** Starts the Guide with a smaller six-hour time window to reduce
screen/cache pressure while preserving later window choices.

**How to use:** The default is automatic. Change it under **Settings > General >
Guide window** if a longer view is needed.

## 8. Guide groups and smart filters

**What it does:** Adds counted Guide tabs for provider groups plus Favorites,
Recently Watched, HD Only, 24/7, Unmatched EPG, Failed Streams, and curated
categories. Overflow groups appear under **More groups**.

**How to use:** Move **Up** from the first Guide row, choose a group tab, or open
**More groups**.

## 9. Pinned Guide groups

**What it does:** Keeps frequently used group tabs near the front of the Guide.

**How to use:** Long-press a group tab (or a row in **More groups**) to pin it;
long-press again to unpin it.

## 10. Search inside a Guide group

**What it does:** Filters a large selected group without searching the whole
playlist.

**How to use:** Select a large group and use **Filter in group**. Enter part of a
channel name, then choose the filtered result.

## 11. Search-to-Guide jump

**What it does:** Opens the Guide directly on a channel or programme found in
Search, preserving the target instead of starting at channel one.

**How to use:** In **Search**, choose **Open in Guide** for a channel or select a
programme result. Long-pressing a channel result also jumps to the Guide.

## 12. Health and diagnostic settings

**What it does:** Shows channel/match/failure counts, playlist/EPG refresh ages,
recent failed channels, and creates a privacy-safe diagnostic export.

**How to use:** Open **Settings > Health**, review the values, and choose
**Export diagnostics** when reporting a problem.

## 13. Channel customization settings

**What it does:** Allows retained hide/show, order, and custom channel-number
changes for a bounded TV-friendly channel list.

**How to use:** Open **Settings > Channels**, focus a channel, then use **Hide**,
**Up**, **Down**, **Num −**, **Num +**, or **Clear #**.

## 14. Parental group locks

**What it does:** Protects chosen Guide groups with a local 4–8 digit PIN and a
session unlock/lock state.

**How to use:** Open **Settings > Parental**, set a PIN, enable locked groups,
and choose **Lock session now**. Enter the PIN when opening a locked group.

## 15. Guide preview and group appearance settings

**What it does:** Adds horizontal/vertical group layout and stored default
mute/hide behavior for Guide preview.

**How to use:** Open **Settings > Player** or **Settings > Appearance**, choose
the group layout, and toggle preview mute/hide defaults.

## 16. Subtitle preference settings

**What it does:** Stores a default subtitle language plus size/background
preferences; matching language tracks are selected automatically when exposed.

**How to use:** Open **Settings > Player**, enter a language code such as `eng`,
and select size/background. Use **Audio/CC** in the player to turn tracks on/off.

## 17. Audio capability and silent-audio fallback

**What it does:** Exposes track support, adds a pinned LGPL Media3 FFmpeg audio
extension, and can move an unsupported/silent stream to VLC compatibility mode.

**How to use:** Normally automatic. In fullscreen playback choose **Audio/CC**
to select a supported track; player-engine preference remains under Settings.

## 18. Player audio Report button

**What it does:** Saves a privacy-safe audio diagnostic without retaining the
raw stream URL.

**How to use:** Show fullscreen controls and choose **Report** after an audio
problem. Attach the saved diagnostic to the tester report.

## 19. Detailed EPG completion phases

**What it does:** Shows Indexing, Matching, Caching, and Finalizing after 90% so
a large refresh no longer appears frozen.

**How to use:** Refresh the playlist/EPG from Settings and watch the progress
label until it completes.

## 20. Minute-current Home programme label

**What it does:** Keeps the Home continue-watching programme title current when
a show changes, without requiring another store update.

**How to use:** No action is required; leave Home open across a programme
boundary and the title will update on the next minute tick.
