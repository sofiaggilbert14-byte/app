export type GuideGroupTabPreferences = {
  aliases: Record<string, string>;
  hidden: string[];
  order: string[];
};

export const GUIDE_GROUP_TAB_MAX = 256;
export const GUIDE_GROUP_TAB_NAME_MAX = 48;
export const GUIDE_GROUP_RESERVED_ID = "All";

let snapshot: GuideGroupTabPreferences = { aliases: {}, hidden: [], order: [] };
let reverseAliases: Record<string, string> = {};

export function cleanGuideGroupName(value: unknown, max = 96): string {
  return String(value || "").replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = cleanGuideGroupName(item);
    if (!id || id === GUIDE_GROUP_RESERVED_ID || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= GUIDE_GROUP_TAB_MAX) break;
  }
  return out;
}

export function normalizeGuideGroupTabPreferences(raw: unknown): GuideGroupTabPreferences {
  const value = raw && typeof raw === "object" ? raw as Partial<GuideGroupTabPreferences> : {};
  const aliases: Record<string, string> = {};
  const usedLabels = new Set<string>();
  if (value.aliases && typeof value.aliases === "object") {
    let count = 0;
    for (const [rawId, rawLabel] of Object.entries(value.aliases)) {
      const id = cleanGuideGroupName(rawId);
      const label = cleanGuideGroupName(rawLabel, GUIDE_GROUP_TAB_NAME_MAX);
      const labelKey = label.toLowerCase();
      if (
        !id || id === GUIDE_GROUP_RESERVED_ID || !label || label === id ||
        label === GUIDE_GROUP_RESERVED_ID || usedLabels.has(labelKey)
      ) continue;
      aliases[id] = label;
      usedLabels.add(labelKey);
      count += 1;
      if (count >= GUIDE_GROUP_TAB_MAX) break;
    }
  }
  return { aliases, hidden: cleanList(value.hidden), order: cleanList(value.order) };
}

export function installGuideGroupTabPreferences(next: GuideGroupTabPreferences): GuideGroupTabPreferences {
  snapshot = normalizeGuideGroupTabPreferences(next);
  const reverse: Record<string, string> = {};
  for (const [id, label] of Object.entries(snapshot.aliases)) reverse[label] = id;
  reverseAliases = reverse;
  return snapshot;
}

export function getGuideGroupTabPreferencesSnapshot(): GuideGroupTabPreferences {
  return snapshot;
}

export function getGuideGroupDisplayName(groupId: string, aliases = snapshot.aliases): string {
  return aliases[groupId] || groupId;
}

/** O(1) hot-path lookup for Guide filtering across large channel lists. */
export function resolveGuideGroupIdentity(displayName: string): string {
  return reverseAliases[displayName] || displayName;
}

export function applyGuideGroupOrder(ids: string[], order: string[]): string[] {
  if (ids.length <= 1 || !order.length) return ids;
  const rank = new Map<string, number>();
  order.forEach((id, index) => rank.set(id, index));
  const original = new Map(ids.map((id, index) => [id, index]));
  return ids.slice().sort((a, b) => {
    if (a === GUIDE_GROUP_RESERVED_ID) return -1;
    if (b === GUIDE_GROUP_RESERVED_ID) return 1;
    const ar = rank.get(a);
    const br = rank.get(b);
    if (ar != null && br != null) return ar - br;
    return (original.get(a) ?? 0) - (original.get(b) ?? 0);
  });
}
