import type { Channel } from "@/src/api";

/** Built-in buckets that are not raw playlist group names. */
export const SYSTEM_GROUPS = ["All", "Favorites"] as const;

export const SMART_GROUPS = [
  "HD Only",
  "24/7",
  "Unmatched EPG",
  "Failed Streams",
] as const;

/**
 * Charm-owned folders. Provider group names are classification hints only when
 * raw provider tabs are disabled. Classification is exclusive so one provider
 * category does not create several duplicate-looking tabs with the same rows.
 */
export const CURATED_GROUPS = [
  "Sports",
  "News",
  "Movies",
  "Kids",
  "Music",
  "Entertainment",
  "Documentary",
  "Lifestyle",
  "Local",
  "International",
  "Miscellaneous",
] as const;

export type SystemGroup = (typeof SYSTEM_GROUPS)[number];
export type SmartGroup = (typeof SMART_GROUPS)[number];
export type CuratedGroup = (typeof CURATED_GROUPS)[number];

const CURATED_MATCH: Array<[Exclude<CuratedGroup, "Miscellaneous">, RegExp]> = [
  ["Sports", /\b(sport|nfl|nba|mlb|nhl|ufc|mma|boxing|wwe|espn|golf|tennis|soccer|football|basketball|baseball|hockey|racing|f1)\b/i],
  ["News", /\b(news|weather|cnn|fox news|msnbc|bbc news|cnbc|newsmax|oann|al jazeera)\b/i],
  ["Kids", /\b(kid|kids|family|cartoon|nick|nickelodeon|disney|boomerang|pbs kids|junior)\b/i],
  ["Movies", /\b(movie|movies|cinema|film|films|premiere|hbo|showtime|starz|cinemax)\b/i],
  ["Music", /\b(music|mtv|vh1|radio|hits|vevo|concert)\b/i],
  ["Documentary", /\b(documentary|discovery|history|nat geo|national geographic|science|animal planet)\b/i],
  ["Lifestyle", /\b(lifestyle|food|cooking|travel|home|hgtv|diy|fashion|health|fitness)\b/i],
  ["Local", /\b(local|abc|cbs|nbc|fox|pbs|cw|my network|wbal|wmar|wjz|wbff)\b/i],
  ["International", /\b(international|latino|spanish|español|uk|canada|india|arabic|french|german|italian|africa|asia|caribbean)\b/i],
  ["Entertainment", /\b(entertainment|comedy|drama|reality|general|network|tv|amc|tnt|tbs|usa|fx|paramount|bravo|a&e|e!)\b/i],
];

const HD_RE = /\b(uhd|fhd|hd|4k|1080|720)\b/i;
const ALLDAY_RE = /24\s*\/\s*7|24x7|247|all\s*day|pluto|samsung\s*tv\s*plus|xumo|tubi|free\s*tv/i;

export function isSmartGroup(group: string): group is SmartGroup {
  return (SMART_GROUPS as readonly string[]).includes(group);
}

export function isSystemGroup(group: string): boolean {
  return (SYSTEM_GROUPS as readonly string[]).includes(group);
}

export function classifyCuratedGroup(channel: Channel): CuratedGroup {
  const value = `${channel.group || ""} ${channel.name || ""}`;
  for (const [name, re] of CURATED_MATCH) if (re.test(value)) return name;
  return "Miscellaneous";
}

export function channelMatchesCurated(channel: Channel, group: string): boolean {
  return classifyCuratedGroup(channel) === group;
}

export function channelMatchesSmart(
  channel: Channel,
  group: SmartGroup,
  opts: {
    favoriteSet?: Set<string>;
    hasEpgMatch: (channel: Channel) => boolean;
    isFailed: (channelId: string) => boolean;
  },
): boolean {
  if (group === "HD Only") return HD_RE.test(`${channel.name || ""} ${channel.group || ""}`);
  if (group === "24/7") return ALLDAY_RE.test(`${channel.name || ""} ${channel.group || ""}`);
  if (group === "Unmatched EPG") return !opts.hasEpgMatch(channel);
  if (group === "Failed Streams") return opts.isFailed(channel.id);
  return false;
}

export function channelInGroup(
  channel: Channel,
  group: string,
  opts: {
    favoriteSet: Set<string>;
    recentIds: Set<string>;
    hasEpgMatch: (channel: Channel) => boolean;
    isFailed: (channelId: string) => boolean;
    customGroups?: ReadonlyMap<string, ReadonlySet<string>>;
  },
): boolean {
  if (group === "All") return true;
  if (group === "Favorites") return opts.favoriteSet.has(channel.id);
  if (group === "Recently Watched") return opts.recentIds.has(channel.id);
  const custom = opts.customGroups?.get(group);
  if (custom) return custom.has(channel.id);
  if (isSmartGroup(group)) return channelMatchesSmart(channel, group, opts);
  if ((CURATED_GROUPS as readonly string[]).includes(group)) return channelMatchesCurated(channel, group);
  return channel.group === group;
}

export type GroupCountMap = Record<string, number>;

/** Single O(n) pass — safe to run when channels/favorites change, not per focus. */
export function buildGroupCounts(
  channels: Channel[],
  opts: {
    favoriteSet: Set<string>;
    recentIds: Set<string>;
    hasEpgMatch: (channel: Channel) => boolean;
    isFailed: (channelId: string) => boolean;
    hiddenIds: Set<string>;
    customGroups?: ReadonlyMap<string, ReadonlySet<string>>;
    includeProviderGroups?: boolean;
  },
): GroupCountMap {
  const counts: GroupCountMap = { All: 0, Favorites: 0, "Recently Watched": 0 };
  for (const smart of SMART_GROUPS) counts[smart] = 0;
  for (const curated of CURATED_GROUPS) counts[curated] = 0;
  for (const name of opts.customGroups?.keys() || []) counts[name] = 0;

  for (const channel of channels) {
    if (opts.hiddenIds.has(channel.id)) continue;
    counts.All += 1;
    if (opts.favoriteSet.has(channel.id)) counts.Favorites += 1;
    if (opts.recentIds.has(channel.id)) counts["Recently Watched"] += 1;
    const combined = `${channel.name || ""} ${channel.group || ""}`;
    if (HD_RE.test(combined)) counts["HD Only"] += 1;
    if (ALLDAY_RE.test(combined)) counts["24/7"] += 1;
    if (!opts.hasEpgMatch(channel)) counts["Unmatched EPG"] += 1;
    if (opts.isFailed(channel.id)) counts["Failed Streams"] += 1;
    counts[classifyCuratedGroup(channel)] += 1;
    for (const [name, ids] of opts.customGroups || []) if (ids.has(channel.id)) counts[name] += 1;
    if (opts.includeProviderGroups) {
      const raw = String(channel.group || "").trim();
      if (raw) counts[raw] = (counts[raw] || 0) + 1;
    }
  }
  return counts;
}

export function listPlaylistGroupNames(channels: Channel[], hiddenIds: Set<string>): string[] {
  const names = new Set<string>();
  for (const channel of channels) {
    if (hiddenIds.has(channel.id)) continue;
    const raw = String(channel.group || "").trim();
    if (!raw) continue;
    if (isSystemGroup(raw) || isSmartGroup(raw)) continue;
    if ((CURATED_GROUPS as readonly string[]).includes(raw)) continue;
    names.add(raw);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function buildVisibleGroups(input: {
  counts: GroupCountMap;
  pinned: string[];
  playlistGroups: string[];
  customGroups?: string[];
  hiddenGroups?: ReadonlySet<string>;
  showProviderGroups?: boolean;
  maxPlaylistTabs?: number;
}): { tabs: string[]; overflow: string[] } {
  const maxPlaylistTabs = input.maxPlaylistTabs ?? 10;
  const seen = new Set<string>();
  const tabs: string[] = [];
  const hidden = input.hiddenGroups || new Set<string>();

  const push = (name: string) => {
    if (!name || seen.has(name) || hidden.has(name)) return;
    if (name !== "All" && !(input.counts[name] > 0)) return;
    seen.add(name);
    tabs.push(name);
  };

  // All is the safety fallback and cannot be removed.
  push("All");
  for (const name of input.pinned) push(name);
  for (const name of SYSTEM_GROUPS) push(name);
  for (const name of SMART_GROUPS) push(name);
  for (const name of CURATED_GROUPS) push(name);
  for (const name of input.customGroups || []) push(name);

  const overflow: string[] = [];
  if (input.showProviderGroups) {
    let playlistAdded = 0;
    for (const name of input.playlistGroups) {
      if (seen.has(name) || hidden.has(name) || !(input.counts[name] > 0)) continue;
      if (playlistAdded < maxPlaylistTabs) {
        push(name);
        playlistAdded += 1;
      } else {
        overflow.push(name);
      }
    }
  }
  return { tabs, overflow };
}

export function reorderPinned(pinned: string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || from >= pinned.length || to >= pinned.length || from === to) return pinned;
  const next = pinned.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function pinGroup(pinned: string[], group: string): string[] {
  if (!group || pinned.includes(group)) return pinned;
  return [...pinned, group].slice(0, 24);
}

export function unpinGroup(pinned: string[], group: string): string[] {
  return pinned.filter((item) => item !== group);
}

export function filterChannelsByGroup(
  channels: Channel[],
  group: string,
  opts: {
    favoriteSet: Set<string>;
    recent: Channel[];
    recentIds: Set<string>;
    hasEpgMatch: (channel: Channel) => boolean;
    isFailed: (channelId: string) => boolean;
    hiddenIds: Set<string>;
    customOrder: string[];
    customGroups?: ReadonlyMap<string, ReadonlySet<string>>;
  },
): Channel[] {
  if (group === "All" && opts.hiddenIds.size === 0 && opts.customOrder.length === 0) return channels;

  if (group === "Recently Watched") {
    const list: Channel[] = [];
    for (const channel of opts.recent) if (!opts.hiddenIds.has(channel.id)) list.push(channel);
    return list;
  }

  const list: Channel[] = [];
  for (const channel of channels) {
    if (opts.hiddenIds.has(channel.id)) continue;
    if (
      group === "All" ||
      channelInGroup(channel, group, {
        favoriteSet: opts.favoriteSet,
        recentIds: opts.recentIds,
        hasEpgMatch: opts.hasEpgMatch,
        isFailed: opts.isFailed,
        customGroups: opts.customGroups,
      })
    ) list.push(channel);
  }

  if (opts.customOrder.length && group === "All") {
    const rank = new Map<string, number>();
    for (let index = 0; index < opts.customOrder.length; index++) rank.set(opts.customOrder[index], index);
    list.sort((a, b) => {
      const ar = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const br = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
    });
    return list;
  }

  if (group !== "All") {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }));
  }
  return list;
}

export function searchChannelsInList(channels: Channel[], query: string): Channel[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length > 48) return channels;
  return channels.filter((channel) => {
    const hay = `${channel.name || ""} ${channel.group || ""} ${channel.tvg_id || ""}`.toLowerCase();
    return hay.includes(q);
  });
}
