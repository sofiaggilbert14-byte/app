import { createVideoPlayer, type VideoPlayer, type VideoSource } from "expo-video";

export type NativePlaybackRole = "preview" | "fullscreen";

let player: VideoPlayer | null = null;
let activeRole: NativePlaybackRole | null = null;
let activeSourceKey = "";
let released = false;

function ensurePlayer(): VideoPlayer {
  if (player && !released) return player;
  player = createVideoPlayer(null);
  released = false;
  player.loop = false;
  player.timeUpdateEventInterval = 0.25;
  return player;
}

export function getMedia3Player(): VideoPlayer {
  return ensurePlayer();
}

export function getMedia3PlaybackRole(): NativePlaybackRole | null {
  return activeRole;
}

export function claimMedia3Playback(role: NativePlaybackRole): VideoPlayer {
  activeRole = role;
  return ensurePlayer();
}

export async function loadMedia3Source(
  role: NativePlaybackRole,
  sourceKey: string,
  source: VideoSource,
): Promise<VideoPlayer> {
  const instance = claimMedia3Playback(role);
  if (activeSourceKey !== sourceKey) {
    activeSourceKey = sourceKey;
    await instance.replaceAsync(source);
  }
  return instance;
}

/**
 * Preview must be completely empty before fullscreen claims the hardware path.
 * Keep the VideoPlayer object alive so the Media3/OkHttp stack can remain warm,
 * but clear the MediaItem so the preview decoder/socket/surface are released.
 */
export async function releasePreviewMedia3(): Promise<void> {
  if (!player || released) {
    if (activeRole === "preview") activeRole = null;
    activeSourceKey = "";
    return;
  }
  if (activeRole !== "preview") return;
  try { player.pause(); } catch {}
  try { await player.replaceAsync(null as any); } catch {}
  activeRole = null;
  activeSourceKey = "";
}

/** Full deterministic shutdown used when leaving fullscreen/backgrounding. */
export async function releaseFullscreenMedia3(): Promise<void> {
  if (!player || released) {
    if (activeRole === "fullscreen") activeRole = null;
    activeSourceKey = "";
    return;
  }
  try { player.pause(); } catch {}
  try { await player.replaceAsync(null as any); } catch {}
  if (activeRole === "fullscreen") activeRole = null;
  activeSourceKey = "";
}

/** Process-wide emergency release. The next request lazily creates a fresh player. */
export function destroyMedia3Player(): void {
  if (!player || released) return;
  try { player.pause(); } catch {}
  try { player.release(); } catch {}
  released = true;
  player = null;
  activeRole = null;
  activeSourceKey = "";
}
