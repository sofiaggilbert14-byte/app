import type { Channel } from "@/src/api";

/** Built-in buckets that are not raw playlist group names. */
export const SYSTEM_GROUPS = [
  "All",
  "Favorites",
] as const;

export const SMART_GROUPS = [
  "HD Only",
  "24/7",
  "Unmatched EPG",
  "Failed Streams",
] as const;

export const CURATED_GROUPS = ["Sports", "News", "Movies", "Kids", "Music"] as const;

export type SystemGroup = (typeof SYSTEM_GROUPS)[number];
export type SmartGroup = (typeof SMART_GROUPS)[number];

const CURATED_MATCH: Record<string, RegExp> = {
  Sports: /sport|nfl|nba|mlb|nhl|ufc|espn/,
  News: /news|weather|cnn|fox|msnbc|bbc|cnbc/,
  Movies: /movie|cinema|film|vod/,
  Kids: /kid|family|cartoon|nick|disney/,
  Music: /music|mtv|vh1|radio|hits/,
};

const HD_RE = /\b(uhd|fhd|hd|4k|1080|720)\b/i;
const ALLDAY_RE = /24\s*\/\s*7|24x7|247|all\s*day|pluto|samsung\s*tv\s*plus|xumo|tubi|free\s*tv/i;

export function isSmartGroup(group: string): group is SmartGroup {
  return (SMART_GROUPS as readonly string[]).includes(group);
}

export function isSystemGroup(group: string): boolean {
  return (SYSTEM_GROUPS as readonly string[]).includes(group);
}

export function channelMatchesCurated(channel: Channel, group: string): boolean {
  const re = CURATED_MATCH[group];
  if (!re) return channel.group === group;
  const value = `${channel.group || ""} ${channel.name || ""}`.toLowerCase();
  return re.test(value);
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
  if (group === "HD Only") {
    return HD_RE.test(`${channel.name || ""} ${channel.group || ""}`);
  }
  if (group === "24/7") {
    return ALLDAY_RE.test(`${channel.name || ""} ${channel.group || ""}`);
  }
  if (group === "Unmatched EPG") {
    return !opts.hasEpgMatch(channel);
  }
  if (group === "Failed Streams") {
    return opts.isFailed(channel.id);
  }
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
  },
): boolean {
  if (group === "All") return true;
  if (group === "Favorites") return opts.favoriteSet.has(channel.id);
  if (group === "Recently Watched") return opts.recentIds.has(channel.id);
  if (isSmartGroup(group)) return channelMatchesSmart(channel, group, opts);
  if ((CURATED_GROUPS as readonly string[]).includes(group)) {
    return channelMatchesCurated(channel, group);
  }
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
  },
): GroupCountMap {
  const counts: GroupCountMap = {
    All: 0,
    Favorites: 0,
    "Recently Watched": 0,
  };
  for (const smart of SMART_GROUPS) counts[smart] = 0;
  for (const curated of CURATED_GROUPS) counts[curated] = 0;

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
    const curatedValue = combined.toLowerCase();
    for (const curated of CURATED_GROUPS) {
      if (CURATED_MATCH[curated]?.test(curatedValue)) counts[curated] += 1;
    }
    const raw = String(channel.group || "").trim();
    if (raw) counts[raw] = (counts[raw] || 0) + 1;
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

/**
 * Visible group tabs: pinned order first, then system/smart/curated with counts,
 * then a capped slice of playlist groups (rest via "More groups").
 */
export function buildVisibleGroups(input: {
  counts: GroupCountMap;
  pinned: string[];
  playlistGroups: string[];
  maxPlaylistTabs?: number;
}): { tabs: string[]; overflow: string[] } {
  const maxPlaylistTabs = input.maxPlaylistTabs ?? 10;
  const seen = new Set<string>();
  const tabs: string[] = [];

  const push = (name: string) => {
    if (!name || seen.has(name)) return;
    if (name !== "All" && !(input.counts[name] > 0)) return;
    seen.add(name);
    tabs.push(name);
  };

  for (const name of input.pinned) push(name);
  for (const name of SYSTEM_GROUPS) push(name);
  for (const name of SMART_GROUPS) push(name);
  for (const name of CURATED_GROUPS) push(name);

  const overflow: string[] = [];
  let playlistAdded = 0;
  for (const name of input.playlistGroups) {
    if (seen.has(name)) continue;
    if (!(input.counts[name] > 0)) continue;
    if (playlistAdded < maxPlaylistTabs) {
      push(name);
      playlistAdded += 1;
    } else {
      overflow.push(name);
    }
  }
  return { tabs, overflow };
}

export function reorderPinned(pinned: string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || from >= pinned.length || to >= pinned.length || from === to) {
    return pinned;
  }
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
  },
): Channel[] {
  // Preserve identity when All has no hides/custom order (avoids native Guide rebuilds).
  if (group === "All" && opts.hiddenIds.size === 0 && opts.customOrder.length === 0) {
    return channels;
  }

  // Recently Watched is already a tiny bounded list in Store. Preserve its order
  // and avoid scanning the provider's full playlist just to rediscover those ids.
  if (group === "Recently Watched") {
    const list: Channel[] = [];
    for (const channel of opts.recent) {
      if (!opts.hiddenIds.has(channel.id)) list.push(channel);
    }
    return list;
  }

  // One provider-list pass. The former visible.filter(...).filter(...) chain held
  // two full arrays during Guide group changes, exactly when runway/cache state is
  // also being rebuilt on large IPTV playlists.
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
      })
    ) {
      list.push(channel);
    }
  }

  if (opts.customOrder.length && group === "All") {
    const rank = new Map<string, number>();
    for (let index = 0; index < opts.customOrder.length; index++) {
      rank.set(opts.customOrder[index], index);
    }
    list.sort((a, b) => {
      const ar = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const br = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
    });
    return list;
  }

  if (group !== "All") {
    list.sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }),
    );
  }
  return list;
}

export function searchChannelsInList(channels: Channel[], query: string): Channel[] {
  const q = query.trim().toLowerCase();
  if (!q) return channels;
  if (q.length > 48) return channels;
  return channels.filter((channel) => {
    const hay = `${channel.name || ""} ${channel.group || ""} ${channel.tvg_id || ""}`.toLowerCase();
    return hay.includes(q);
  });
}
