import type { Channel } from "@/src/api";
import { classifyChannelFolder, DEFAULT_CHANNEL_FOLDERS } from "@/src/core/channelFolderClassifier";
import type { ChannelGroupPreferences, CustomChannelGroup } from "@/src/core/channelGroupPreferences";
import { SMART_GROUPS, isSmartGroup, channelMatchesSmart } from "@/src/core/guideGroups";

export type Phase9GroupCountMap = Record<string, number>;

const SYSTEM_GROUPS = ["All", "Favorites"] as const;

function customGroupByName(customGroups: CustomChannelGroup[], name: string): CustomChannelGroup | undefined {
  return customGroups.find((group) => group.name === name);
}

export function listProviderGroupNames(
  channels: Channel[],
  hiddenIds: ReadonlySet<string>,
  prefs: ChannelGroupPreferences,
): string[] {
  if (!prefs.showProviderGroups) return [];
  const names = new Set<string>();
  for (const channel of channels) {
    if (hiddenIds.has(channel.id)) continue;
    const raw = String(channel.group || "").trim();
    if (raw) names.add(raw);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function buildPhase9GroupCounts(
  channels: Channel[],
  opts: {
    favoriteSet: Set<string>;
    recentIds: Set<string>;
    hasEpgMatch: (channel: Channel) => boolean;
    isFailed: (channelId: string) => boolean;
    hiddenIds: Set<string>;
  },
  prefs: ChannelGroupPreferences,
): Phase9GroupCountMap {
  const counts: Phase9GroupCountMap = { All: 0, Favorites: 0, "Recently Watched": 0 };
  for (const smart of SMART_GROUPS) counts[smart] = 0;
  for (const folder of DEFAULT_CHANNEL_FOLDERS) counts[folder] = 0;
  for (const custom of prefs.customGroups) counts[custom.name] = 0;

  const customMembership = new Map<string, Set<string>>();
  for (const custom of prefs.customGroups) customMembership.set(custom.name, new Set(custom.channelIds));

  for (const channel of channels) {
    if (opts.hiddenIds.has(channel.id)) continue;
    counts.All += 1;
    if (opts.favoriteSet.has(channel.id)) counts.Favorites += 1;
    if (opts.recentIds.has(channel.id)) counts["Recently Watched"] += 1;
    const folder = classifyChannelFolder(channel);
    counts[folder] = (counts[folder] || 0) + 1;
    for (const smart of SMART_GROUPS) {
      if (channelMatchesSmart(channel, smart, {
        favoriteSet: opts.favoriteSet,
        hasEpgMatch: opts.hasEpgMatch,
        isFailed: opts.isFailed,
      })) counts[smart] += 1;
    }
    for (const [name, ids] of customMembership) {
      if (ids.has(channel.id)) counts[name] = (counts[name] || 0) + 1;
    }
    if (prefs.showProviderGroups) {
      const raw = String(channel.group || "").trim();
      if (raw) counts[raw] = (counts[raw] || 0) + 1;
    }
  }
  return counts;
}

export function buildPhase9VisibleGroups(input: {
  counts: Phase9GroupCountMap;
  pinned: string[];
  providerGroups: string[];
  prefs: ChannelGroupPreferences;
}): string[] {
  const hidden = new Set(input.prefs.hiddenBuiltInGroups);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (name: string, builtIn = false) => {
    if (!name || seen.has(name)) return;
    if (builtIn && hidden.has(name)) return;
    if (name !== "All" && !(input.counts[name] > 0)) return;
    seen.add(name);
    out.push(name);
  };

  for (const name of input.pinned) push(name);
  for (const name of SYSTEM_GROUPS) push(name, true);
  if (input.counts["Recently Watched"] > 0) push("Recently Watched", true);
  for (const name of SMART_GROUPS) push(name, true);
  for (const name of DEFAULT_CHANNEL_FOLDERS) push(name, true);
  for (const custom of input.prefs.customGroups) {
    if (custom.visible) push(custom.name);
  }
  if (input.prefs.showProviderGroups) {
    for (const name of input.providerGroups) push(name);
  }
  return out;
}

export function filterPhase9ChannelsByGroup(
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
  prefs: ChannelGroupPreferences,
): Channel[] {
  if (group === "All" && opts.hiddenIds.size === 0 && opts.customOrder.length === 0) return channels;
  if (group === "Recently Watched") {
    const recent: Channel[] = [];
    for (const channel of opts.recent) if (!opts.hiddenIds.has(channel.id)) recent.push(channel);
    return recent;
  }

  const custom = customGroupByName(prefs.customGroups, group);
  const customIds = custom ? new Set(custom.channelIds) : null;
  const isDefaultFolder = (DEFAULT_CHANNEL_FOLDERS as readonly string[]).includes(group);
  const list: Channel[] = [];
  for (const channel of channels) {
    if (opts.hiddenIds.has(channel.id)) continue;
    let include = false;
    if (group === "All") include = true;
    else if (group === "Favorites") include = opts.favoriteSet.has(channel.id);
    else if (customIds) include = customIds.has(channel.id);
    else if (isDefaultFolder) include = classifyChannelFolder(channel) === group;
    else if (isSmartGroup(group)) {
      include = channelMatchesSmart(channel, group, {
        favoriteSet: opts.favoriteSet,
        hasEpgMatch: opts.hasEpgMatch,
        isFailed: opts.isFailed,
      });
    } else if (prefs.showProviderGroups) {
      include = String(channel.group || "").trim() === group;
    }
    if (include) list.push(channel);
  }

  if (opts.customOrder.length && group === "All") {
    const rank = new Map<string, number>();
    for (let index = 0; index < opts.customOrder.length; index += 1) rank.set(opts.customOrder[index], index);
    list.sort((a, b) => {
      const ar = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const br = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
    });
  } else if (group !== "All") {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }));
  }
  return list;
}
