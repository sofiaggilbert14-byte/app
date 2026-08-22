/**
 * Playback ownership registry for preview vs fullscreen.
 * Kept platform-agnostic so it can be unit-tested outside React Native.
 */

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
type NativeRoleFn = (role: SessionRole) => void | Promise<void>;
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
let nativeReleaseHandler: NativeRoleFn | null = null;
let nativePauseHandler: NativeRoleFn | null = null;
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

async function invokeNative(handler: NativeRoleFn | null, role: SessionRole): Promise<void> {
  if (!handler) return;
  try { await handler(role); } catch {}
}

export function setNativePlaybackReleaseHandler(handler: NativeRoleFn | null): void {
  nativeReleaseHandler = handler;
}

export function setNativePlaybackPauseHandler(handler: NativeRoleFn | null): void {
  nativePauseHandler = handler;
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
    void invokeNative(nativeReleaseHandler, "preview");
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
    void invokeNative(nativeReleaseHandler, "preview");
    void invokeStops("preview");
    preview.generation += 1;
    preview.phase = "idle";
    preview.reason = "superseded";
  }

  const state = roles[role];
  // Every new generation invalidates and drains callbacks from the previous
  // generation. Fullscreen channel changes still keep the singleton Media3
  // player alive because native release is not invoked here.
  void invokeStops(role);
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

export function registerSessionStop(role: SessionRole, generation: number, stop: StopFn): () => void {
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
  const nativeRelease = invokeNative(nativeReleaseHandler, role);
  state.generation += 1;
  const stoppedGeneration = state.generation;
  state.phase = "idle";
  state.reason = reason;
  await Promise.allSettled([callbacks, nativeRelease]);
  // Preview must remain ineligible until native fullscreen release has cleared
  // the Media3 source, surface, audio focus, and decoder. A new fullscreen
  // generation may have claimed ownership while the previous release settled.
  if (role === "fullscreen" && state.generation === stoppedGeneration) fullscreenReserved = false;
  publishOwnership();
}

export function pauseSessionDecoders(role: SessionRole): Promise<void> {
  if (role === "fullscreen") return invokeNative(nativePauseHandler, role);
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
  return Promise.allSettled([stopSession("preview", reason), stopSession("fullscreen", reason)]).then(() => undefined);
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
  nativeReleaseHandler = null;
  nativePauseHandler = null;
  publishOwnership();
}
