import { useSyncExternalStore } from "react";
import type { Program } from "@/src/api";

export type GuideSelection = {
  channelId: string | null;
  program: Program | null;
  surface: "channel" | "program";
};

const EMPTY_SELECTION: GuideSelection = { channelId: null, program: null, surface: "program" };
let snapshot: GuideSelection = EMPTY_SELECTION;
const listeners = new Set<() => void>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;

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

function scheduleEmit(): void {
  if (emitTimer) return;
  // Keep preview metadata renders out of the native onFocus callback. Multiple
  // D-pad events in one JS turn collapse to the newest selection.
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emit();
  }, 0);
}

export function getGuideSelection(): GuideSelection {
  return snapshot;
}

export function setGuideFocusedProgram(channelId: string, program: Program, surface: "channel" | "program" = "program"): void {
  if (!channelId || !program?.start) return;
  if (
    snapshot.channelId === channelId &&
    snapshot.program?.start === program.start &&
    snapshot.program?.stop === program.stop &&
    snapshot.program?.title === program.title &&
    snapshot.surface === surface
  ) {
    return;
  }
  snapshot = { channelId, program, surface };
  scheduleEmit();
}

export function setGuideFocusedChannel(channelId: string, surface: "channel" | "program"): void {
  if (!channelId) return;
  if (snapshot.channelId === channelId && snapshot.program === null && snapshot.surface === surface) return;
  snapshot = { channelId, program: null, surface };
  scheduleEmit();
}

export function resetGuideSelection(channelId: string | null = null): void {
  const next: GuideSelection = channelId ? { channelId, program: null, surface: "program" } : EMPTY_SELECTION;
  if (snapshot.channelId === next.channelId && snapshot.program === next.program) return;
  snapshot = next;
  scheduleEmit();
}

export function subscribeGuideSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGuideSelection(): GuideSelection {
  return useSyncExternalStore(subscribeGuideSelection, getGuideSelection, getGuideSelection);
}

