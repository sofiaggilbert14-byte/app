# CharmIPTV Purple Next 2.1.0-rc.5 — Tester Notes

This sideload build includes the complete rc.4 stability and navigation work,
plus the Code Interaction Audit repairs across playback, Guide focus/time,
player preferences, native decoder handoff, RAM/cache ownership, and EPG safety.

## New and repaired in this audit build

- Media3 no longer treats `readyToPlay` alone as successful playback. The stream
  must actually advance its native playback clock before Charm marks it stable.
- A frozen Media3 clock can recover even if Media3's transient `playing` flag
  drops at the same time. Startup and alternate-engine recovery remain bounded.
- VLC now treats a native stop as a recoverable playback failure and has bounded
  post-playback buffering/progress watchdogs.
- Retry, Previous Channel, and crash recovery disarm the old native decoder and
  allow a short release window before mounting the replacement decoder.
- Rapid channel surfing keeps its longer debounce so held D-pad navigation does
  not pile up Media3/VLC decoders or leak old-channel audio.
- Player and Guide route cleanup release TV-remote ownership only when they still
  own it, preventing stale route cleanup from stealing focus from the next screen.
- Player engine, buffer, codec/audio-output, subtitle, audio-track, and remote
  shortcut settings can no longer be overwritten by a stale startup storage read.
- The native Guide owns a bounded 30-second wall-clock redraw so old programme
  blocks move off screen without depending on React rerenders.
- Returning horizontally to the currently airing programme re-enables Guide
  live-follow instead of leaving the timeline permanently detached from Now.
- Guide Up keeps the native Guide active until a real preview action receives
  Android focus, preventing invisible focus during the handoff.
- EPG remains last-good/transactional with WAL, bounded runway reads, coalesced
  refresh ownership, and no provider refresh competing with active Guide/player.
- Low-RAM cache budgets remain coordinated across EPG, logos, player, and VOD;
  critical Android memory pressure still overrides playback-start grace periods.

## Priority testing

1. **Long playback:** leave several channels playing for at least 10–20 minutes,
   especially HLS channels that previously froze after a few minutes. Confirm a
   stalled feed either silently resumes or enters the bounded reconnect flow.
2. **Rapid zapping:** hold Channel Up/Down and move quickly through the fullscreen
   channel strip. Confirm only the settled channel starts, focus stays visible,
   old-channel audio never continues, and Previous Channel returns correctly.
3. **Crash/retry path:** on a failing stream, use Retry Now repeatedly after each
   completed attempt. Confirm the app does not black-screen or accumulate audio.
4. **Audio/codec fallback:** test AAC plus AC-3/E-AC-3/DTS channels when available.
   Confirm supported audio is selected and Media3/VLC fallback does not loop.
5. **Guide live time:** leave the Guide open through programme boundaries. Confirm
   the Now line and programme cells advance without reopening the screen.
6. **Guide horizontal browse:** move into future programmes, then return to the
   currently airing programme. Confirm live-follow resumes without snapping away
   while you are intentionally browsing the future.
7. **Guide focus handoff:** from the first Guide row press Up, move through Play,
   Favorite, Reminders, Drawer, Mute, and Hide, then return Down to the Guide.
   Focus must remain visible through every transition.
8. **Drawer/Back ownership:** open Guide Groups, the main drawer, Program Details,
   Settings, and fullscreen playback in different orders. Confirm Back/Left never
   leaves focus invisible or causes the previous screen to reclaim the remote.
9. **Player settings hot apply:** change player engine, buffer profile, audio mode,
   VLC output/hardware decode, subtitle defaults, and remote mappings soon after
   startup. Confirm the new choice stays selected and is not reverted seconds later.
10. **Large playlist / low-RAM:** with the largest playlist available, surf the
    Guide rapidly for several minutes, open fullscreen playback, return to Guide,
    and repeat. Confirm no blank Guide, reset-to-first-channel, or process crash.
11. **EPG refresh safety:** trigger EPG-only and playlist+EPG refresh from Settings.
    Confirm current last-good channels/programmes remain visible until a successful
    replacement and refresh work never steals Guide/player focus.
12. **EPG Settings:** confirm the page opens at the top, Down reaches every option,
    the page scrolls with focus, and reopening returns to the top.

Please include device model, OS version, screen, focused item, remote key, channel
transport/codec when known, and exact reproduction steps with every report.
