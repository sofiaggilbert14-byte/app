import type { Channel } from "@/src/api";
import {
  applyGuideGroupOrder,
  getGuideGroupDisplayName,
  getGuideGroupTabPreferencesSnapshot,
  resolveGuideGroupIdentity,
} from "./guideGroupTabPreferences.ts";

/** Built-in buckets that are not raw playlist group names. */
export const SYSTEM_GROUPS = ["All", "Favorites"] as const;

export const SMART_GROUPS = [
  "HD Only",
  "24/7",
  "Unmatched EPG",
  "Failed Streams",
] as const;

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

const CURATED_MATCH: [Exclude<CuratedGroup, "Miscellaneous">, RegExp][] = [
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

function displayGroup(groupId: string): string {
  return getGuideGroupDisplayName(groupId);
}

export function isSmartGroup(group: string): group is SmartGroup {
  return (SMART_GROUPS as readonly string[]).includes(resolveGuideGroupIdentity(group));
}

export function isSystemGroup(group: string): boolean {
  return (SYSTEM_GROUPS as readonly string[]).includes(resolveGuideGroupIdentity(group));
}

export function classifyCuratedGroup(channel: Channel): CuratedGroup {
  const value = `${channel.group || ""} ${channel.name || ""}`;
  for (const [name, re] of CURATED_MATCH) if (re.test(value)) return name;
  return "Miscellaneous";
}

export function channelMatchesCurated(channel: Channel, group: string): boolean {
  return classifyCuratedGroup(channel) === resolveGuideGroupIdentity(group);
}

export function channelMatchesSmart(
  channel: Channel,
  group: SmartGroup | string,
  opts: {
    favoriteSet?: Set<string>;
    hasEpgMatch: (channel: Channel) => boolean;
    isFailed: (channelId: string) => boolean;
  },
): boolean {
  const sourceGroup = resolveGuideGroupIdentity(group);
  if (sourceGroup === "HD Only") return HD_RE.test(`${channel.name || ""} ${channel.group || ""}`);
  if (sourceGroup === "24/7") return ALLDAY_RE.test(`${channel.name || ""} ${channel.group || ""}`);
  if (sourceGroup === "Unmatched EPG") return !opts.hasEpgMatch(channel);
  if (sourceGroup === "Failed Streams") return opts.isFailed(channel.id);
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
  const sourceGroup = resolveGuideGroupIdentity(group);
  if (sourceGroup === "All") return true;
  if (sourceGroup === "Favorites") return opts.favoriteSet.has(channel.id);
  if (sourceGroup === "Recently Watched") return opts.recentIds.has(channel.id);
  // Custom tabs are displayed by mutable names but tab metadata is keyed by the
  // immutable custom-group id. Resolve the stable id first, then fall back to its
  // display label so legacy membership maps continue working during migration.
  const custom = opts.customGroups?.get(sourceGroup) || opts.customGroups?.get(displayGroup(sourceGroup));
  if (custom) return custom.has(channel.id);
  if ((SMART_GROUPS as readonly string[]).includes(sourceGroup)) return channelMatchesSmart(channel, sourceGroup, opts);
  if ((CURATED_GROUPS as readonly string[]).includes(sourceGroup)) return channelMatchesCurated(channel, sourceGroup);
  return channel.group === sourceGroup;
}

export type GroupCountMap = Record<string, number>;

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
  const counts: GroupCountMap = {
    [displayGroup("All")]: 0,
    [displayGroup("Favorites")]: 0,
    [displayGroup("Recently Watched")]: 0,
  };
  for (const smart of SMART_GROUPS) counts[displayGroup(smart)] = 0;
  for (const curated of CURATED_GROUPS) counts[displayGroup(curated)] = 0;
  for (const name of opts.customGroups?.keys() || []) counts[displayGroup(name)] = 0;

  for (const channel of channels) {
    if (opts.hiddenIds.has(channel.id)) continue;
    counts[displayGroup("All")] += 1;
    if (opts.favoriteSet.has(channel.id)) counts[displayGroup("Favorites")] += 1;
    if (opts.recentIds.has(channel.id)) counts[displayGroup("Recently Watched")] += 1;
    const combined = `${channel.name || ""} ${channel.group || ""}`;
    if (HD_RE.test(combined)) counts[displayGroup("HD Only")] += 1;
    if (ALLDAY_RE.test(combined)) counts[displayGroup("24/7")] += 1;
    if (!opts.hasEpgMatch(channel)) counts[displayGroup("Unmatched EPG")] += 1;
    if (opts.isFailed(channel.id)) counts[displayGroup("Failed Streams")] += 1;
    const curated = displayGroup(classifyCuratedGroup(channel));
    counts[curated] = (counts[curated] || 0) + 1;
    for (const [name, ids] of opts.customGroups || []) {
      if (ids.has(channel.id)) {
        const label = displayGroup(name);
        counts[label] = (counts[label] || 0) + 1;
      }
    }
    if (opts.includeProviderGroups) {
      const raw = String(channel.group || "").trim();
      if (raw) {
        const label = displayGroup(raw);
        counts[label] = (counts[label] || 0) + 1;
      }
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
    if ((SYSTEM_GROUPS as readonly string[]).includes(raw) || (SMART_GROUPS as readonly string[]).includes(raw)) continue;
    if ((CURATED_GROUPS as readonly string[]).includes(raw)) continue;
    names.add(displayGroup(raw));
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
  const tabPrefs = getGuideGroupTabPreferencesSnapshot();
  const maxPlaylistTabs = input.maxPlaylistTabs ?? 10;
  const seen = new Set<string>();
  const tabs: string[] = [];
  const hidden = new Set(input.hiddenGroups || []);
  for (const id of tabPrefs.hidden) hidden.add(displayGroup(id));

  const push = (rawName: string) => {
    const name = displayGroup(rawName);
    if (!name || seen.has(name) || hidden.has(name)) return;
    if (resolveGuideGroupIdentity(name) !== "All" && !(input.counts[name] > 0)) return;
    seen.add(name);
    tabs.push(name);
  };

  push("All");
  for (const name of input.pinned) push(resolveGuideGroupIdentity(name));
  for (const name of SYSTEM_GROUPS) push(name);
  for (const name of SMART_GROUPS) push(name);
  for (const name of CURATED_GROUPS) push(name);
  for (const name of input.customGroups || []) push(name);

  const overflow: string[] = [];
  if (input.showProviderGroups) {
    let playlistAdded = 0;
    for (const displayName of input.playlistGroups) {
      const name = displayGroup(resolveGuideGroupIdentity(displayName));
      if (seen.has(name) || hidden.has(name) || !(input.counts[name] > 0)) continue;
      if (playlistAdded < maxPlaylistTabs) {
        seen.add(name);
        tabs.push(name);
        playlistAdded += 1;
      } else {
        overflow.push(name);
      }
    }
  }

  const displayOrder = tabPrefs.order.map(displayGroup);
  return {
    tabs: applyGuideGroupOrder(tabs, displayOrder),
    overflow: applyGuideGroupOrder(overflow, displayOrder),
  };
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
  const sourceGroup = resolveGuideGroupIdentity(group);
  if (sourceGroup === "All" && opts.hiddenIds.size === 0 && opts.customOrder.length === 0) return channels;

  if (sourceGroup === "Recently Watched") {
    const list: Channel[] = [];
    for (const channel of opts.recent) if (!opts.hiddenIds.has(channel.id)) list.push(channel);
    return list;
  }

  const list: Channel[] = [];
  for (const channel of channels) {
    if (opts.hiddenIds.has(channel.id)) continue;
    if (
      sourceGroup === "All" ||
      channelInGroup(channel, sourceGroup, {
        favoriteSet: opts.favoriteSet,
        recentIds: opts.recentIds,
        hasEpgMatch: opts.hasEpgMatch,
        isFailed: opts.isFailed,
        customGroups: opts.customGroups,
      })
    ) list.push(channel);
  }

  if (opts.customOrder.length) {
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

  if (sourceGroup !== "All") {
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
