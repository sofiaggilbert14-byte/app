/**
 * Playback session owner for Fire TV.
 *
 * Two roles (preview vs fullscreen) so the guide cannot tear down an active
 * fullscreen decoder, and generation tokens so stale engine events cannot
 * overwrite the status of a newer channel.
 *
 * Phases: idle → preparing → playing
 *                    ↘ recovering → (engine swap / retry)
 *                                 ↘ failed
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
    try {
      listener();
    } catch {
      /* playback ownership observers must not interrupt native teardown */
    }
  }
}

function invokeStops(role: SessionRole): Promise<void> {
  const state = roles[role];
  const pending: Promise<void>[] = [];
  for (const stop of Array.from(state.stops)) {
    try {
      const result = stop();
      if (result && typeof result.then === "function") pending.push(result);
    } catch {
      /* native teardown best-effort */
    }
  }
  // A stop callback belongs to the decoder generation that just ended. Keeping
  // it registered lets later channel loads fire stale native teardown twice.
  state.stops.clear();
  return Promise.allSettled(pending).then(() => undefined);
}

export function subscribePlaybackOwnership(listener: () => void): () => void {
  ownershipListeners.add(listener);
  return () => ownershipListeners.delete(listener);
}

export function getPlaybackOwnershipRevision(): number {
  return ownershipRevision;
}

/** A preview may allocate a decoder only when fullscreen has no reservation. */
export function isPreviewPlaybackAllowed(): boolean {
  return !fullscreenReserved && roles.fullscreen.phase === "idle";
}

/** Start (or replace) a session for this role. Returns the generation token. */
export function beginSession(role: SessionRole): number {
  if (role === "preview" && !isPreviewPlaybackAllowed()) {
    const state = roles.preview;
    void invokeStops("preview");
    state.generation += 1;
    state.phase = "idle";
    state.reason = "superseded";
    publishOwnership();
    return 0;
  }
  if (role === "fullscreen") {
    // Fullscreen owns the only decoder budget. This is intentionally enforced
    // here as well as in the navigation handoff so no alternate entry point can
    // leave a hidden Guide preview alive.
    fullscreenReserved = true;
    const preview = roles.preview;
    void invokeStops("preview");
    preview.generation += 1;
    preview.phase = "idle";
    preview.reason = "superseded";
  }
  const state = roles[role];
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

/**
 * Register a decoder teardown for the current generation only.
 * Stale registrations (wrong generation) are stopped immediately and ignored.
 */
export function registerSessionStop(
  role: SessionRole,
  generation: number,
  stop: StopFn,
): () => void {
  const state = roles[role];
  if (generation !== state.generation) {
    try {
      void Promise.resolve(stop()).catch(() => undefined);
    } catch {
      /* ignore */
    }
    return () => undefined;
  }
  state.stops.add(stop);
  return () => {
    state.stops.delete(stop);
  };
}

/** Update phase if generation is still current. Returns false when stale. */
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

/**
 * Tear down decoders for one role and invalidate in-flight events.
 * Does not touch the other role.
 */
export function stopSession(
  role: SessionRole,
  reason: SessionFailReason = "user-stop",
): Promise<void> {
  const state = roles[role];
  const released = invokeStops(role);
  state.generation += 1;
  state.phase = "idle";
  state.reason = reason;
  if (role === "fullscreen") fullscreenReserved = false;
  publishOwnership();
  return released;
}

/** Invoke stop callbacks without bumping generation (rapid-scan pause). */
export function pauseSessionDecoders(role: SessionRole): Promise<void> {
  return invokeStops(role);
}

/** Guide → player handoff: kill preview only so fullscreen can allocate safely. */
export function stopPreviewForFullscreen(): Promise<void> {
  fullscreenReserved = true;
  publishOwnership();
  return stopSession("preview", "superseded");
}

export function stopFullscreenSession(reason: SessionFailReason = "user-stop"): Promise<void> {
  return stopSession("fullscreen", reason);
}

/** Emergency: stop both roles (ErrorBoundary / process-wide recovery). */
export function stopAllPlaybackSessions(reason: SessionFailReason = "user-stop"): Promise<void> {
  const preview = stopSession("preview", reason);
  const fullscreen = stopSession("fullscreen", reason);
  return Promise.allSettled([preview, fullscreen]).then(() => undefined);
}

/** @deprecated Prefer role-scoped stop helpers. Kept as a named alias for clarity. */
export function forceStopAllStreams(): void {
  void stopAllPlaybackSessions("user-stop");
}

/** Test/reset helper — clears registry state. */
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
