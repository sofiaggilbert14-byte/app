/** Reminder rows are small, but unbounded KV growth still hurts weak Fire TV boxes. */
export const MAX_REMINDERS = 40;

export type ReminderLike = {
  key: string;
  notificationId?: string;
  channelId: string;
  channelName?: string;
  channelLogo?: string | null;
  programTitle?: string;
  programDesc?: string;
  start: string;
  stop?: string | null;
};

/** Keep upcoming / in-progress reminders only, newest first, capped. */
export function sanitizeReminders(raw: unknown, nowMs = Date.now()): ReminderLike[] {
  if (!Array.isArray(raw)) return [];
  const out: ReminderLike[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as ReminderLike;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const channelId = typeof row.channelId === "string" ? row.channelId.trim() : "";
    const start = typeof row.start === "string" ? row.start : "";
    if (!key || !channelId || !start || seen.has(key)) continue;
    const startMs = Date.parse(start);
    const stopMs = row.stop ? Date.parse(row.stop) : startMs + 3 * 60 * 60_000;
    // Drop reminders whose programme already ended.
    if (Number.isFinite(stopMs) && stopMs < nowMs - 5 * 60_000) continue;
    seen.add(key);
    out.push({
      key,
      notificationId: typeof row.notificationId === "string" ? row.notificationId : undefined,
      channelId,
      channelName: typeof row.channelName === "string" ? row.channelName : undefined,
      channelLogo: typeof row.channelLogo === "string" ? row.channelLogo : row.channelLogo ?? null,
      programTitle: typeof row.programTitle === "string" ? row.programTitle : undefined,
      programDesc: typeof row.programDesc === "string" ? row.programDesc : undefined,
      start,
      stop: row.stop ?? null,
    });
  }
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out.slice(0, MAX_REMINDERS);
}
