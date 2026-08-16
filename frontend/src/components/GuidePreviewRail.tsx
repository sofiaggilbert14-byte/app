import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import type { Channel, Program } from "@/src/api";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, type StreamStatus } from "@/src/components/StreamPlayer";
import { getLastAudioDiagnostics } from "@/src/core/audioDiagnostics";
import {
  noteGuidePreviewFocus,
  registerGuidePreviewNode,
} from "@/src/utils/guidePreviewFocus";
import { fonts, radius, tvColors } from "@/src/theme";
import { fmtTime, progressPct } from "@/src/utils/time";

type Props = {
  width: number;
  channel: Channel | null;
  current?: Program;
  next?: Program;
  now: string;
  channelNumber?: number;
  showChannelNumbers: boolean;
  showLogos: boolean;
  isFavorite: boolean;
  hidePreview: boolean;
  muted: boolean;
  onToggleMute: () => void;
  previewVisible: boolean;
  previewEpoch: number;
  onPreviewStatus: (status: StreamStatus) => void;
  onPreviewErrorRemount: () => void;
  onPlay: () => void;
  onFavorite: () => void;
  onOpenReminders: () => void;
  onHideToggle: () => void;
  /** Opens the app drawer and lands focus on the top drawer row. */
  onOpenDrawer: () => void;
  focusRequestToken: number;
};

function usePreviewFocusNode(key: string, preferred = false) {
  const nodeRef = useRef<unknown>(null);
  const setRef = useCallback((node: unknown) => {
    nodeRef.current = node;
    registerGuidePreviewNode(key, node, preferred);
  }, [key, preferred]);
  const onFocus = useCallback(() => {
    noteGuidePreviewFocus(nodeRef.current);
  }, []);
  return { setRef, onFocus };
}

export function GuidePreviewRail({
  width,
  channel,
  current,
  next,
  now,
  channelNumber,
  showChannelNumbers,
  showLogos,
  isFavorite,
  hidePreview,
  muted,
  onToggleMute,
  previewVisible,
  previewEpoch,
  onPreviewStatus,
  onPreviewErrorRemount,
  onPlay,
  onFavorite,
  onOpenReminders,
  onHideToggle,
  onOpenDrawer,
  focusRequestToken,
}: Props) {
  const playFocus = usePreviewFocusNode("play", true);
  const favoriteFocus = usePreviewFocusNode("favorite");
  const remindersFocus = usePreviewFocusNode("reminders");
  const drawerFocus = usePreviewFocusNode("drawer");
  const muteFocus = usePreviewFocusNode("mute");
  const hideFocus = usePreviewFocusNode("hide");
  const showFocus = usePreviewFocusNode("show-preview");
  const [preferPlayFocus, setPreferPlayFocus] = useState(false);
  useEffect(() => {
    if (focusRequestToken <= 0) return;
    setPreferPlayFocus(true);
    const timer = setTimeout(() => setPreferPlayFocus(false), 500);
    return () => clearTimeout(timer);
  }, [focusRequestToken]);
  const nowDate = useMemo(() => new Date(now), [now]);
  const progress = current ? progressPct(current, nowDate) : 0;
  const endsIn = current?.stop
    ? Math.max(0, dayjs(current.stop).diff(dayjs(nowDate), "minute"))
    : null;
  const audio = getLastAudioDiagnostics();
  const codecChip =
    audio && audio.streamKey && channel?.url
      ? `${audio.mimeType?.replace(/^audio\//, "").toUpperCase() || "AUDIO"} · ${String(audio.engine).toUpperCase()}`
      : null;
  const about = current?.desc || "Focus a channel to preview it and read the current program.";

  return (
    <View style={[styles.panel, { width }]} testID="guide-preview-rail">
      <View style={styles.previewColumn}>
        {!hidePreview ? (
          <View style={styles.preview}>
            {previewVisible && channel?.url ? (
              <ErrorBoundary
                onError={onPreviewErrorRemount}
                fallback={() => (
                  <View style={styles.fallback}>
                    <ChannelLogo name={channel.name} logo={channel.logo} disabled={!showLogos} size={52} />
                    <Text style={styles.fallbackHint}>Preview unavailable</Text>
                  </View>
                )}
              >
                <StreamPlayer
                  key={`guide-preview-${channel.id}-${previewEpoch}`}
                  uri={channel.url}
                  channelKey={channel.id}
                  onStatus={onPreviewStatus}
                  mode="preview"
                  sessionRole="preview"
                  muted={muted}
                  style={StyleSheet.absoluteFill}
                />
              </ErrorBoundary>
            ) : (
              <View style={styles.fallback}>
                {channel ? (
                  <ChannelLogo name={channel.name} logo={channel.logo} disabled={!showLogos} size={52} />
                ) : (
                  <Ionicons name="tv-outline" size={34} color={tvColors.purpleSoft} />
                )}
                <Text style={styles.fallbackHint}>{channel ? "Tuning preview…" : "Select a channel"}</Text>
              </View>
            )}
            <View style={styles.liveTag}>
              <Text style={styles.liveTagText}>{muted ? "PREVIEW MUTED" : "LIVE PREVIEW"}</Text>
            </View>
            {codecChip ? (
              <View style={styles.codecChip} pointerEvents="none">
                <Text style={styles.codecText} numberOfLines={1}>{codecChip}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Pressable
            ref={showFocus.setRef}
            onPress={onHideToggle}
            onFocus={showFocus.onFocus}
            style={({ focused }: any) => [styles.hiddenPreview, focused && styles.focused]}
            testID="guide-preview-show"
          >
            <Ionicons name="eye-outline" size={14} color={tvColors.purpleSoft} />
            <Text style={styles.hiddenPreviewText}>Show preview</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.actionGrid}>
        <View style={styles.actionColumn}>
          <Pressable
            ref={playFocus.setRef}
            hasTVPreferredFocus={preferPlayFocus}
            disabled={!channel}
            onPress={onPlay}
            onFocus={playFocus.onFocus}
            style={({ focused }: any) => [styles.watchButton, focused && styles.focused]}
            testID="guide-preview-play"
          >
            <Ionicons name="play" size={12} color="#fff" />
            <Text style={styles.watchText}>Play</Text>
          </Pressable>
          <Pressable
            ref={favoriteFocus.setRef}
            disabled={!channel}
            onPress={onFavorite}
            onFocus={favoriteFocus.onFocus}
            style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
            testID="guide-preview-favorite"
          >
            <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={12} color={tvColors.purpleSoft} />
            <Text style={styles.secondaryText}>Favorite</Text>
          </Pressable>
          <Pressable
            ref={remindersFocus.setRef}
            onPress={onOpenReminders}
            onFocus={remindersFocus.onFocus}
            style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
            testID="guide-preview-remind"
          >
            <Ionicons name="notifications-outline" size={12} color={tvColors.purpleSoft} />
            <Text style={styles.secondaryText}>Reminders</Text>
          </Pressable>
          <Pressable
            ref={drawerFocus.setRef}
            onPress={onOpenDrawer}
            onFocus={drawerFocus.onFocus}
            style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
            testID="guide-preview-drawer"
          >
            <Ionicons name="menu-outline" size={12} color={tvColors.purpleSoft} />
            <Text style={styles.secondaryText}>Drawer</Text>
          </Pressable>
          <Pressable
            ref={muteFocus.setRef}
            disabled={hidePreview}
            onPress={onToggleMute}
            onFocus={muteFocus.onFocus}
            style={({ focused }: any) => [styles.secondaryButton, hidePreview && styles.disabledButton, focused && styles.focused]}
            testID="guide-preview-mute"
          >
            <Ionicons name={muted ? "volume-mute-outline" : "volume-medium-outline"} size={10} color={tvColors.purpleSoft} />
            <Text style={styles.secondaryText}>{muted ? "Unmute" : "Mute"}</Text>
          </Pressable>
          <Pressable
            ref={hideFocus.setRef}
            onPress={onHideToggle}
            onFocus={hideFocus.onFocus}
            style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
            testID="guide-preview-hide"
          >
            <Ionicons name={hidePreview ? "eye-outline" : "eye-off-outline"} size={12} color={tvColors.purpleSoft} />
            <Text style={styles.secondaryText}>{hidePreview ? "Show" : "Hide"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.channelName}>
          {channel
            ? `${showChannelNumbers && channelNumber ? `${channelNumber}  ` : ""}${channel.name}`
            : "Select a channel"}
        </Text>
        <Text numberOfLines={2} style={styles.programTitle}>
          {current?.title || "No program information"}
        </Text>
        <View style={styles.nowNextRow}>
          <Text numberOfLines={1} style={styles.timeText}>
            {current
              ? `${fmtTime(current.start)}${current.stop ? ` – ${fmtTime(current.stop)}` : ""}`
              : "Guide information will appear here"}
          </Text>
          {endsIn != null ? <Text style={styles.endsIn}>{endsIn}m left</Text> : null}
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        {next?.title ? (
          <Text numberOfLines={1} style={styles.nextTitle}>
            Next · {next.title}
          </Text>
        ) : null}
        <Text style={styles.descLabel}>ABOUT</Text>
        <Text accessibilityRole="text" accessibilityLabel={about} style={styles.description} numberOfLines={5}>
          {about}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    height: 174,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: tvColors.panel,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: tvColors.line,
    overflow: "hidden",
  },
  previewColumn: {
    width: 292,
    flexShrink: 0,
    padding: 7,
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
  },
  preview: {
    width: "100%",
    aspectRatio: 16 / 9,
    maxHeight: 158,
    flexShrink: 0,
    backgroundColor: "#05050B",
    overflow: "hidden",
    borderRadius: 5,
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tvColors.purpleDeep,
    gap: 8,
    paddingHorizontal: 8,
  },
  fallbackHint: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, textAlign: "center" },
  liveTag: {
    position: "absolute",
    left: 6,
    bottom: 6,
    backgroundColor: "rgba(124,58,237,0.92)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  liveTagText: { color: "#fff", fontFamily: fonts.bold, fontSize: 6 },
  codecChip: {
    position: "absolute",
    right: 6,
    top: 6,
    maxWidth: "70%",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  codecText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7 },
  hiddenPreview: {
    flex: 1,
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 5,
  },
  hiddenPreviewText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9 },
  actionGrid: {
    // Previous two-column rail was 230px. The requested 40% reduction leaves
    // a 138px single column and returns 92px to programme description copy.
    width: 138,
    flexShrink: 0,
    padding: 7,
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
  },
  // 174px panel - 14px padding - five 3px gaps = 145px; flex divides that
  // evenly into six ~24.17px controls aligned to the preview's full height.
  actionColumn: { flex: 1, minWidth: 0, gap: 3 },
  copy: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 9 },
  channelName: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 10 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 17, lineHeight: 21, marginTop: 3 },
  nowNextRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  timeText: { flex: 1, minWidth: 0, color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9 },
  endsIn: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 9 },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 7,
  },
  progressFill: { height: 4, backgroundColor: tvColors.purpleBright },
  nextTitle: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9, marginTop: 5 },
  descLabel: {
    color: tvColors.purpleSoft,
    fontFamily: fonts.semibold,
    fontSize: 7.5,
    letterSpacing: 0.7,
    marginTop: 7,
    marginBottom: 3,
  },
  description: { color: "rgba(255,255,255,0.86)", fontFamily: fonts.regular, fontSize: 9.5, lineHeight: 13 },
  watchButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: tvColors.purple,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    paddingHorizontal: 4,
  },
  watchText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 7.5 },
  secondaryButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: tvColors.panelRaised,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    paddingHorizontal: 3,
  },
  secondaryText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.2 },
  disabledButton: { opacity: 0.45 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
