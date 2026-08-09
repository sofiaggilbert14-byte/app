/**
 * Bounded in-memory registry of channels that recently failed to play.
 * Used for the "Failed streams" smart group and Health view — never persisted.
 */

const MAX_ENTRIES = 80;
const failedAtById = new Map<string, number>();

export function noteStreamFailure(channelId: string, at = Date.now()): void {
  const id = String(channelId || "").trim();
  if (!id) return;
  failedAtById.delete(id);
  failedAtById.set(id, at);
  while (failedAtById.size > MAX_ENTRIES) {
    const oldest = failedAtById.keys().next().value;
    if (!oldest) break;
    failedAtById.delete(oldest);
  }
}

export function clearStreamFailure(channelId: string): void {
  failedAtById.delete(String(channelId || "").trim());
}

export function isFailedChannel(channelId: string): boolean {
  return failedAtById.has(String(channelId || "").trim());
}

export function listFailedChannelIds(): string[] {
  return Array.from(failedAtById.keys()).reverse();
}

export function failedStreamCount(): number {
  return failedAtById.size;
}
