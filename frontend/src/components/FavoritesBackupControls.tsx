import React, { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import type { Channel } from "@/src/api";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const RED = "#E3262E";
const FAVORITES_STORAGE_KEY = "gs_favorites";
const BACKUP_FORMAT = "charmiptv-favorites";
const BACKUP_VERSION = 1;

type BackupFavorite = {
  id: string;
  tvgId?: string;
  name?: string;
};

type FavoritesBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  appVersion: string;
  favorites: BackupFavorite[];
};

type Props = {
  channels: Channel[];
  favorites: string[];
  appVersion: string;
  toggleFavorite: (id: string) => void;
};

function normalizeKey(value: string | undefined): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function backupFileName(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `CharmIPTV-Favorites-${stamp}.json`;
}

function parseBackup(raw: string): FavoritesBackup | null {
  try {
    const parsed = JSON.parse(raw) as Partial<FavoritesBackup>;
    if (parsed.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION || !Array.isArray(parsed.favorites)) {
      return null;
    }
    const favorites = parsed.favorites
      .filter((item): item is BackupFavorite => !!item && typeof item === "object" && typeof item.id === "string")
      .map((item) => ({
        id: item.id.trim(),
        tvgId: typeof item.tvgId === "string" ? item.tvgId.trim() : "",
        name: typeof item.name === "string" ? item.name.trim() : "",
      }))
      .filter((item) => !!item.id || !!item.tvgId || !!item.name);
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
      appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : "unknown",
      favorites,
    };
  } catch {
    return null;
  }
}

export function FavoritesBackupControls({ channels, favorites, appVersion, toggleFavorite }: Props) {
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const setResult = useCallback((text: string, isError = false) => {
    setMessage(text);
    setError(isError);
  }, []);

  const backup = useCallback(async () => {
    if (busy) return;
    if (Platform.OS !== "android") {
      setResult("Favorites backup is available in Android TV / Fire TV builds.", true);
      return;
    }
    setBusy("backup");
    setMessage(null);
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permission.granted) {
        setResult("Backup cancelled. No folder was selected.");
        return;
      }

      const channelById = new Map(channels.map((channel) => [channel.id, channel]));
      const entries: BackupFavorite[] = favorites.map((id) => {
        const channel = channelById.get(id);
        return { id, tvgId: channel?.tvg_id || "", name: channel?.name || "" };
      });
      const payload: FavoritesBackup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        appVersion,
        favorites: entries,
      };
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        backupFileName(),
        "application/json",
      );
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      setResult(`Backup saved with ${entries.length} favorite${entries.length === 1 ? "" : "s"}.`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Could not save the backup file.";
      setResult(`Backup failed: ${detail}`, true);
    } finally {
      setBusy(null);
    }
  }, [appVersion, busy, channels, favorites, setResult]);

  const restore = useCallback(async () => {
    if (busy) return;
    if (Platform.OS !== "android") {
      setResult("Favorites restore is available in Android TV / Fire TV builds.", true);
      return;
    }
    setBusy("restore");
    setMessage(null);
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permission.granted) {
        setResult("Restore cancelled. No backup folder was selected.");
        return;
      }

      const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(permission.directoryUri);
      const likelyJson = entries.filter((uri) => {
        const decoded = decodeURIComponent(uri).toLowerCase();
        return decoded.includes("charmiptv-favorites-") && decoded.includes(".json");
      });

      const validBackups: FavoritesBackup[] = [];
      for (const uri of likelyJson.slice(-100)) {
        try {
          const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
          const parsed = parseBackup(raw);
          if (parsed) validBackups.push(parsed);
        } catch {
          // Ignore unrelated or unreadable files in the selected folder.
        }
      }

      if (!validBackups.length) {
        setResult("No compatible CharmIPTV favorites backup was found in that folder.", true);
        return;
      }

      validBackups.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
      const selected = validBackups[0];
      const byId = new Map(channels.map((channel) => [channel.id, channel]));
      const byTvgId = new Map<string, Channel>();
      const nameCounts = new Map<string, number>();
      const byUniqueName = new Map<string, Channel>();

      for (const channel of channels) {
        const tvgKey = normalizeKey(channel.tvg_id);
        if (tvgKey && !byTvgId.has(tvgKey)) byTvgId.set(tvgKey, channel);
        const nameKey = normalizeKey(channel.name);
        if (nameKey) nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1);
      }
      for (const channel of channels) {
        const nameKey = normalizeKey(channel.name);
        if (nameKey && nameCounts.get(nameKey) === 1) byUniqueName.set(nameKey, channel);
      }

      const matched = new Set<string>();
      for (const item of selected.favorites) {
        const direct = item.id ? byId.get(item.id) : undefined;
        const tvg = item.tvgId ? byTvgId.get(normalizeKey(item.tvgId)) : undefined;
        const name = item.name ? byUniqueName.get(normalizeKey(item.name)) : undefined;
        const currentChannel = direct || tvg || name;
        if (currentChannel?.url) matched.add(currentChannel.id);
      }

      const existing = new Set(favorites);
      const toAdd = [...matched].filter((id) => !existing.has(id));
      const merged = [...new Set([...favorites, ...matched])];
      for (const id of toAdd) toggleFavorite(id);
      await storage.setItem(FAVORITES_STORAGE_KEY, merged);

      const missing = Math.max(0, selected.favorites.length - matched.size);
      const already = matched.size - toAdd.length;
      setResult(
        `Restore complete: ${toAdd.length} added${already ? `, ${already} already present` : ""}${missing ? `, ${missing} unavailable in this lineup` : ""}.`,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Could not read the favorites backup.";
      setResult(`Restore failed: ${detail}`, true);
    } finally {
      setBusy(null);
    }
  }, [busy, channels, favorites, setResult, toggleFavorite]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Favorites backup & restore</Text>
      <Text style={styles.sub}>
        Backups contain channel identity only, not private stream URLs. Restore matches those identities to this build's current lineup so favorites use the new build's live stream URLs, logos, and EPG data.
      </Text>
      <View style={styles.actions}>
        <Pressable
          focusable
          disabled={!!busy}
          onPress={backup}
          style={({ focused }: any) => [styles.button, focused && styles.focused, !!busy && styles.disabled]}
          testID="favorites-backup-btn"
        >
          {busy === "backup" ? <ActivityIndicator color="#fff" /> : <Ionicons name="download-outline" size={19} color="#fff" />}
          <Text style={styles.buttonText}>Back Up Favorites</Text>
        </Pressable>
        <Pressable
          focusable
          disabled={!!busy}
          onPress={restore}
          style={({ focused }: any) => [styles.buttonSecondary, focused && styles.focused, !!busy && styles.disabled]}
          testID="favorites-restore-btn"
        >
          {busy === "restore" ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-upload-outline" size={19} color="#fff" />}
          <Text style={styles.buttonText}>Restore Favorites</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>File type: CharmIPTV Favorites JSON (.json). Restore merges with favorites already in this build.</Text>
      {message ? <Text style={[styles.message, error && styles.error]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  title: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  sub: { color: "rgba(255,255,255,0.70)", fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  button: {
    minHeight: 44,
    flexGrow: 1,
    flexBasis: 220,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(227,38,46,0.65)",
    backgroundColor: "#A80F17",
  },
  buttonSecondary: {
    minHeight: 44,
    flexGrow: 1,
    flexBasis: 220,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  buttonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  hint: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 9.5, lineHeight: 13 },
  message: { color: "#9EE6A8", fontFamily: fonts.medium, fontSize: 10.5, lineHeight: 14 },
  error: { color: colors.error },
  focused: { borderColor: "#fff", borderWidth: 2, shadowColor: RED, shadowOpacity: 0.35, shadowRadius: 7 },
  disabled: { opacity: 0.55 },
});
