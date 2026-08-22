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
  await instance.replaceAsync(source);
  return instance;
}

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
 * Activity background/inactive: stop network/decode work and clear the source,
 * but keep the player object valid because the React screen itself still owns
 * that object and may resume without unmounting.
 */
export async function suspendFullscreenMedia3(): Promise<void> {
  if (!player || released || activeRole !== "fullscreen") return;
  try { player.pause(); } catch {}
  try { await player.replaceAsync(null as any); } catch {}
}

/**
 * Real fullscreen exit: clear source and release Media3 renderers/audio focus.
 * The process-wide OkHttp pool remains independent and warm.
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

export function destroyMedia3Player(): void {
  if (!player || released) return;
  const instance = player;
  try { instance.pause(); } catch {}
  try { instance.release(); } catch {}
  released = true;
  player = null;
  activeRole = null;
}
