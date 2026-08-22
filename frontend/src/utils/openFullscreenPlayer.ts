import type { Router } from "expo-router";
import { stopPreviewForFullscreen } from "@/src/core/playbackSession";

export const FULLSCREEN_HANDOFF_SETTLE_MS = 180;
export const PREVIEW_RELEASE_TIMEOUT_MS = 1200;
let pendingHandoff: ReturnType<typeof setTimeout> | null = null;
let handoffSequence = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared entry into fullscreen playback. Always tears down the guide preview
 * session first and gives native MediaCodec/LibVLC one short release window so
 * Fire TV never allocates preview + fullscreen decoders at the same time.
 */
export function openFullscreenPlayer(
  router: Pick<Router, "push">,
  channelId: string,
  options?: { returnToGuide?: boolean },
): void {
  if (!channelId) return;
  const sequence = ++handoffSequence;
  if (pendingHandoff) clearTimeout(pendingHandoff);
  pendingHandoff = null;

  // Media3 source clearing is asynchronous and LibVLC releases on the native UI
  // queue. Wait for the registered preview teardown, with a bounded escape hatch,
  // then allow one short surface/codec settle window before fullscreen mounts.
  // The sequence guard prevents rapid repeated OK presses from opening two players.
  void Promise.race([
    stopPreviewForFullscreen(),
    delay(PREVIEW_RELEASE_TIMEOUT_MS),
  ]).then(() => {
    if (sequence !== handoffSequence) return;
    pendingHandoff = setTimeout(() => {
      pendingHandoff = null;
      if (sequence !== handoffSequence) return;
      router.push({
        pathname: "/player",
        params: { channelId, returnToGuide: options?.returnToGuide ? "1" : undefined },
      });
    }, FULLSCREEN_HANDOFF_SETTLE_MS);
  });
}
