import { useSyncExternalStore } from "react";
import type { Program } from "@/src/api";

export type GuideSelection = {
  channelId: string | null;
  program: Program | null;
};

const EMPTY_SELECTION: GuideSelection = { channelId: null, program: null };
let snapshot: GuideSelection = EMPTY_SELECTION;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try {
      listener();
    } catch {
      // Preview metadata must never block native focus movement.
    }
  }
}

export function getGuideSelection(): GuideSelection {
  return snapshot;
}

export function setGuideFocusedProgram(channelId: string, program: Program): void {
  if (!channelId || !program?.start) return;
  if (
    snapshot.channelId === channelId &&
    snapshot.program?.start === program.start &&
    snapshot.program?.stop === program.stop &&
    snapshot.program?.title === program.title
  ) {
    return;
  }
  snapshot = { channelId, program };
  emit();
}

export function resetGuideSelection(channelId: string | null = null): void {
  const next = channelId ? { channelId, program: null } : EMPTY_SELECTION;
  if (snapshot.channelId === next.channelId && snapshot.program === next.program) return;
  snapshot = next;
  emit();
}

export function subscribeGuideSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGuideSelection(): GuideSelection {
  return useSyncExternalStore(subscribeGuideSelection, getGuideSelection, getGuideSelection);
}
