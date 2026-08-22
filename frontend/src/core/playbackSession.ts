/**
 * Playback ownership registry.
 *
 * The UI may mount/unmount player surfaces while surfing, but this registry is
 * the authority for when native playback is actually allowed to exist.
 */
import {
  releaseFullscreenMedia3,
  releasePreviewMedia3,
} from "@/src/core/media3PlaybackManager";

export type SessionRole = "preview" | "fullscreen";
export type SessionPhase = "idle" | "preparing" | "playing" | "recovering" | "failed";
export type SessionFailReason =
  | "start-timeout"
  | "engine-swap"
  | "circuit-open"
  | "stream-error"
  | "silent-audio"
  | "user-stop"
  | "superseded"
  | "crashed";

type StopFn = () => void | Promise<void>;
type RoleState = {
  generation: number;
  stops: Set<StopFn>;
  phase: SessionPhase;
  reason: SessionFailReason | null;
};

function createRole(): RoleState {
  return { generation: 0, stops: new Set(), phase: "idle", reason: null };
}

const roles: Record<SessionRole, RoleState> = {
  preview: createRole(),
  fullscreen: createRole(),
};
let fullscreenReserved = false;
let ownershipRevision = 0;
const ownershipListeners = new Set<() => void>();

function publishOwnership(): void {
  ownershipRevision += 1;
  for (const listener of Array.from(ownershipListeners)) {
    try { listener(); } catch {}
  }
}

function invokeStops(role: SessionRole): Promise<void> {
  const state = roles[role];
  const pending: Promise<void>[] = [];
  for (const stop of Array.from(state.stops)) {
    try {
      const result = stop();
      if (result && typeof result.then === "function") pending.push(result);
    } catch {}
  }
  state.stops.clear();
  return Promise.allSettled(pending).then(() => undefined);
}

async function releaseNativeRole(role: SessionRole): Promise<void> {
  if (role === "preview") await releasePreviewMedia3();
  else await releaseFullscreenMedia3();
}

export function subscribePlaybackOwnership(listener: () => void): () => void {
  ownershipListeners.add(listener);
  return () => ownershipListeners.delete(listener);
}

export function getPlaybackOwnershipRevision(): number {
  return ownershipRevision;
}

export function isPreviewPlaybackAllowed(): boolean {
  return !fullscreenReserved && roles.fullscreen.phase === "idle";
}

export function beginSession(role: SessionRole): number {
  if (role === "preview" && !isPreviewPlaybackAllowed()) {
    const state = roles.preview;
    void releaseNativeRole("preview");
    void invokeStops("preview");
    state.generation += 1;
    state.phase = "idle";
    state.reason = "superseded";
    publishOwnership();
    return 0;
  }

  if (role === "fullscreen") {
    fullscreenReserved = true;
    const preview = roles.preview;
    // Fullscreen reservation immediately invalidates preview. The navigation
    // handoff normally awaited the native release already; this is the safety
    // net for any alternate entry into /player.
    void releaseNativeRole("preview");
    void invokeStops("preview");
    preview.generation += 1;
    preview.phase = "idle";
    preview.reason = "superseded";
  }

  const state = roles[role];
  // Replacing a logical generation must not destroy fullscreen Media3 during a
  // normal channel zap. Surface/source changes are handled by the singleton
  // manager. Preview generations remain cheap and can be invalidated freely.
  if (role === "preview") void invokeStops(role);
  state.generation += 1;
  state.phase = "preparing";
  state.reason = null;
  publishOwnership();
  return state.generation;
}

export function getSessionGeneration(role: SessionRole): number {
  return roles[role].generation;
}

export function getSessionPhase(role: SessionRole): SessionPhase {
  return roles[role].phase;
}

export function getSessionReason(role: SessionRole): SessionFailReason | null {
  return roles[role].reason;
}

export function isSessionCurrent(role: SessionRole, generation: number): boolean {
  return roles[role].generation === generation;
}

export function registerSessionStop(
  role: SessionRole,
  generation: number,
  stop: StopFn,
): () => void {
  const state = roles[role];
  if (generation !== state.generation) return () => undefined;
  state.stops.add(stop);
  return () => state.stops.delete(stop);
}

export function setSessionPhase(
  role: SessionRole,
  generation: number,
  phase: SessionPhase,
  reason: SessionFailReason | null = null,
): boolean {
  const state = roles[role];
  if (generation !== state.generation) return false;
  state.phase = phase;
  state.reason = reason;
  publishOwnership();
  return true;
}

export async function stopSession(
  role: SessionRole,
  reason: SessionFailReason = "user-stop",
): Promise<void> {
  const state = roles[role];
  const callbacks = invokeStops(role);
  // Native release is explicit and independent of React cleanup. This is what
  // guarantees preview/fullscreen resources are gone when ownership says idle.
  const nativeRelease = releaseNativeRole(role);
  state.generation += 1;
  state.phase = "idle";
  state.reason = reason;
  if (role === "fullscreen") fullscreenReserved = false;
  publishOwnership();
  await Promise.allSettled([callbacks, nativeRelease]);
}

/**
 * Channel surfing no longer destroys the fullscreen player. Stale callbacks are
 * invalidated by the next generation/source load; Media3 performs the hot swap.
 */
export function pauseSessionDecoders(role: SessionRole): Promise<void> {
  if (role === "fullscreen") return Promise.resolve();
  return invokeStops(role);
}

export function stopPreviewForFullscreen(): Promise<void> {
  fullscreenReserved = true;
  publishOwnership();
  return stopSession("preview", "superseded");
}

export function stopFullscreenSession(reason: SessionFailReason = "user-stop"): Promise<void> {
  return stopSession("fullscreen", reason);
}

export function stopAllPlaybackSessions(reason: SessionFailReason = "user-stop"): Promise<void> {
  return Promise.allSettled([
    stopSession("preview", reason),
    stopSession("fullscreen", reason),
  ]).then(() => undefined);
}

export function forceStopAllStreams(): void {
  void stopAllPlaybackSessions("user-stop");
}

export function resetPlaybackSessionsForTests(): void {
  for (const role of Object.keys(roles) as SessionRole[]) {
    roles[role].stops.clear();
    roles[role].generation = 0;
    roles[role].phase = "idle";
    roles[role].reason = null;
  }
  fullscreenReserved = false;
  publishOwnership();
}
