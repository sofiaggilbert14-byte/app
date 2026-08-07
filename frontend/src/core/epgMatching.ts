import type { Channel } from "@/src/api";

/** Normalize playlist / XMLTV ids and names for fuzzy guide matching. */
export function normalizeGuideKey(value: string | undefined | null): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type XmltvMatchIndexes = {
  idByNormalizedId: Map<string, string>;
  idByNormalizedName: Map<string, string>;
  idsWithPrograms: Set<string>;
};

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
    const key = normalizeGuideKey(id);
    if (key && !idByNormalizedId.has(key)) idByNormalizedId.set(key, id);
  }
  for (const [id, name] of Object.entries(input.channelNames || {})) {
    const key = normalizeGuideKey(name);
    if (key && !idByNormalizedName.has(key)) idByNormalizedName.set(key, id);
  }
  return { idByNormalizedId, idByNormalizedName, idsWithPrograms };
}

export type PlaylistXmltvMatch = {
  sourceId: string;
  logoId: string;
};

/**
 * Resolve a playlist channel to an XMLTV channel id (and optional logo id).
 * Prefer exact programme-bearing ids, then normalized id, then display-name.
 */
export function matchPlaylistChannelToXmltv(
  channel: Pick<Channel, "id" | "tvg_id" | "name">,
  indexes: XmltvMatchIndexes,
  logos: Record<string, string> = {},
): PlaylistXmltvMatch {
  const tvgId = (channel.tvg_id || "").trim();
  const { idByNormalizedId, idByNormalizedName, idsWithPrograms } = indexes;

  const exactProgramId = idsWithPrograms.size
    ? idsWithPrograms.has(tvgId)
      ? tvgId
      : idsWithPrograms.has(channel.id)
        ? channel.id
        : ""
    : tvgId || "";

  const normalizedIdMatch =
    idByNormalizedId.get(normalizeGuideKey(tvgId)) ||
    idByNormalizedId.get(normalizeGuideKey(channel.id)) ||
    "";
  const nameMatch = idByNormalizedName.get(normalizeGuideKey(channel.name)) || "";

  const sourceId = idsWithPrograms.size
    ? exactProgramId ||
      (normalizedIdMatch && idsWithPrograms.has(normalizedIdMatch) ? normalizedIdMatch : "") ||
      (nameMatch && idsWithPrograms.has(nameMatch) ? nameMatch : "")
    : exactProgramId || normalizedIdMatch || nameMatch || "";

  const logoId =
    (logos[tvgId] ? tvgId : "") ||
    (logos[channel.id] ? channel.id : "") ||
    (normalizedIdMatch && logos[normalizedIdMatch] ? normalizedIdMatch : "") ||
    (nameMatch && logos[nameMatch] ? nameMatch : "") ||
    (sourceId && logos[sourceId] ? sourceId : "");

  return { sourceId, logoId };
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
