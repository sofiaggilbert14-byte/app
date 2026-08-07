import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import {
  FAVORITES_BACKUP_FORMAT,
  FAVORITES_BACKUP_VERSION,
  resolveFavoritesBackup,
  serializeFavoritesBackup,
  type FavoritesBackupV1,
  type FavoritesRestoreResult,
  type FavoritesRestoreUnavailable,
} from "@/src/core/favoritesBackupCore";

export { resolveFavoritesBackup, serializeFavoritesBackup };
export type { FavoritesRestoreResult, FavoritesRestoreUnavailable };

const FILE_PREFIX = "CharmIPTV-Favorites-";
const FILE_SUFFIX = ".json";

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
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function readValidBackupCandidate(uri: string, name: string): Promise<{ fileName: string; raw: string } | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
    const parsed = JSON.parse(raw) as Partial<FavoritesBackupV1>;
    if (
      parsed?.format === FAVORITES_BACKUP_FORMAT &&
      parsed.version === FAVORITES_BACKUP_VERSION &&
      Array.isArray(parsed.favorites)
    ) return { fileName: name, raw };
  } catch {}
  return null;
}

/** TV-friendly default: write into app documents (no SAF folder picker required). */
export async function writeFavoritesBackup(raw: string): Promise<string> {
  if (Platform.OS === "web") throw new Error("Portable favorites backup is currently available on Android/TV builds.");
  const dir = await ensureLocalBackupDir();
  const fileName = `${FILE_PREFIX}${timestampForFile()}${FILE_SUFFIX}`;
  await FileSystem.writeAsStringAsync(`${dir}${fileName}`, raw, { encoding: FileSystem.EncodingType.UTF8 });
  return fileName;
}

/** Restore newest valid local backup; falls back to SAF only if local store is empty. */
export async function readLatestFavoritesBackup(): Promise<{ fileName: string; raw: string }> {
  if (Platform.OS === "web") throw new Error("Portable favorites restore is currently available on Android/TV builds.");
  try {
    const dir = await ensureLocalBackupDir();
    const names = (await FileSystem.readDirectoryAsync(dir))
      .filter((name) => name.includes(FILE_PREFIX) && name.toLowerCase().endsWith(FILE_SUFFIX))
      .sort((a, b) => b.localeCompare(a));
    for (const name of names) {
      const hit = await readValidBackupCandidate(`${dir}${name}`, name);
      if (hit) return hit;
    }
  } catch {}

  if (Platform.OS === "android" && FileSystem.StorageAccessFramework?.requestDirectoryPermissionsAsync) {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) throw new Error("No local favorites backup found, and folder selection was cancelled.");
    const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(permission.directoryUri);
    const candidates = entries
      .map((uri) => {
        let decoded = uri;
        try { decoded = decodeURIComponent(uri); } catch {}
        return { uri, name: decoded.split("/").pop() || decoded };
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
