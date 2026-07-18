import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { api, SourceStatus } from "@/src/api";
import { useStore } from "@/src/store";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "admin_jwt";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { refresh: refreshGuide, hardRefresh, refreshing } = useStore();
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // Admin state
  const [authed, setAuthed] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [m3u, setM3u] = useState("");
  const [epg, setEpg] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [savingUrls, setSavingUrls] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {}
  }, []);

  const loadSettingsFields = useCallback(async () => {
    try {
      const s = await api.settings();
      setM3u(s.m3u_url);
      setEpg(s.epg_url);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      await loadStatus();
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) {
        const ok = await api.verifyAdmin(token);
        if (ok) {
          setAuthed(true);
          loadSettingsFields();
        } else {
          await storage.secureRemove(TOKEN_KEY);
        }
      }
    })();
  }, [loadStatus, loadSettingsFields]);

  const doRefresh = async () => {
    setBusy(true);
    Haptics.selectionAsync();
    try {
      const s = await api.refresh();
      setStatus(s);
      await refreshGuide(true);
    } catch {}
    setBusy(false);
  };

  const onPullRefresh = async () => {
    await hardRefresh();
    await loadStatus();
  };

  const doLogin = async () => {
    setLoginErr(null);
    try {
      const token = await api.adminLogin(username, password);
      await storage.secureSet(TOKEN_KEY, token);
      setAuthed(true);
      setShowLogin(false);
      setPassword("");
      setUsername("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadSettingsFields();
    } catch {
      setLoginErr("Incorrect username or password");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const doLogout = async () => {
    await storage.secureRemove(TOKEN_KEY);
    setAuthed(false);
    setSaveMsg(null);
  };

  const doSaveUrls = async () => {
    setSaveMsg(null);
    setSavingUrls(true);
    try {
      const token = (await storage.secureGet<string>(TOKEN_KEY, "")) || "";
      const s = await api.updateSettings(token, m3u.trim(), epg.trim());
      setStatus(s);
      await refreshGuide(true);
      setSaveMsg("Saved — playlist & EPG updated from the new source");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      if (e?.message === "UNAUTHORIZED") {
        await doLogout();
        setSaveMsg("Session expired — please log in again");
      } else {
        setSaveMsg("Failed to save. Check the URLs and try again.");
      }
    }
    setSavingUrls(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.brand}>Configuration</Text>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={colors.brand} colors={[colors.brand]} />
        }
      >
        {/* Playlist refresher */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Playlist & EPG</Text>
          {!status ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
          ) : (
            <>
              <Stat label="Channels loaded" value={String(status.channel_count)} />
              <Stat label="Channels with EPG" value={String(status.channels_with_epg)} />
              <Stat
                label="Last refreshed"
                value={status.last_refresh ? dayjs(status.last_refresh).format("MMM D, h:mm A") : "—"}
              />
              {status.error ? <Text style={styles.errText}>Error: {status.error}</Text> : null}
            </>
          )}
          <Pressable style={styles.primaryBtn} onPress={doRefresh} disabled={busy} testID="settings-refresh-btn">
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.primaryText}>Refresh Playlist Now</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.hint}>Pull down to refresh anywhere on this screen.</Text>
        </View>

        {/* Admin: source URL editor */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Admin — Source URLs</Text>
            <Ionicons
              name={authed ? "lock-open" : "lock-closed"}
              size={18}
              color={authed ? colors.success : colors.onSurfaceTertiary}
            />
          </View>

          {!authed ? (
            <>
              <Text style={styles.sub}>
                Only the admin can change the M3U playlist and EPG source used by the app.
              </Text>
              {!showLogin ? (
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => setShowLogin(true)}
                  testID="admin-unlock-btn"
                >
                  <Ionicons name="key-outline" size={16} color={colors.onSurface} />
                  <Text style={styles.secondaryText}>Admin Login</Text>
                </Pressable>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Username</Text>
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Username"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    testID="admin-username-input"
                  />
                  <Text style={styles.fieldLabel}>Password</Text>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    testID="admin-password-input"
                  />
                  {loginErr && <Text style={styles.errText}>{loginErr}</Text>}
                  <Pressable style={styles.primaryBtn} onPress={doLogin} testID="admin-login-btn">
                    <Ionicons name="log-in-outline" size={16} color="#fff" />
                    <Text style={styles.primaryText}>Log In</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>M3U Playlist URL</Text>
              <TextInput
                value={m3u}
                onChangeText={setM3u}
                placeholder="https://…"
                placeholderTextColor={colors.onSurfaceTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                testID="admin-m3u-input"
              />
              <Text style={styles.fieldLabel}>XMLTV EPG URL</Text>
              <TextInput
                value={epg}
                onChangeText={setEpg}
                placeholder="https://…"
                placeholderTextColor={colors.onSurfaceTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                testID="admin-epg-input"
              />
              {saveMsg && (
                <Text style={saveMsg.startsWith("Saved") ? styles.okText : styles.errText}>{saveMsg}</Text>
              )}
              <Pressable style={styles.primaryBtn} onPress={doSaveUrls} disabled={savingUrls} testID="admin-save-btn">
                {savingUrls ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={16} color="#fff" />
                    <Text style={styles.primaryText}>Save & Reload Sources</Text>
                  </>
                )}
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={doLogout} testID="admin-logout-btn">
                <Ionicons name="log-out-outline" size={16} color={colors.onSurface} />
                <Text style={styles.secondaryText}>Log Out</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>About Reminders</Text>
          <Text style={styles.sub}>
            Set reminders from the guide to get a local notification before a program starts, with a tap-to-switch
            action. Scheduled notifications only fire on an installed Android/iOS build — not in the Expo Go preview.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  brand: { color: colors.brandSecondary, fontFamily: fonts.semibold, fontSize: 12 },
  title: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 28 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 16 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 11, textAlign: "center" },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 14 },
  statValue: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14 },
  errText: { color: colors.error, fontFamily: fonts.medium, fontSize: 12 },
  okText: { color: colors.success, fontFamily: fonts.medium, fontSize: 12 },
  fieldLabel: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 11, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    height: 46,
    color: colors.onSurface,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  primaryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  secondaryText: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 14 },
});
