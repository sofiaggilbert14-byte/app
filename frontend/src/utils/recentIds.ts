/** Recent channels are ID strings only — never full Channel / program payloads. */
export const MAX_RECENT = 15;
export const MAX_RECENT_ID_LEN = 160;

function asRecentId(value: unknown): string | null {
  let id = "";
  if (typeof value === "string") id = value;
  else if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    // Migrate accidental object storage → id only.
    id = (value as { id: string }).id;
  }
  id = id.trim();
  if (!id || id.length > MAX_RECENT_ID_LEN) return null;
  if (id.includes("://") || id.startsWith("{") || id.startsWith("[")) return null;
  return id;
}

/** Normalize persisted recent entries to a compact unique ID list. */
export function sanitizeRecentIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = asRecentId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

export function pushRecentId(prev: string[], id: string): string[] {
  const clean = asRecentId(id);
  if (!clean) return prev;
  return [clean, ...prev.filter((item) => item !== clean)].slice(0, MAX_RECENT);
}
