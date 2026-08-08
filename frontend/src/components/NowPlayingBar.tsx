import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { nowNext } from "@/src/utils/time";

/** Compact continue-watching control after leaving the fullscreen player. */
export function NowPlayingBar({ testID = "now-playing-bar" }: { testID?: string }) {
  const router = useRouter();
  const { lastChannelId, channelById, channelLogos } = useStore();
  const channel = lastChannelId ? channelById(lastChannelId) : null;
  const current = useMemo(
    () => (channel ? nowNext(channel.programs, new Date()).current : undefined),
    [channel],
  );

  if (!channel?.url) return null;

  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        openFullscreenPlayer(router, channel.id);
      }}
      style={({ focused }: any) => [styles.bar, focused && styles.focused]}
      testID={testID}
    >
      <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={28} />
      <View style={styles.copy}>
        <Text style={styles.kicker}>CONTINUE WATCHING</Text>
        <Text numberOfLines={1} style={styles.title}>{channel.name}</Text>
        <Text numberOfLines={1} style={styles.program}>{current?.title || "Live TV"}</Text>
      </View>
      <View style={styles.play}>
        <Ionicons name="play" size={14} color="#fff" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: tvColors.line,
    backgroundColor: "rgba(124,58,237,0.12)",
    marginBottom: 10,
  },
  focused: {
    borderColor: "#fff",
    backgroundColor: tvColors.purpleDeep,
  },
  copy: { flex: 1, minWidth: 0 },
  kicker: {
    color: tvColors.purpleSoft,
    fontFamily: fonts.semibold,
    fontSize: 7,
    letterSpacing: 0.8,
  },
  title: {
    color: "#fff",
    fontFamily: fonts.semibold,
    fontSize: 12,
    marginTop: 1,
  },
  program: {
    color: tvColors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 9,
    marginTop: 1,
  },
  play: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tvColors.purpleBright,
  },
});
