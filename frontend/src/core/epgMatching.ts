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
  /** Stable compact fingerprint of programme-bearing ids + names (not logos). */
  fingerprint: string;
};

export type EpgMatchOptions = {
  /** Messy providers: only exact/normalized tvg-id (and playlist id) — never name. */
  preferTvgIdOnly?: boolean;
  /** Which available logo source wins; the other remains as fallback. */
  logoPriority?: "playlist" | "epg";
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

function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Order-independent compact fingerprint. The previous implementation sorted and
 * joined every XMLTV id/name into one huge string, causing a large transient heap
 * spike on provider guides. Two commutative 32-bit accumulators + counts keep the
 * identity stable without materializing the full guide metadata twice.
 */
function compactIndexFingerprint(ids: Iterable<string>, names: Record<string, string>): string {
  let xorA = 0;
  let sumB = 0;
  let count = 0;
  let chars = 0;
  const add = (value: string) => {
    const a = hash32(value, 0x811c9dc5);
    const b = hash32(value, 0x9e3779b9);
    xorA = (xorA ^ a) >>> 0;
    sumB = (sumB + b) >>> 0;
    count += 1;
    chars += value.length;
  };
  for (const id of ids) add(`i:${id}`);
  for (const id in names) add(`n:${id}=${names[id]}`);
  return `xmltv-v2:${count}:${chars}:${xorA.toString(16)}:${sumB.toString(16)}`;
}

/** Build lookup maps from XMLTV channel metadata + programme channel ids. */
export function buildXmltvMatchIndexes(input: {
  channelIds: Iterable<string>;
  channelNames?: Record<string, string>;
  idsWithPrograms?: Iterable<string>;
}): XmltvMatchIndexes {
  const idByNormalizedId = new Map<string, string>();
  const idByNormalizedName = new Map<string, string>();
  const idsWithPrograms = new Set<string>();
  for (const id of input.idsWithPrograms || []) {
    if (typeof id !== "string") continue;
    const value = id.trim();
    if (value) idsWithPrograms.add(value);
  }

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

  const fingerprint = compactIndexFingerprint(idsWithPrograms, input.channelNames || {});

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
  const priority = only ? null : new Set(options.priorityChannelIds || []);

  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;
  const changedById = new Map<string, Channel>();

  const process = (channel: Channel) => {
    const result = matchPlaylistChannelToXmltv(channel, indexes, logos, { preferTvgIdOnly });
    if (result.ambiguous && !result.sourceId) ambiguous++;
    else if (result.sourceId) matched++;
    else unmatched++;

    const xmltvLogo = result.logoId ? (logos[result.logoId] || "").trim() : "";
    const playlistLogo = (channel.playlist_logo || (!channel.epg_logo ? channel.logo : "") || "").trim();
    const nextLogo = options.logoPriority === "epg"
      ? (xmltvLogo || playlistLogo || channel.logo || "")
      : (playlistLogo || xmltvLogo || channel.logo || "");
    const nextGuideId = result.sourceId || channel.tvg_id;

    if (nextLogo !== channel.logo || nextGuideId !== channel.tvg_id || playlistLogo !== (channel.playlist_logo || "") || xmltvLogo !== (channel.epg_logo || "")) {
      changedById.set(channel.id, { ...channel, tvg_id: nextGuideId, logo: nextLogo, playlist_logo: playlistLogo, epg_logo: xmltvLogo });
    }
  };

  if (only) {
    // Scan the source once but retain only changed subset rows. The old code put
    // every untouched channel in a second 6,000-entry Map during each viewport pass.
    for (const channel of channels) {
      if (only.has(channel.id)) process(channel);
    }
  } else if (priority && priority.size > 0) {
    // Preserve priority-first semantics without allocating two full filtered arrays.
    for (const channel of channels) if (priority.has(channel.id)) process(channel);
    for (const channel of channels) if (!priority.has(channel.id)) process(channel);
  } else {
    for (const channel of channels) process(channel);
  }

  const nextChannels = changedById.size
    ? channels.map((channel) => changedById.get(channel.id) || channel)
    : channels;
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
  logoPriority: "playlist" | "epg" = "playlist",
): Channel[] | null {
  if (!previousFingerprint || previousFingerprint !== nextFingerprint) return null;
  let changed = false;
  const next = channels.map((channel) => {
    const key = (channel.tvg_id || "").trim();
    const xmltvLogo = (key && logos[key] ? logos[key] : logos[channel.id] || "").trim();
    // Logo-only refresh must not infer provenance from the legacy `logo` field.
    // Before playlist_logo/epg_logo were stored separately, `logo` may have been
    // the previous XMLTV image. Treating it as a playlist logo would permanently
    // block fresh EPG logos under the default playlist-first policy.
    const playlistLogo = (channel.playlist_logo || "").trim();
    const legacyLogo = (channel.logo || "").trim();
    const nextLogo = logoPriority === "epg"
      ? (xmltvLogo || playlistLogo || legacyLogo)
      : (playlistLogo || xmltvLogo || legacyLogo);
    if (nextLogo === channel.logo && playlistLogo === (channel.playlist_logo || "") && xmltvLogo === (channel.epg_logo || "")) return channel;
    changed = true;
    return { ...channel, logo: nextLogo, playlist_logo: playlistLogo, epg_logo: xmltvLogo };
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
    return "Could not download the TV guide. Check the network and try Refresh.";
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
