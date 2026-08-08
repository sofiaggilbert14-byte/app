/** Favorite folders — channel ID lists only (never fat payloads). */

import { sanitizeFavoriteIds } from "@/src/utils/favoriteIds";

export const MAX_FAVORITE_FOLDERS = 24;
export const MAX_FOLDER_NAME_LEN = 40;

export type FavoriteFolder = {
  id: string;
  name: string;
  /** Channel IDs in this folder (subset of favorites is not required — folder can hold any id). */
  channelIds: string[];
};

export const DEFAULT_FOLDER_PRESETS = ["Sports", "News", "Kids", "Movies"] as const;

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return base || `folder-${Date.now().toString(36)}`;
}

export function sanitizeFavoriteFolders(raw: unknown): FavoriteFolder[] {
  if (!Array.isArray(raw)) return [];
  const out: FavoriteFolder[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as FavoriteFolder).name || "")
      .trim()
      .slice(0, MAX_FOLDER_NAME_LEN);
    if (!name) continue;
    let id = String((item as FavoriteFolder).id || "").trim().slice(0, 48);
    if (!id) id = slugId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      channelIds: sanitizeFavoriteIds((item as FavoriteFolder).channelIds),
    });
    if (out.length >= MAX_FAVORITE_FOLDERS) break;
  }
  return out;
}

export function createFavoriteFolder(name: string, existing: FavoriteFolder[]): FavoriteFolder | null {
  const clean = name.trim().slice(0, MAX_FOLDER_NAME_LEN);
  if (!clean) return null;
  if (existing.length >= MAX_FAVORITE_FOLDERS) return null;
  let id = slugId(clean);
  const used = new Set(existing.map((f) => f.id));
  if (used.has(id)) id = `${id}-${Date.now().toString(36).slice(-4)}`;
  return { id, name: clean, channelIds: [] };
}

export function toggleChannelInFolder(folders: FavoriteFolder[], folderId: string, channelId: string): FavoriteFolder[] {
  return folders.map((folder) => {
    if (folder.id !== folderId) return folder;
    const set = new Set(folder.channelIds);
    if (set.has(channelId)) set.delete(channelId);
    else set.add(channelId);
    return { ...folder, channelIds: Array.from(set) };
  });
}

export function renameFavoriteFolder(folders: FavoriteFolder[], folderId: string, name: string): FavoriteFolder[] {
  const clean = name.trim().slice(0, MAX_FOLDER_NAME_LEN);
  if (!folderId || !clean) return folders;
  return folders.map((folder) => (folder.id === folderId ? { ...folder, name: clean } : folder));
}

/** Next rename candidate for TV (cycle presets, then Folder N). */
export function nextFavoriteFolderName(folders: FavoriteFolder[], folderId: string): string {
  const current = folders.find((f) => f.id === folderId)?.name || "";
  const used = new Set(folders.filter((f) => f.id !== folderId).map((f) => f.name.toLowerCase()));
  const candidates = [
    ...DEFAULT_FOLDER_PRESETS,
    ...Array.from({ length: 12 }, (_, i) => `Folder ${i + 1}`),
  ];
  const start = Math.max(0, candidates.findIndex((name) => name === current)) + 1;
  for (let i = 0; i < candidates.length; i++) {
    const name = candidates[(start + i) % candidates.length];
    if (!used.has(name.toLowerCase())) return name;
  }
  return `Folder ${Date.now().toString(36).slice(-4)}`;
}
