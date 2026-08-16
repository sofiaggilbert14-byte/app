/**
 * Guide rapid-surf gate — while the user holds D-pad, defer full silent
 * guide rebuilds so logical focus and native data are not thrashed by setChannels.
 */

let surfingUntil = 0;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const settleListeners = new Set<() => void>();

export function markGuideSurfing(holdMs = 700): void {
  const until = Date.now() + Math.max(120, holdMs);
  if (until > surfingUntil) surfingUntil = until;
  if (settleTimer) clearTimeout(settleTimer);
  const wait = Math.max(16, surfingUntil - Date.now() + 24);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (isGuideSurfing()) {
      markGuideSurfing(Math.max(0, surfingUntil - Date.now()));
      return;
    }
    for (const listener of Array.from(settleListeners)) {
      if (!settleListeners.has(listener)) continue;
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
  }, wait);
}

export function isGuideSurfing(): boolean {
  return Date.now() < surfingUntil;
}

export function onGuideSurfSettled(listener: () => void): () => void {
  settleListeners.add(listener);
  return () => {
    settleListeners.delete(listener);
  };
}
