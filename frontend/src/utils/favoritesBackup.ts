import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { Channel } from "@/src/api";

const FORMAT = "charmiptv-favorites";
const VERSION = 1;
const FILE_PREFIX = "CharmIPTV-Favorites-";
const FILE_SUFFIX = ".json";

type FavoriteIdentity = {
  id: string;
  tvgId: string;
  name: string;
};

type FavoritesBackupV1 = {
  format: typeof FORMAT;
  version: typeof VERSION;
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

function timestampForFile(date = new Date()): string {
  const p = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function localBackupDir(): string {
  const root = FileSystem.documentDirectory || "";
  return root ? `${root}favorites-backups/` : "";
}

async function ensureLocalBackupDir(): Promise<string> {
  const dir = localBackupDir();
  if (!dir) throw new Error("App storage is unavailable for favorites backup.");
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export function serializeFavoritesBackup(favoriteIds: string[], channels: Channel[]): string {
  const favoriteSet = new Set(favoriteIds);
  const favorites: FavoriteIdentity[] = channels
    .filter((channel) => favoriteSet.has(channel.id))
    .map((channel) => ({
      id: channel.id,
      tvgId: channel.tvg_id || "",
      name: channel.name || "",
    }));

  for (const id of favoriteIds) {
    if (!favorites.some((item) => item.id === id)) {
      favorites.push({ id, tvgId: "", name: "" });
    }
  }

  const payload: FavoritesBackupV1 = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    favorites,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
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
  if (payload?.format !== FORMAT || payload.version !== VERSION || !Array.isArray(payload.favorites)) {
    throw new Error("This is not a supported CharmIPTV favorites backup.");
  }

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
      } else if (candidates.length > 1) {
        reason = "ambiguous-name";
      }
    }

    if (matched) {
      restored.add(matched.id);
      continue;
    }

    if (sawUnplayableCandidate) reason = "no-playable-stream";
    unavailable.push({ id, tvgId: tvgIdRaw, name: nameRaw, reason });
  }

  const result = Array.from(restored) as FavoritesRestoreResult;
  result.unavailable = unavailable;
  result.sourceCount = payload.favorites.length;
  return result;
}

async function readValidBackupCandidate(uri: string, name: string): Promise<{ fileName: string; raw: string } | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
    const parsed = JSON.parse(raw) as Partial<FavoritesBackupV1>;
    if (parsed?.format === FORMAT && parsed.version === VERSION && Array.isArray(parsed.favorites)) {
      return { fileName: name, raw };
    }
  } catch {}
  return null;
}

/** TV-friendly default: write into app documents (no SAF folder picker required). */
export async function writeFavoritesBackup(raw: string): Promise<string> {
  if (Platform.OS === "web") {
    throw new Error("Portable favorites backup is currently available on Android/TV builds.");
  }

  const dir = await ensureLocalBackupDir();
  const fileName = `${FILE_PREFIX}${timestampForFile()}${FILE_SUFFIX}`;
  const path = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(path, raw, { encoding: FileSystem.EncodingType.UTF8 });
  return fileName;
}

/** Restore newest valid local backup; falls back to SAF only if local store is empty. */
export async function readLatestFavoritesBackup(): Promise<{ fileName: string; raw: string }> {
  if (Platform.OS === "web") {
    throw new Error("Portable favorites restore is currently available on Android/TV builds.");
  }

  try {
    const dir = await ensureLocalBackupDir();
    const names = await FileSystem.readDirectoryAsync(dir);
    const local = names
      .filter((name) => name.includes(FILE_PREFIX) && name.toLowerCase().endsWith(FILE_SUFFIX))
      .sort((a, b) => b.localeCompare(a));
    for (const name of local) {
      const hit = await readValidBackupCandidate(`${dir}${name}`, name);
      if (hit) return hit;
    }
  } catch {}

  if (Platform.OS === "android" && FileSystem.StorageAccessFramework?.requestDirectoryPermissionsAsync) {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) {
      throw new Error("No local favorites backup found, and folder selection was cancelled.");
    }
    const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(permission.directoryUri);
    const candidates = entries
      .map((uri) => {
        let decoded = uri;
        try {
          decoded = decodeURIComponent(uri);
        } catch {}
        const tail = decoded.split("/").pop() || decoded;
        return { uri, name: tail };
      })
      .filter(({ name }) => name.includes(FILE_PREFIX) && name.toLowerCase().endsWith(FILE_SUFFIX))
      .sort((a, b) => b.name.localeCompare(a.name));

    for (const candidate of candidates) {
      const hit = await readValidBackupCandidate(candidate.uri, candidate.name);
      if (hit) return hit;
    }
  }

  throw new Error("No CharmIPTV favorites backup was found. Create one with Back Up Favorites first.");
}
