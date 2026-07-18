import React, { useEffect } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";

export type StreamStatus = "loading" | "playing" | "error";

// Web has no native libVLC view — always use expo-video here.
export const vlcAvailable = false;

const USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";

type Props = {
  uri: string;
  onStatus: (s: StreamStatus) => void;
  style?: StyleProp<ViewStyle>;
};

export function StreamPlayer({ uri, onStatus, style }: Props) {
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (!uri) return;
    onStatus("loading");
    (async () => {
      try {
        await player.replaceAsync({
          uri,
          headers: { "User-Agent": USER_AGENT },
          contentType: uri.toLowerCase().includes(".m3u8") ? "hls" : "progressive",
        });
        player.play();
      } catch {
        onStatus("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (status === "readyToPlay") onStatus("playing");
      else if (status === "loading") onStatus("loading");
      else if (error || status === "error") onStatus("error");
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <VideoView
      style={style}
      player={player}
      contentFit="contain"
      nativeControls={false}
      allowsFullscreen
    />
  );
}
