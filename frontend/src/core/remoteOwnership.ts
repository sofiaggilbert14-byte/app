import { setNativeRemoteOwner, type TvRemoteOwner } from "@/src/utils/tvRemote";

export type RemoteOwner = TvRemoteOwner;

type Claim = {
  token: number;
  owner: RemoteOwner;
};

let nextToken = 1;
const claims: Claim[] = [];
let appliedOwner: RemoteOwner = "APP";
const listeners = new Set<(owner: RemoteOwner) => void>();

function applyTopOwner(): void {
  const next = claims.length ? claims[claims.length - 1].owner : "APP";
  if (next === appliedOwner) return;
  appliedOwner = next;
  setNativeRemoteOwner(next);
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try {
      listener(next);
    } catch {
      // Remote ownership must never be blocked by a UI observer.
    }
  }
}

export function getRemoteOwner(): RemoteOwner {
  return appliedOwner;
}

export function claimRemoteOwner(owner: RemoteOwner): () => void {
  const token = nextToken++;
  claims.push({ token, owner });
  applyTopOwner();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = claims.findIndex((claim) => claim.token === token);
    if (index >= 0) claims.splice(index, 1);
    applyTopOwner();
  };
}

export function subscribeRemoteOwner(listener: (owner: RemoteOwner) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetRemoteOwnership(): void {
  claims.length = 0;
  applyTopOwner();
}
