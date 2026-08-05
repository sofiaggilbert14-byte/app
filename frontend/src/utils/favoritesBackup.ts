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

function normalized(value?: string): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function timestampForFile(date = new Date()): string {
  const p = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
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

  // Preserve IDs that are temporarily absent from the current playlist. They
  // may become valid again in a later build/source refresh.
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

export function resolveFavoritesBackup(raw: string, channels: Channel[]): string[] {
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
  const byTvgId = new Map<string, Channel>();
  const byName = new Map<string, Channel>();
  for (const channel of channels) {
    const tvgId = normalized(channel.tvg_id);
    const name = normalized(channel.name);
    if (tvgId && !byTvgId.has(tvgId)) byTvgId.set(tvgId, channel);
    if (name && !byName.has(name)) byName.set(name, channel);
  }

  const restored = new Set<string>();
  for (const item of payload.favorites) {
    if (!item || typeof item !== "object") continue;
    const identity = item as Partial<FavoriteIdentity>;
    const id = typeof identity.id === "string" ? identity.id : "";
    const exact = id ? byId.get(id) : undefined;
    if (exact) {
      restored.add(exact.id);
      continue;
    }

    const tvgId = normalized(typeof identity.tvgId === "string" ? identity.tvgId : "");
    const byGuideId = tvgId ? byTvgId.get(tvgId) : undefined;
    if (byGuideId) {
      restored.add(byGuideId.id);
      continue;
    }

    const name = normalized(typeof identity.name === "string" ? identity.name : "");
    const byChannelName = name ? byName.get(name) : undefined;
    if (byChannelName) {
      restored.add(byChannelName.id);
      continue;
    }

    // Keep an unmatched original ID instead of silently losing the favorite.
    // If the channel returns after a later playlist refresh, it can become
    // visible as a favorite again without another restore operation.
    if (id) restored.add(id);
  }

  return Array.from(restored);
}

export async function writeFavoritesBackup(raw: string): Promise<string> {
  if (Platform.OS !== "android") {
    throw new Error("Portable favorites backup is currently available on Android/TV builds.");
  }

  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) throw new Error("Backup folder selection was cancelled.");

  const fileName = `${FILE_PREFIX}${timestampForFile()}${FILE_SUFFIX}`;
  const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    fileName,
    "application/json",
  );
  await FileSystem.writeAsStringAsync(fileUri, raw, { encoding: FileSystem.EncodingType.UTF8 });
  return fileName;
}

export async function readLatestFavoritesBackup(): Promise<{ fileName: string; raw: string }> {
  if (Platform.OS !== "android") {
    throw new Error("Portable favorites restore is currently available on Android/TV builds.");
  }

  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) throw new Error("Restore folder selection was cancelled.");

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

  if (!candidates.length) {
    throw new Error("No CharmIPTV favorites backup was found in that folder.");
  }

  // Timestamped filenames sort newest-first. If a provider exposes a decorated
  // URI name, the payload validation below still prevents importing bad data.
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      const raw = await FileSystem.readAsStringAsync(candidate.uri, { encoding: FileSystem.EncodingType.UTF8 });
      const parsed = JSON.parse(raw) as Partial<FavoritesBackupV1>;
      if (parsed?.format === FORMAT && parsed.version === VERSION && Array.isArray(parsed.favorites)) {
        return { fileName: candidate.name, raw };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Could not read favorites backup.");
    }
  }

  throw lastError || new Error("No valid CharmIPTV favorites backup was found in that folder.");
}
