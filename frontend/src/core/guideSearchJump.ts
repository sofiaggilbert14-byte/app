/**
 * One-shot guide jump target set by Search (or Health). Consumed on Guide mount/focus.
 * Session-only — not persisted, not kept in React state across the app tree.
 */

export type GuideJumpTarget = {
  channelId: string;
  group?: string;
  programStart?: string;
};

let pending: GuideJumpTarget | null = null;

export function requestGuideJump(target: GuideJumpTarget): void {
  const channelId = String(target.channelId || "").trim();
  if (!channelId) return;
  pending = {
    channelId,
    group: target.group,
    programStart: target.programStart,
  };
}

export function consumeGuideJump(): GuideJumpTarget | null {
  const next = pending;
  pending = null;
  return next;
}

export function peekGuideJump(): GuideJumpTarget | null {
  return pending;
}
