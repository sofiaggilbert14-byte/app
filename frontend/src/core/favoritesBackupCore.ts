import type { Channel } from "@/src/api";

export const FAVORITES_BACKUP_FORMAT = "charmiptv-favorites";
export const FAVORITES_BACKUP_VERSION = 1;

export type FavoriteIdentity = { id: string; tvgId: string; name: string };
export type FavoritesBackupV1 = {
  format: typeof FAVORITES_BACKUP_FORMAT;
  version: typeof FAVORITES_BACKUP_VERSION;
  exportedAt: string;
  favorites: FavoriteIdentity[];
};
export type FavoritesRestoreUnavailable = FavoriteIdentity & {
  reason: "not-found" | "no-playable-stream" | "ambiguous-tvg-id" | "ambiguous-name";
};
export type FavoritesRestoreResult = string[] & {
  unavailable: FavoritesRestoreUnavailable[];
  sourceCount: number;
};

function normalized(value?: string): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function playable(channel?: Channel): channel is Channel {
  return !!channel && typeof channel.url === "string" && channel.url.trim().length > 0;
}

export function serializeFavoritesBackup(favoriteIds: string[], channels: Channel[], now = new Date()): string {
  const favoriteSet = new Set(favoriteIds);
  const favorites: FavoriteIdentity[] = channels
    .filter((channel) => favoriteSet.has(channel.id))
    .map((channel) => ({ id: channel.id, tvgId: channel.tvg_id || "", name: channel.name || "" }));

  for (const id of favoriteIds) {
    if (!favorites.some((item) => item.id === id)) favorites.push({ id, tvgId: "", name: "" });
  }

  return JSON.stringify({
    format: FAVORITES_BACKUP_FORMAT,
    version: FAVORITES_BACKUP_VERSION,
    exportedAt: now.toISOString(),
    favorites,
  } satisfies FavoritesBackupV1);
}

function addGrouped(map: Map<string, Channel[]>, key: string, channel: Channel) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(channel);
  else map.set(key, [channel]);
}

export function resolveFavoritesBackup(raw: string, channels: Channel[]): FavoritesRestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  const payload = parsed as Partial<FavoritesBackupV1>;
  if (
    payload?.format !== FAVORITES_BACKUP_FORMAT ||
    payload.version !== FAVORITES_BACKUP_VERSION ||
    !Array.isArray(payload.favorites)
  ) throw new Error("This is not a supported CharmIPTV favorites backup.");

  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const byTvgId = new Map<string, Channel[]>();
  const byName = new Map<string, Channel[]>();
  for (const channel of channels) {
    addGrouped(byTvgId, normalized(channel.tvg_id), channel);
    addGrouped(byName, normalized(channel.name), channel);
  }

  const restored = new Set<string>();
  const unavailable: FavoritesRestoreUnavailable[] = [];
  for (const item of payload.favorites) {
    if (!item || typeof item !== "object") continue;
    const identity = item as Partial<FavoriteIdentity>;
    const id = typeof identity.id === "string" ? identity.id : "";
    const tvgIdRaw = typeof identity.tvgId === "string" ? identity.tvgId : "";
    const nameRaw = typeof identity.name === "string" ? identity.name : "";
    const tvgId = normalized(tvgIdRaw);
    const name = normalized(nameRaw);
    let matched: Channel | undefined;
    let reason: FavoritesRestoreUnavailable["reason"] = "not-found";
    let sawUnplayableCandidate = false;

    const exact = id ? byId.get(id) : undefined;
    if (exact) {
      if (playable(exact)) matched = exact;
      else sawUnplayableCandidate = true;
    }
    if (!matched && tvgId) {
      const candidates = byTvgId.get(tvgId) || [];
      const playableCandidates = candidates.filter(playable);
      if (playableCandidates.length === 1) matched = playableCandidates[0];
      else if (playableCandidates.length > 1) reason = "ambiguous-tvg-id";
      else if (candidates.length) sawUnplayableCandidate = true;
    }
    if (!matched && name) {
      const candidates = byName.get(name) || [];
      if (candidates.length === 1) {
        if (playable(candidates[0])) matched = candidates[0];
        else sawUnplayableCandidate = true;
      }
      else if (candidates.length > 1) reason = "ambiguous-name";
    }

    if (matched) restored.add(matched.id);
    else {
      if (sawUnplayableCandidate) reason = "no-playable-stream";
      unavailable.push({ id, tvgId: tvgIdRaw, name: nameRaw, reason });
    }
  }

  const result = Array.from(restored) as FavoritesRestoreResult;
  result.unavailable = unavailable;
  result.sourceCount = payload.favorites.length;
  return result;
}
