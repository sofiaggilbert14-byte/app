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

type StopFn = () => void;

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

function invokeStops(role: SessionRole): void {
  const state = roles[role];
  for (const stop of Array.from(state.stops)) {
    try {
      stop();
    } catch {
      /* native teardown best-effort */
    }
  }
  // A stop callback belongs to the decoder generation that just ended. Keeping
  // it registered lets later channel loads fire stale native teardown twice.
  state.stops.clear();
}

/** Start (or replace) a session for this role. Returns the generation token. */
export function beginSession(role: SessionRole): number {
  const state = roles[role];
  invokeStops(role);
  state.generation += 1;
  state.phase = "preparing";
  state.reason = null;
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
      stop();
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
  return true;
}

/**
 * Tear down decoders for one role and invalidate in-flight events.
 * Does not touch the other role.
 */
export function stopSession(
  role: SessionRole,
  reason: SessionFailReason = "user-stop",
): void {
  const state = roles[role];
  invokeStops(role);
  state.generation += 1;
  state.phase = "idle";
  state.reason = reason;
}

/** Invoke stop callbacks without bumping generation (rapid-scan pause). */
export function pauseSessionDecoders(role: SessionRole): void {
  invokeStops(role);
}

/** Guide → player handoff: kill preview only so fullscreen can allocate safely. */
export function stopPreviewForFullscreen(): void {
  stopSession("preview", "superseded");
}

export function stopFullscreenSession(reason: SessionFailReason = "user-stop"): void {
  stopSession("fullscreen", reason);
}

/** Emergency: stop both roles (ErrorBoundary / process-wide recovery). */
export function stopAllPlaybackSessions(reason: SessionFailReason = "user-stop"): void {
  stopSession("preview", reason);
  stopSession("fullscreen", reason);
}

/** @deprecated Prefer role-scoped stop helpers. Kept as a named alias for clarity. */
export function forceStopAllStreams(): void {
  stopAllPlaybackSessions("user-stop");
}

/** Test/reset helper — clears registry state. */
export function resetPlaybackSessionsForTests(): void {
  for (const role of Object.keys(roles) as SessionRole[]) {
    roles[role].stops.clear();
    roles[role].generation = 0;
    roles[role].phase = "idle";
    roles[role].reason = null;
  }
}
