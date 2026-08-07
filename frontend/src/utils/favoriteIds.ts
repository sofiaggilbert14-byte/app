/** Favorites are channel ID strings only — never full Channel / program payloads. */
export const MAX_FAVORITES = 1000;
export const MAX_FAVORITE_ID_LEN = 160;

function asFavoriteId(value: unknown): string | null {
  let id = "";
  if (typeof value === "string") id = value;
  else if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    // Migrate accidental object storage → id only.
    id = (value as { id: string }).id;
  }
  id = id.trim();
  if (!id || id.length > MAX_FAVORITE_ID_LEN) return null;
  // Reject fat accidental values (stream URLs, JSON blobs).
  if (id.includes("://") || id.startsWith("{") || id.startsWith("[")) return null;
  return id;
}

/** Normalize persisted favorites to a compact unique ID list. */
export function sanitizeFavoriteIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = asFavoriteId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

export function toggleFavoriteId(prev: string[], id: string): string[] {
  const clean = asFavoriteId(id);
  if (!clean) return prev;
  const set = new Set(prev);
  if (set.has(clean)) {
    set.delete(clean);
  } else {
    if (set.size >= MAX_FAVORITES) return prev;
    set.add(clean);
  }
  return Array.from(set);
}
