import { createVideoPlayer, type VideoPlayer, type VideoSource } from "expo-video";

export type NativePlaybackRole = "preview" | "fullscreen";

let player: VideoPlayer | null = null;
let activeRole: NativePlaybackRole | null = null;
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
  _sourceKey: string,
  source: VideoSource,
): Promise<VideoPlayer> {
  const instance = claimMedia3Playback(role);
  // Explicit loads always re-prepare so same-URL Retry/rebuffer recovery is real.
  await instance.replaceAsync(source);
  return instance;
}

/**
 * Guide preview is temporary. Clear its MediaItem/decoder before fullscreen,
 * while keeping the player object alive for the immediate fullscreen handoff.
 */
export async function releasePreviewMedia3(): Promise<void> {
  if (!player || released) {
    if (activeRole === "preview") activeRole = null;
    return;
  }
  if (activeRole !== "preview") return;
  try { player.pause(); } catch {}
  try { await player.replaceAsync(null as any); } catch {}
  activeRole = null;
}

/**
 * Fullscreen exit/background is a real ownership boundary. Clear the source,
 * then release the Media3 player/renderers/audio focus so decoder/buffer memory
 * can be reclaimed. The native shared OkHttp pool remains warm independently.
 */
export async function releaseFullscreenMedia3(): Promise<void> {
  if (!player || released) {
    if (activeRole === "fullscreen") activeRole = null;
    return;
  }
  const instance = player;
  try { instance.pause(); } catch {}
  try { await instance.replaceAsync(null as any); } catch {}
  try { instance.release(); } catch {}
  released = true;
  player = null;
  activeRole = null;
}

/** Process-wide emergency release. */
export function destroyMedia3Player(): void {
  if (!player || released) return;
  const instance = player;
  try { instance.pause(); } catch {}
  try { instance.release(); } catch {}
  released = true;
  player = null;
  activeRole = null;
}
