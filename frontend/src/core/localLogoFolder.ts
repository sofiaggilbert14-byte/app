import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { storage } from "@/src/utils/storage";

const KEY = "gs_local_logo_folder_uri";
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|bmp|svg)$/i;
const MAX_FILES = 5000;
let folderUri = "";
let loaded = false;
let loadPromise: Promise<string> | null = null;
let index = new Map<string, string>();
let entryKeys: string[] = [];
const resolvedCache = new Map<string, string | null>();
const listeners = new Set<() => void>();

function key(value: string): string {
  return value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "");
}

function distance(a: string, b: string, limit = 4): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = new Uint16Array(b.length + 1);
  let current = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return limit + 1;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
}

async function rebuild(uri: string): Promise<void> {
  index = new Map();
  entryKeys = [];
  resolvedCache.clear();
  if (!uri || Platform.OS !== "android") return;
  const uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(uri).catch(() => [] as string[]);
  for (const fileUri of uris.slice(0, MAX_FILES)) {
    let decoded = fileUri.split("/").pop() || "";
    try { decoded = decodeURIComponent(decoded); } catch {}
    if (!IMAGE_EXT.test(decoded)) continue;
    const normalized = key(decoded);
    if (!normalized || index.has(normalized)) continue;
    index.set(normalized, fileUri);
    entryKeys.push(normalized);
  }
}

export async function loadLocalLogoFolder(): Promise<string> {
  if (loaded) return folderUri;
  if (!loadPromise) {
    loadPromise = (async () => {
      const storedUri = (await storage.getItem(KEY, "")) || "";
      // A folder may have been chosen or cleared while storage was resolving.
      if (!loaded) {
        folderUri = storedUri;
        loaded = true;
        await rebuild(folderUri);
      }
      return folderUri;
    })().finally(() => { loadPromise = null; });
  }
  return loadPromise;
}

export async function chooseLocalLogoFolder(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return false;
  folderUri = permission.directoryUri;
  loaded = true;
  await storage.setItem(KEY, folderUri);
  await rebuild(folderUri);
  listeners.forEach((listener) => listener());
  return true;
}

export async function clearLocalLogoFolder(): Promise<void> {
  folderUri = "";
  loaded = true;
  index.clear();
  entryKeys = [];
  resolvedCache.clear();
  await storage.removeItem(KEY);
  listeners.forEach((listener) => listener());
}

export function resolveLocalLogo(channelName: string): string | undefined {
  const normalized = key(channelName);
  if (!normalized) return undefined;
  if (resolvedCache.has(normalized)) return resolvedCache.get(normalized) || undefined;
  const exact = index.get(normalized);
  if (exact) {
    resolvedCache.set(normalized, exact);
    return exact;
  }
  let best: string | undefined;
  let bestDistance = Math.min(4, Math.max(1, Math.floor(normalized.length * 0.18)));
  for (const candidate of entryKeys) {
    const uri = index.get(candidate);
    if (!uri) continue;
    if (candidate.startsWith(normalized) || normalized.startsWith(candidate)) {
      resolvedCache.set(normalized, uri);
      return uri;
    }
    const score = distance(normalized, candidate, bestDistance);
    if (score <= bestDistance) {
      bestDistance = score - 1;
      best = uri;
    }
  }
  resolvedCache.set(normalized, best || null);
  while (resolvedCache.size > 512) {
    const oldest = resolvedCache.keys().next().value;
    if (!oldest) break;
    resolvedCache.delete(oldest);
  }
  return best;
}

export function useLocalLogo(channelName: string): string | undefined {
  const [, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void loadLocalLogoFolder().then(() => {
      if (!cancelled) setVersion((value) => value + 1);
    });
    const listener = () => {
      if (!cancelled) setVersion((value) => value + 1);
    };
    listeners.add(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);
  return resolveLocalLogo(channelName);
}
