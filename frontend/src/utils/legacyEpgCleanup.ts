import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { shouldDeleteLegacyEpgName } from "@/src/core/epgMatching";

const CLEANUP_FLAG = "charm_legacy_epg_cleanup_v1";

/**
 * One-time Android cleanup of superseded EPG / guide cache files.
 * Never deletes the live native DB (`charm_epg_v3.db`).
 */
export async function cleanupLegacyEpgArtifactsOnce(): Promise<{ deleted: string[] }> {
  if (Platform.OS !== "android") return { deleted: [] };
  const root = FileSystem.documentDirectory || "";
  if (!root) return { deleted: [] };

  const flagPath = `${root}${CLEANUP_FLAG}`;
  try {
    const flag = await FileSystem.getInfoAsync(flagPath);
    if (flag.exists) return { deleted: [] };
  } catch {
    /* continue and attempt cleanup */
  }

  const deleted: string[] = [];
  try {
    const names = await FileSystem.readDirectoryAsync(root);
    for (const name of names) {
      if (!shouldDeleteLegacyEpgName(name)) continue;
      // Hard guard — never touch live native EPG DB family.
      if (name.startsWith("charm_epg_v3")) continue;
      try {
        await FileSystem.deleteAsync(`${root}${name}`, { idempotent: true });
        deleted.push(name);
      } catch {
        /* best-effort */
      }
    }
    await FileSystem.writeAsStringAsync(flagPath, new Date().toISOString());
  } catch {
    /* ignore — cleanup must never block guide boot */
  }
  return { deleted };
}
