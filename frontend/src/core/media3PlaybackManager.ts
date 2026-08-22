import { createVideoPlayer, type VideoPlayer, type VideoSource } from "expo-video";

export type NativePlaybackRole = "preview" | "fullscreen";

let player: VideoPlayer | null = null;
let activeRole: NativePlaybackRole | null = null;
let released = false;
let nativeMutationTail: Promise<void> = Promise.resolve();

function ensurePlayer(): VideoPlayer {
  if (player && !released) return player;
  player = createVideoPlayer(null);
  released = false;
  player.loop = false;
  player.timeUpdateEventInterval = 0.25;
  return player;
}

function enqueueNativeMutation<T>(operation: () => Promise<T> | T): Promise<T> {
  const run = nativeMutationTail.catch(() => undefined).then(operation);
  nativeMutationTail = run.then(() => undefined, () => undefined);
  return run;
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

/**
 * All source mutations are serialized. Preview teardown, fullscreen zaps and
 * final release can otherwise overlap replaceAsync calls on the singleton and
 * let stale cleanup clear a newer owner's source.
 */
export function loadMedia3Source(
  role: NativePlaybackRole,
  _sourceKey: string,
  source: VideoSource,
): Promise<VideoPlayer> {
  return enqueueNativeMutation(async () => {
    const instance = ensurePlayer();
    activeRole = role;
    await instance.replaceAsync(source);
    return instance;
  });
}

export function pauseFullscreenMedia3(): void {
  if (!player || released || activeRole !== "fullscreen") return;
  try { player.pause(); } catch {}
}

export function releasePreviewMedia3(): Promise<void> {
  return enqueueNativeMutation(async () => {
    if (!player || released || activeRole !== "preview") return;
    const instance = player;
    try { instance.pause(); } catch {}
    try { await instance.replaceAsync(null as any); } catch {}
    if (player === instance && activeRole === "preview") activeRole = null;
  });
}

/**
 * Activity background/inactive: stop network/decode work and clear the source,
 * but keep the player object valid because the React screen itself still owns
 * that object and may resume without unmounting.
 */
export function suspendFullscreenMedia3(): Promise<void> {
  return enqueueNativeMutation(async () => {
    if (!player || released || activeRole !== "fullscreen") return;
    const instance = player;
    try { instance.pause(); } catch {}
    try { await instance.replaceAsync(null as any); } catch {}
  });
}

/**
 * Real fullscreen exit: clear source and release Media3 renderers/audio focus.
 * The process-wide OkHttp pool remains independent and warm. A subsequent load
 * is queued behind this release and therefore creates a fresh player instead of
 * touching an instance that is still being torn down.
 */
export function releaseFullscreenMedia3(): Promise<void> {
  return enqueueNativeMutation(async () => {
    if (!player || released || activeRole !== "fullscreen") {
      if (activeRole === "fullscreen") activeRole = null;
      return;
    }
    const instance = player;
    try { instance.pause(); } catch {}
    try { await instance.replaceAsync(null as any); } catch {}
    try { instance.release(); } catch {}
    if (player === instance) {
      released = true;
      player = null;
      activeRole = null;
    }
  });
}

export function destroyMedia3Player(): void {
  if (!player || released) return;
  const instance = player;
  try { instance.pause(); } catch {}
  try { instance.release(); } catch {}
  released = true;
  player = null;
  activeRole = null;
  nativeMutationTail = Promise.resolve();
}
