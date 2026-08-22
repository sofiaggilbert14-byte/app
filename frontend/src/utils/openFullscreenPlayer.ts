import type { Router } from "expo-router";
import { stopPreviewForFullscreen } from "@/src/core/playbackSession";

let handoffSequence = 0;

/**
 * Single-owner handoff. Fullscreen is not mounted until the preview MediaItem
 * has been cleared and its native release promise has completed.
 */
export function openFullscreenPlayer(
  router: Pick<Router, "push">,
  channelId: string,
  options?: { returnToGuide?: boolean },
): void {
  if (!channelId) return;
  const sequence = ++handoffSequence;

  void stopPreviewForFullscreen()
    .catch(() => undefined)
    .then(() => {
      if (sequence !== handoffSequence) return;
      router.push({
        pathname: "/player",
        params: {
          channelId,
          returnToGuide: options?.returnToGuide ? "1" : undefined,
        },
      });
    });
}
