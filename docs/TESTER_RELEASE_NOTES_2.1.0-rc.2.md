# CharmIPTV Purple Next 2.1.0-rc.2 — Tester Notes

## What changed in the last 24 hours

- The TV Guide now has a fixed details/preview panel on the left and the channel timeline on the right.
- Programme title, time, description, and reminder state update immediately as focus moves. Video preview still waits briefly to avoid rapid decoder switching.
- **Remind** and **Cancel** now use the same reliable reminder state in the preview panel and programme pop-up.
- The **Guide** button in the preview panel returns focus to the same channel in the grid.
- Held D-pad navigation has a wider focus runway and restores by channel ID, preventing blank rows and jumps back to channel 1.
- Guide data stays visible while refreshed rows arrive. Unchanged EPG downloads and match tables are skipped.
- EPG refresh now shows late **Indexing**, **Matching**, **Caching**, and **Finalizing** phases instead of appearing stuck near 90%.
- Guide groups, search jump, Settings health details, parental group locks, and automatic VLC audio fallback are included from the previous daily build.
- Production release builds now require a real upload key. This tester APK uses a clearly separate sideload identity and retains legacy HTTP-provider compatibility.

## Remote-control directions

1. Open **TV Guide** from the left navigation.
2. Use **Up/Down** for channels and **Left/Right** for programmes.
3. Focus a future programme and select **Remind**. Select it again to **Cancel**.
4. Select a programme cell for the full details pop-up. Its reminder button should match the preview panel.
5. Move into the left preview actions, then select **Guide** to return to the same channel row.
6. Hold **Up** or **Down** through a long channel list. The grid should remain filled and must not jump to channel 1.
7. Use **Search** to find a channel and jump into the Guide.
8. In **Settings**, use **Health** for playlist/guide status and **Parental** to configure locked channel groups.

## Quick pass checklist

- Programme details change immediately with focus.
- Preview video waits briefly and does not retune when moving across programmes on the same channel.
- Remind/Cancel stays synchronized in both Guide surfaces.
- Long held-D-pad navigation never blanks the grid or loses the current channel.
- Back from a pop-up or navigation panel returns to the previous channel.
- EPG refresh reaches Finalizing and completes.
- Channels with unsupported Media3 audio fall back to VLC instead of remaining silent.

For the extended stress procedure, see `docs/testing/ANDROID_TV_RC2_ACCEPTANCE.md`.
