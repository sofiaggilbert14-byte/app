import type { Router } from "expo-router";
import { stopPreviewForFullscreen } from "@/src/core/playbackSession";

export const FULLSCREEN_HANDOFF_SETTLE_MS = 90;
let pendingHandoff: ReturnType<typeof setTimeout> | null = null;

/**
 * Shared entry into fullscreen playback. Always tears down the guide preview
 * session first and gives native MediaCodec/LibVLC one short release window so
 * Fire TV never allocates preview + fullscreen decoders at the same time.
 */
export function openFullscreenPlayer(
  router: Pick<Router, "push">,
  channelId: string,
): void {
  if (!channelId) return;
  stopPreviewForFullscreen();
  if (pendingHandoff) clearTimeout(pendingHandoff);
  pendingHandoff = setTimeout(() => {
    pendingHandoff = null;
    router.push({ pathname: "/player", params: { channelId } });
  }, FULLSCREEN_HANDOFF_SETTLE_MS);
}
