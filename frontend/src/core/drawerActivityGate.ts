import { useSyncExternalStore } from "react";

let suspended = false;
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of Array.from(listeners)) listener();
}

/**
 * Global ownership gate for the TV drawer. While open, pages may stay mounted
 * to preserve scroll/state, but playback/background work must not continue.
 */
export function setDrawerActivitySuspended(value: boolean): void {
  if (suspended === value) return;
  suspended = value;
  generation += 1;
  emit();
}

export function isDrawerActivitySuspended(): boolean {
  return suspended;
}

export function getDrawerActivityGeneration(): number {
  return generation;
}

export function subscribeDrawerActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDrawerActivityGate(): { suspended: boolean; generation: number } {
  const snapshot = useSyncExternalStore(
    subscribeDrawerActivity,
    () => `${suspended ? 1 : 0}:${generation}`,
    () => "0:0",
  );
  const [flag, gen] = snapshot.split(":");
  return { suspended: flag === "1", generation: Number(gen) || 0 };
}
