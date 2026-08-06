import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, StreamStatus, vlcAvailable } from "@/src/components/StreamPlayer";
import { useStore } from "@/src/store";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { addTvKeyListener } from "@/src/utils/tvRemote";
import { getTvSafeInsets } from "@/src/utils/tvLayout";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";

const CHANNEL_PREVIEW_DELAY_MS = 650;
const STREAM_RETRY_MS = 3000;
const SWITCH_NOTICE_MS = 1800;
const TV_OVERLAY_HIDE_MS = 8000;

function AutoScrollProgramDescription({ text, activeKey }: { text: string; activeKey: string }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    translateY.stopAnimation();
    translateY.setValue(0);
    if (!text || !viewportHeight || contentHeight <= viewportHeight + 2) return;

    const overflow = contentHeight - viewportHeight;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1100),
        Animated.timing(translateY, {
          toValue: -overflow,
          duration: Math.max(4200, overflow * 95),
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(900),
        Animated.timing(translateY, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      translateY.stopAnimation();
    };
  }, [activeKey, contentHeight, text, translateY, viewportHeight]);

  if (!text) return null;
  return (
    <View style={styles.descriptionViewport} onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}>
      <Animated.Text
        onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
        style={[styles.description, { transform: [{ translateY }] }]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

export default function PlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const safe = getTvSafeInsets(width, height);
  const {
    channels,
    channelById,
    addRecent,
    playerControlsTimeoutMs,
    autoRetryStreams,
    channelLogos,
    channelNumbers,
  } = useStore();

  const [channelId, setChannelId] = useState(params.channelId);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [controls, setControls] = useState(true);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef(true);
  const generationRef = useRef(0);

  const isTV = Platform.OS !== "web" && Platform.isTV;
  const overlayHideMs = isTV ? Math.min(playerControlsTimeoutMs, TV_OVERLAY_HIDE_MS) : playerControlsTimeoutMs;
  const channel = useMemo(() => channelById(channelId), [channelById, channelId]);
  const sortedChannels = useMemo(
    () => [...channels].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" })),
    [channels],
  );
  const streamChannels = useMemo(() => sortedChannels.filter((item) => !!item.url), [sortedChannels]);
  const streamIndex = useMemo(() => streamChannels.findIndex((item) => item.id === channelId), [channelId, streamChannels]);
  const numberById = useMemo(() => {
    const result: Record<string, number> = {};
    sortedChannels.forEach((item, index) => { result[item.id] = index + 1; });
    return result;
  }, [sortedChannels]);

  const playerNow = new Date();
  const { current, next } = nowNext(channel?.programs, playerNow);
  const progress = current ? progressPct(current, playerNow) : 0;
  const hasStream = !!channel?.url;
  const programDescription = current?.desc || (next ? `Next: ${next.title}` : "Live television");
  const programDescriptionKey = `${channelId}:${current?.start || ""}:${current?.title || ""}`;

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), SWITCH_NOTICE_MS);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      controlsRef.current = false;
      setControls(false);
      setChannelsOpen(false);
    }, overlayHideMs);
  }, [overlayHideMs]);

  const revealControls = useCallback(() => {
    controlsRef.current = true;
    setControls(true);
    scheduleHide();
  }, [scheduleHide]);

  const changeChannel = useCallback((id: string, haptic = false) => {
    if (!id || id === channelId) return;
    const target = channelById(id);
    if (!target) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (haptic) void Haptics.selectionAsync().catch(() => undefined);
    generationRef.current += 1;
    setRetryAttempt(0);
    setStatus("loading");
    setChannelId(id);
    addRecent(target);
    showNotice(`Switching to ${target.name}`);
    revealControls();
  }, [addRecent, channelById, channelId, revealControls, showNotice]);

  const previewChannel = useCallback((id: string) => {
    if (id === channelId) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => changeChannel(id), CHANNEL_PREVIEW_DELAY_MS);
  }, [changeChannel, channelId]);

  const stepChannel = useCallback((direction: -1 | 1) => {
    if (streamChannels.length < 2) return;
    const base = streamIndex >= 0 ? streamIndex : 0;
    const nextIndex = (base + direction + streamChannels.length) % streamChannels.length;
    const target = streamChannels[nextIndex];
    if (target) changeChannel(target.id, true);
  }, [changeChannel, streamChannels, streamIndex]);

  const retryNow = useCallback(() => {
    if (!hasStream) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const generation = generationRef.current;
    setStatus("loading");
    setRetryAttempt((value) => value + 1);
    showNotice(`Reconnecting ${channel?.name || "stream"}`);
    requestAnimationFrame(() => {
      if (generation === generationRef.current) setRetryToken((value) => value + 1);
    });
  }, [channel?.name, hasStream, showNotice]);

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  useEffect(() => {
    if (channel) addRecent(channel);
  }, [addRecent, channel]);

  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [channelId, retryToken, revealControls]);

  useEffect(() => {
    if (status === "playing") {
      setRetryAttempt(0);
      if (controlsRef.current) scheduleHide();
    }
  }, [scheduleHide, status]);

  useEffect(() => {
    if (!autoRetryStreams || !hasStream || status !== "error") return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(retryNow, STREAM_RETRY_MS);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [autoRetryStreams, hasStream, retryNow, status]);

  useEffect(() => {
    if (!isTV) return;
    return addTvKeyListener(() => revealControls());
  }, [isTV, revealControls]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const stopAndExit = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    router.back();
  }, [router]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!controlsRef.current) {
        revealControls();
        return true;
      }
      if (channelsOpen) {
        setChannelsOpen(false);
        scheduleHide();
        return true;
      }
      stopAndExit();
      return true;
    });
    return () => sub.remove();
  }, [channelsOpen, revealControls, scheduleHide, stopAndExit]);

  return (
    <View style={styles.root}>
      <RNStatusBar hidden />
      {hasStream ? (
        <ErrorBoundary fallback={() => null}>
          <StreamPlayer
            key={`${channelId}-${retryToken}`}
            uri={channel?.url || ""}
            onStatus={setStatus}
            style={StyleSheet.absoluteFill}
          />
        </ErrorBoundary>
      ) : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        focusable={!isTV}
        onPress={() => {
          if (controls) {
            controlsRef.current = false;
            setControls(false);
            setChannelsOpen(false);
          } else {
            revealControls();
          }
        }}
        testID="player-surface"
      />

      {(!hasStream || status === "error") ? (
        <View style={styles.errorOverlay}>
          <Ionicons name="warning-outline" size={32} color={tvColors.purpleSoft} />
          <Text style={styles.errorTitle}>{hasStream ? "Reconnecting stream…" : "No stream available"}</Text>
          {hasStream ? <Text style={styles.errorText}>Attempt {Math.max(1, retryAttempt + 1)} · engine fallback remains active</Text> : null}
          {hasStream && !vlcAvailable ? <Text style={styles.errorText}>Playback requires the installed Android build.</Text> : null}
          {hasStream ? (
            <Pressable onPress={retryNow} style={({ focused }: any) => [styles.retry, focused && styles.focused]}>
              <Ionicons name="refresh" size={14} color="#fff" />
              <Text style={styles.retryText}>Retry Now</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {notice ? (
        <View style={styles.notice} pointerEvents="none">
          <ActivityIndicator size="small" color="#fff" />
          <Text numberOfLines={1} style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {controls ? (
        <>
          <LinearGradient
            colors={["rgba(5,4,13,0.92)", "rgba(5,4,13,0.42)", "transparent"]}
            style={[
              styles.topOverlay,
              {
                paddingTop: insets.top + safe.top + 8,
                paddingLeft: safe.left + 14,
                paddingRight: safe.right + 14,
              },
            ]}
          >
            <View style={styles.channelIdentity}>
              {channel ? <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={34} /> : null}
              <View>
                <Text style={styles.channelTitle}>
                  {channel ? `${channelNumbers ? `${numberById[channel.id] || ""}  ` : ""}${channel.name}` : "Live TV"}
                </Text>
                <Text numberOfLines={1} style={styles.nowText}>{current?.title || "Live channel"}</Text>
              </View>
            </View>
            <View style={styles.topSpacer} />
            <Text style={styles.clock}>{fmtTime(new Date().toISOString())}</Text>
          </LinearGradient>

          <LinearGradient
            colors={["transparent", "rgba(5,4,13,0.90)", "rgba(5,4,13,0.98)"]}
            style={[
              styles.bottomOverlay,
              {
                paddingLeft: safe.left + 14,
                paddingRight: safe.right + 14,
                paddingBottom: insets.bottom + safe.bottom + 10,
              },
            ]}
          >
            <View style={styles.infoRow}>
              <View style={styles.programCopy}>
                <View style={styles.liveLine}>
                  <View style={styles.livePill}><Text style={styles.livePillText}>LIVE</Text></View>
                  <Text style={styles.programTime}>
                    {current ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}` : "Streaming now"}
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.programTitle}>{current?.title || channel?.name || "Live TV"}</Text>
                <AutoScrollProgramDescription text={programDescription} activeKey={programDescriptionKey} />
              </View>
            </View>

            <View style={styles.progressRow}>
              <Text style={styles.edgeTime}>{current ? fmtTime(current.start) : "LIVE"}</Text>
              <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
              <Text style={styles.edgeTime}>{current?.stop ? fmtTime(current.stop) : "LIVE"}</Text>
            </View>

            <View style={styles.controlsRow}>
              <Pressable onPress={() => router.replace("/guide" as any)} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}>
                <Ionicons name="information-circle-outline" size={15} color="#fff" />
                <Text style={styles.controlLabel}>Guide</Text>
              </Pressable>
              <Pressable onPress={() => setChannelsOpen((value) => !value)} style={({ focused }: any) => [styles.textControl, channelsOpen && styles.controlActive, focused && styles.focused]}>
                <Ionicons name="list" size={15} color="#fff" />
                <Text style={styles.controlLabel}>Channels</Text>
              </Pressable>
              <View style={styles.controlsSpacer} />
              <Pressable disabled={streamChannels.length < 2} onPress={() => stepChannel(-1)} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}>
                <Ionicons name="play-skip-back" size={18} color="#fff" />
              </Pressable>
              <Pressable
                accessibilityLabel="Hide player controls"
                onPress={() => {
                  controlsRef.current = false;
                  setControls(false);
                  setChannelsOpen(false);
                }}
                style={({ focused }: any) => [styles.pauseControl, focused && styles.focused]}
              >
                <Ionicons name="eye-off-outline" size={18} color="#fff" />
              </Pressable>
              <Pressable disabled={streamChannels.length < 2} onPress={() => stepChannel(1)} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}>
                <Ionicons name="play-skip-forward" size={18} color="#fff" />
              </Pressable>
              <View style={styles.controlsSpacer} />
              <Pressable onPress={() => router.replace("/settings" as any)} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}>
                <Ionicons name="settings-outline" size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={stopAndExit} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}>
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>

            {channelsOpen ? (
              <FlatList
                data={sortedChannels}
                horizontal
                keyExtractor={(item) => item.id}
                initialNumToRender={8}
                maxToRenderPerBatch={6}
                windowSize={4}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.channelStrip}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => changeChannel(item.id, true)}
                    onFocus={() => previewChannel(item.id)}
                    style={({ focused }: any) => [styles.channelCard, item.id === channelId && styles.channelCardActive, focused && styles.focused]}
                  >
                    <ChannelLogo name={item.name} logo={item.logo} disabled={!channelLogos} size={30} />
                    <Text numberOfLines={1} style={styles.channelCardName}>{item.name}</Text>
                  </Pressable>
                )}
              />
            ) : null}
          </LinearGradient>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.54)" },
  errorTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  errorText: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5 },
  retry: { minHeight: 31, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8.5 },
  notice: { position: "absolute", top: "47%", alignSelf: "center", maxWidth: "70%", minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, borderRadius: 18, backgroundColor: "rgba(10,8,22,0.88)", borderWidth: 1, borderColor: tvColors.lineStrong },
  noticeText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9 },
  topOverlay: { position: "absolute", top: 0, left: 0, right: 0, minHeight: 82, flexDirection: "row", alignItems: "flex-start", paddingBottom: 18 },
  channelIdentity: { flexDirection: "row", alignItems: "center", gap: 9 },
  channelTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 15 },
  nowText: { color: "rgba(255,255,255,0.78)", fontFamily: fonts.regular, fontSize: 8.5, marginTop: 2, maxWidth: 360 },
  topSpacer: { flex: 1 },
  clock: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5, marginTop: 4 },
  bottomOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 70 },
  infoRow: { flexDirection: "row", alignItems: "flex-end" },
  programCopy: { maxWidth: "62%" },
  liveLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  livePill: { backgroundColor: tvColors.purple, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  livePillText: { color: "#fff", fontFamily: fonts.bold, fontSize: 6.5 },
  programTime: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 14, marginTop: 3 },
  descriptionViewport: { height: 26, overflow: "hidden" },
  description: { color: "rgba(255,255,255,0.76)", fontFamily: fonts.regular, fontSize: 8.5, lineHeight: 12, marginTop: 2 },
  progressRow: { height: 20, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  edgeTime: { width: 42, color: "#fff", fontFamily: fonts.medium, fontSize: 7.5 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  fill: { height: 3, backgroundColor: tvColors.purpleBright },
  controlsRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6 },
  textControl: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  controlActive: { backgroundColor: tvColors.purpleDeep },
  controlLabel: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  controlsSpacer: { flex: 1 },
  iconControl: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, borderWidth: 2, borderColor: "transparent" },
  pauseControl: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple },
  channelStrip: { gap: 6, paddingTop: 5 },
  channelCard: { width: 96, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: "rgba(16,16,30,0.94)", padding: 4 },
  channelCardActive: { backgroundColor: tvColors.purpleDeep, borderColor: tvColors.purpleBright },
  channelCardName: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.5, textAlign: "center" },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});