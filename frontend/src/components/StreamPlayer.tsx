import React, { useEffect } from "react";
import { Platform, UIManager, StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";

export type StreamStatus = "loading" | "playing" | "error";

const USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";

// libVLC registers this native view. It only exists in a real dev/prod build
// (not Expo Go / web), so we detect it and gracefully fall back to expo-video.
export const vlcAvailable =
  Platform.OS !== "web" && !!UIManager.getViewManagerConfig?.("RCTVLCPlayer");

// Only require the native module when its view is actually registered — this
// avoids crashing the JS bundle in Expo Go and on web.
const VLCPlayer: any = vlcAvailable
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must be lazy outside installed builds
  ? require("react-native-vlc-media-player").VLCPlayer
  : null;

type Props = {
  uri: string;
  onStatus: (s: StreamStatus) => void;
  style?: StyleProp<ViewStyle>;
};

function VlcStream({ uri, onStatus, style }: Props) {
  return (
    <VLCPlayer
      style={style}
      source={{
        uri,
        initType: 2,
        initOptions: [
          "--network-caching=1000",
          "--live-caching=1000",
          "--http-reconnect",
          `--http-user-agent=${USER_AGENT}`,
        ],
      }}
      autoplay
      autoAspectRatio
      resizeMode="contain"
      acceptInvalidCertificates
      onOpen={() => onStatus("loading")}
      onBuffering={() => onStatus("loading")}
      onPlaying={() => onStatus("playing")}
      onError={() => onStatus("error")}
      onStopped={() => onStatus("error")}
    />
  );
}

function ExpoStream({ uri, onStatus, style }: Props) {
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

export function StreamPlayer(props: Props) {
  return vlcAvailable ? <VlcStream {...props} /> : <ExpoStream {...props} />;
}
