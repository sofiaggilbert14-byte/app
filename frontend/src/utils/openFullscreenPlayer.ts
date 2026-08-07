import type { Router } from "expo-router";
import { stopPreviewForFullscreen } from "@/src/core/playbackSession";

/**
 * Shared entry into fullscreen playback. Always tears down the guide preview
 * session first so Fire TV never runs two VLC/Media3 decoders at once.
 */
export function openFullscreenPlayer(
  router: Pick<Router, "push">,
  channelId: string,
): void {
  if (!channelId) return;
  stopPreviewForFullscreen();
  router.push({ pathname: "/player", params: { channelId } });
}
