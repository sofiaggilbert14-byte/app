import type { Channel } from "@/src/api";

/** Normalize playlist / XMLTV ids and names for fuzzy guide matching. */
export function normalizeGuideKey(value: string | undefined | null): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Identity used for rematch decisions — logo URL changes must not force a full rematch. */
export function channelMatchIdentity(channel: Pick<Channel, "id" | "raw_tvg_id" | "tvg_id" | "name">): string {
  return `${channel.id}\0${(channel.raw_tvg_id || channel.tvg_id || "").trim()}\0${(channel.name || "").trim()}`;
}

export type XmltvMatchIndexes = {
  idByNormalizedId: Map<string, string>;
  idByNormalizedName: Map<string, string>;
  /** Normalized keys that map to more than one XMLTV channel — never invent a winner. */
  ambiguousNormalizedIds: Set<string>;
  ambiguousNormalizedNames: Set<string>;
  idsWithPrograms: Set<string>;
  /** Stable fingerprint of programme-bearing ids + names (not logos). */
  fingerprint: string;
};

export type EpgMatchOptions = {
  /** Messy providers: only exact/normalized tvg-id (and playlist id) — never name. */
  preferTvgIdOnly?: boolean;
};

export type PlaylistXmltvMatch = {
  sourceId: string;
  logoId: string;
  /** Ambiguous candidate existed; sourceId is always empty when true. */
  ambiguous: boolean;
};

export type EpgMatchQuality = {
  matched: number;
  ambiguous: number;
  unmatched: number;
};

const AMBIGUOUS_SENTINEL = "\0ambiguous";

function setUniqueOrAmbiguous(map: Map<string, string>, key: string, id: string): void {
  if (!key) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, id);
    return;
  }
  if (existing === id) return;
  // Two different XMLTV ids share this normalized key — mark ambiguous.
  map.set(key, AMBIGUOUS_SENTINEL);
}

/** Build lookup maps from XMLTV channel metadata + programme channel ids. */
export function buildXmltvMatchIndexes(input: {
  channelIds: Iterable<string>;
  channelNames?: Record<string, string>;
  idsWithPrograms?: Iterable<string>;
}): XmltvMatchIndexes {
  const idByNormalizedId = new Map<string, string>();
  const idByNormalizedName = new Map<string, string>();
  const idsWithPrograms = new Set(
    Array.from(input.idsWithPrograms || []).filter((id) => typeof id === "string" && id.trim()),
  );

  for (const id of input.channelIds) {
    if (typeof id !== "string" || !id.trim()) continue;
    setUniqueOrAmbiguous(idByNormalizedId, normalizeGuideKey(id), id);
  }
  for (const [id, name] of Object.entries(input.channelNames || {})) {
    if (!id.trim()) continue;
    setUniqueOrAmbiguous(idByNormalizedId, normalizeGuideKey(id), id);
    setUniqueOrAmbiguous(idByNormalizedName, normalizeGuideKey(name), id);
  }

  const ambiguousNormalizedIds = new Set<string>();
  const ambiguousNormalizedNames = new Set<string>();
  for (const [key, value] of idByNormalizedId) {
    if (value === AMBIGUOUS_SENTINEL) ambiguousNormalizedIds.add(key);
  }
  for (const [key, value] of idByNormalizedName) {
    if (value === AMBIGUOUS_SENTINEL) ambiguousNormalizedNames.add(key);
  }
  // Drop sentinels so lookups never return a fake channel id.
  for (const key of ambiguousNormalizedIds) idByNormalizedId.delete(key);
  for (const key of ambiguousNormalizedNames) idByNormalizedName.delete(key);

  const fingerprint = [
    ...Array.from(idsWithPrograms).sort(),
    ...Object.entries(input.channelNames || {})
      .map(([id, name]) => `${id}=${name}`)
      .sort(),
  ].join("|");

  return {
    idByNormalizedId,
    idByNormalizedName,
    ambiguousNormalizedIds,
    ambiguousNormalizedNames,
    idsWithPrograms,
    fingerprint,
  };
}

function resolveNormalizedId(
  key: string,
  map: Map<string, string>,
  ambiguous: Set<string>,
): { id: string; ambiguous: boolean } {
  if (!key) return { id: "", ambiguous: false };
  if (ambiguous.has(key)) return { id: "", ambiguous: true };
  return { id: map.get(key) || "", ambiguous: false };
}

/**
 * Resolve a playlist channel to an XMLTV channel id (and optional logo id).
 * Programme matches require an id known to carry programmes (strict).
 * Empty `idsWithPrograms` → no programme `sourceId` (avoids false matches).
 * Ambiguous normalized keys → no sourceId (never silently pick a winner).
 * Logos may still resolve from channel metadata alone when unambiguous.
 */
export function matchPlaylistChannelToXmltv(
  channel: Pick<Channel, "id" | "raw_tvg_id" | "tvg_id" | "name">,
  indexes: XmltvMatchIndexes,
  logos: Record<string, string> = {},
  options: EpgMatchOptions = {},
): PlaylistXmltvMatch {
  const tvgId = (channel.raw_tvg_id || channel.tvg_id || "").trim();
  const {
    idByNormalizedId,
    idByNormalizedName,
    ambiguousNormalizedIds,
    ambiguousNormalizedNames,
    idsWithPrograms,
  } = indexes;
  const preferTvgIdOnly = !!options.preferTvgIdOnly;

  const exactProgramId = idsWithPrograms.has(tvgId)
    ? tvgId
    : idsWithPrograms.has(channel.id)
      ? channel.id
      : "";

  const tvgNorm = resolveNormalizedId(normalizeGuideKey(tvgId), idByNormalizedId, ambiguousNormalizedIds);
  const idNorm = resolveNormalizedId(normalizeGuideKey(channel.id), idByNormalizedId, ambiguousNormalizedIds);
  const nameNorm = preferTvgIdOnly
    ? { id: "", ambiguous: false }
    : resolveNormalizedId(normalizeGuideKey(channel.name), idByNormalizedName, ambiguousNormalizedNames);

  const normalizedIdMatch = tvgNorm.id || idNorm.id || "";
  const nameMatch = nameNorm.id || "";
  const hitAmbiguous = tvgNorm.ambiguous || idNorm.ambiguous || nameNorm.ambiguous;

  let sourceId = "";
  let ambiguous = false;

  if (exactProgramId) {
    sourceId = exactProgramId;
  } else if (hitAmbiguous && !normalizedIdMatch && !nameMatch) {
    // Only ambiguous candidates — refuse to invent a match.
    ambiguous = true;
  } else if (normalizedIdMatch && idsWithPrograms.has(normalizedIdMatch)) {
    sourceId = normalizedIdMatch;
  } else if (nameMatch && idsWithPrograms.has(nameMatch)) {
    sourceId = nameMatch;
  } else if (hitAmbiguous) {
    ambiguous = true;
  }

  const logoId =
    (logos[tvgId] ? tvgId : "") ||
    (logos[channel.id] ? channel.id : "") ||
    (normalizedIdMatch && logos[normalizedIdMatch] ? normalizedIdMatch : "") ||
    (!preferTvgIdOnly && nameMatch && logos[nameMatch] ? nameMatch : "") ||
    (sourceId && logos[sourceId] ? sourceId : "");

  return { sourceId, logoId, ambiguous };
}

/** Apply matching across a channel list; optional priority ids are matched first (huge playlists). */
export function applyXmltvMatchesToChannels(
  channels: Channel[],
  indexes: XmltvMatchIndexes,
  logos: Record<string, string>,
  options: EpgMatchOptions & {
    /** Prefer rematching these channel ids first (current group / viewport). */
    priorityChannelIds?: Iterable<string>;
    /** When set, only these channel ids are rematched; others keep prior fields. */
    onlyChannelIds?: Iterable<string>;
  } = {},
): { channels: Channel[]; quality: EpgMatchQuality } {
  const preferTvgIdOnly = !!options.preferTvgIdOnly;
  const only = options.onlyChannelIds ? new Set(options.onlyChannelIds) : null;
  const priority = new Set(options.priorityChannelIds || []);
  const order =
    !only && priority.size > 0
      ? [
          ...channels.filter((c) => priority.has(c.id)),
          ...channels.filter((c) => !priority.has(c.id)),
        ]
      : channels;

  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;
  const byId = new Map<string, Channel>();

  for (const channel of order) {
    if (only && !only.has(channel.id)) {
      byId.set(channel.id, channel);
      continue;
    }
    const result = matchPlaylistChannelToXmltv(channel, indexes, logos, { preferTvgIdOnly });
    if (result.ambiguous && !result.sourceId) ambiguous++;
    else if (result.sourceId) matched++;
    else unmatched++;

    const xmltvLogo = result.logoId ? (logos[result.logoId] || "").trim() : "";
    const nextLogo = xmltvLogo || channel.logo || "";
    const nextGuideId = result.sourceId || channel.tvg_id;

    if (nextLogo === channel.logo && nextGuideId === channel.tvg_id) {
      byId.set(channel.id, channel);
    } else {
      byId.set(channel.id, { ...channel, tvg_id: nextGuideId, logo: nextLogo });
    }
  }

  const nextChannels = channels.map((c) => byId.get(c.id) || c);
  if (only) {
    // Partial pass — quality counts only cover the subset; caller may merge later.
    return { channels: nextChannels, quality: { matched, ambiguous, unmatched } };
  }
  return { channels: nextChannels, quality: { matched, ambiguous, unmatched } };
}

/** Merge two partial quality snapshots (phase1 + phase2) without double-counting. */
export function mergeMatchQuality(a: EpgMatchQuality, b: EpgMatchQuality): EpgMatchQuality {
  return {
    matched: a.matched + b.matched,
    ambiguous: a.ambiguous + b.ambiguous,
    unmatched: a.unmatched + b.unmatched,
  };
}

/**
 * Logo-only refresh path: reuse existing tvg_id matches; update logos without rematching.
 * Returns null when a full rematch is required (fingerprint drift or empty prior quality).
 */
export function applyLogoOnlyUpdates(
  channels: Channel[],
  logos: Record<string, string>,
  previousFingerprint: string | undefined,
  nextFingerprint: string,
): Channel[] | null {
  if (!previousFingerprint || previousFingerprint !== nextFingerprint) return null;
  let changed = false;
  const next = channels.map((channel) => {
    const key = (channel.tvg_id || "").trim();
    const xmltvLogo = (key && logos[key] ? logos[key] : logos[channel.id] || "").trim();
    if (!xmltvLogo || xmltvLogo === channel.logo) return channel;
    changed = true;
    return { ...channel, logo: xmltvLogo };
  });
  return changed ? next : channels;
}

export function emptyMatchQuality(): EpgMatchQuality {
  return { matched: 0, ambiguous: 0, unmatched: 0 };
}

/** User-facing copy for native EPG failures — keep technical detail available for diagnostics. */
export function formatNativeEpgError(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "Guide refresh failed";
  const lower = message.toLowerCase();
  if (lower.includes("native epg engine is unavailable")) {
    return "TV guide engine unavailable on this build. Channels still work; programme times cannot load.";
  }
  if (lower.includes("epg http") || lower.includes("failed to connect") || lower.includes("network")) {
    const httpStatus = message.match(/EPG HTTP\s+(\d{3})/i)?.[1];
    return `Could not download the TV guide${httpStatus ? ` (HTTP ${httpStatus})` : ""}. Check the network and try Refresh.`;
  }
  if (lower.includes("did not match") || lower.includes("channel ids")) {
    return "Guide downloaded, but channel IDs did not match the playlist.";
  }
  if (lower.includes("already in progress")) {
    return "A guide refresh is already running.";
  }
  if (lower.includes("not enough storage")) {
    return "Not enough storage to update Guide. The saved Guide is unchanged; free space and try again.";
  }
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}

/** Legacy cache / DB filenames safe to delete on Android (never the live native v3 DB). */
export const LEGACY_EPG_CLEANUP_NAMES = [
  "charm_epg_v1.db",
  "charm_epg_v1.db-wal",
  "charm_epg_v1.db-shm",
  "charm_native_channels_v1.json",
  "guide_cache_v4.json",
  "guide_cache_v5_meta.json",
  "guide_cache_v6_meta.json",
] as const;

export const LEGACY_EPG_CLEANUP_PREFIXES = ["guide_cache_v5_programs_"] as const;

export function shouldDeleteLegacyEpgName(name: string): boolean {
  if ((LEGACY_EPG_CLEANUP_NAMES as readonly string[]).includes(name)) return true;
  return LEGACY_EPG_CLEANUP_PREFIXES.some((prefix) => name.startsWith(prefix));
}

