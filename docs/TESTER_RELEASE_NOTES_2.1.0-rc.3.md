# CharmIPTV Purple Next 2.1.0-rc.3 — Tester Notes

## What this build changes

- The TV Guide keeps a fixed preview/details/actions panel on the left and the
  timeline on the right. The two surfaces do not overlap.
- Programme details and reminder state change immediately with focus. Live
  preview waits until focus settles so held-D-pad browsing does not repeatedly
  retune the decoder.
- Remind/Cancel is one shared toggle in the preview panel and programme pop-up.
- Held Up/Down keeps five pages ready ahead and two behind, restores focus by
  stable channel ID, and no longer falls back to the first channel.
- The default Guide window is six hours. Native SQLite remains the guide source
  of truth; unchanged playlist, EPG, and match data skips unnecessary rewrites.
- The closed drawer leaves no icon rail. The Guide recent strip and all
  Guide-only drawer actions are removed.
- EPG refresh shows Indexing, Matching, Caching, and Finalizing after 90%.
- Provider downloads now have compressed/decompressed size and programme-count
  safety limits while keeping the last-good guide on failure.
- Guide groups, search-to-guide, Health, channel customization, parental group
  locks, subtitle preferences, audio diagnostics, and silent-audio fallback are
  retained.

## Fast tester directions

1. Open **TV Guide**, close the drawer, and confirm the left screen edge has no
   shortcut rail.
2. Hold **Down** for at least five pages, reverse with **Up**, then stop. Repeat
   near the top and bottom. The grid must stay filled and focus must stay on the
   intended channel.
3. Move across programmes. Text should change immediately; preview video should
   wait briefly. Press **Left** at the channel edge to enter the preview actions,
   then **Guide** to return to that same row.
4. On a future programme, toggle **Remind**, open the programme pop-up, and
   confirm it says **Cancel reminder**. Toggle again and verify both surfaces.
5. With the drawer closed and no pop-up open, press **Back** twice within about
   one second. The full drawer should open. One Back press alone must not open it.
6. Open **Search**, choose **Open in Guide**, and confirm focus lands on the
   selected channel/programme.
7. Open **Settings > Health** and review counts/timestamps; export diagnostics.
8. In fullscreen playback, open **Audio/CC**, switch a reported track, and use
   **Report** to save an audio diagnostic. Test a channel that previously had
   silent audio and confirm automatic compatibility fallback.

## Focused acceptance checklist

- No frozen focus, blank Guide, channel-one jump, or crash during long held-D-pad
  scans and rapid direction changes.
- Up from the first Guide row returns to the active group tab; Left at the
  channel edge enters preview actions; **Guide** returns to the same channel.
- Closing a programme pop-up returns to its originating Guide cell.
- Reminders stay synchronized and can be removed from either Guide surface or
  the Reminders screen.
- EPG refresh reaches Finalizing and finishes without hiding last-good rows.
- Drawer, Guide, fullscreen player, Settings sections, and parental PIN overlay
  each have a deterministic Back destination.

## Known physical-device checks

- VLC and the Media3 FFmpeg extension still require real-device validation on
  every target Fire TV/Android TV chipset.
- Subtitle size/background are stored settings; native renderer styling is not
  yet applied by the current player integration.
- The remaining npm advisory is in Metro's build-time `image-size` parser. The
  app does not process provider images through that parser at runtime; builds
  must continue using repository-controlled image assets until upstream ships a
  patched compatible dependency.
