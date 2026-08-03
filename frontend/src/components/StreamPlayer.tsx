import React, { useEffect, useRef, useState } from "react";
import { Platform, UIManager, StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";

export type StreamStatus = "loading" | "playing" | "error";

const USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";
const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES_PER_WINDOW = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

type FailureState = { failures: number[]; blockedUntil: number };
const failureStateByUri = new Map<string, FailureState>();

function getFailureState(uri: string): FailureState {
  const now = Date.now();
  const state = failureStateByUri.get(uri) || { failures: [], blockedUntil: 0 };
  state.failures = state.failures.filter((ts) => now - ts <= FAILURE_WINDOW_MS);
  if (state.blockedUntil <= now && state.failures.length < MAX_FAILURES_PER_WINDOW) {
    state.blockedUntil = 0;
  }
  failureStateByUri.set(uri, state);
  return state;
}

function isCircuitOpen(uri: string): boolean {
  return getFailureState(uri).blockedUntil > Date.now();
}

function recordFailure(uri: string): void {
  if (!uri) return;
  const now = Date.now();
  const state = getFailureState(uri);
  state.failures.push(now);
  if (state.failures.length >= MAX_FAILURES_PER_WINDOW) {
    state.blockedUntil = now + CIRCUIT_COOLDOWN_MS;
  }
  failureStateByUri.set(uri, state);
}

function recordStablePlayback(uri: string): void {
  if (!uri) return;
  const state = getFailureState(uri);
  // Keep only the newest two failures after a successful start. This allows
  // occasional stream hiccups without letting a rapid decoder crash-loop grow.
  state.failures = state.failures.slice(-2);
  state.blockedUntil = 0;
  failureStateByUri.set(uri, state);
}

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
  const [blocked, setBlocked] = useState(() => isCircuitOpen(uri));

  useEffect(() => {
    setBlocked(isCircuitOpen(uri));
    if (isCircuitOpen(uri)) onStatus("error");
  }, [onStatus, uri]);

  if (blocked) return null;

  const fail = () => {
    recordFailure(uri);
    onStatus("error");
    if (isCircuitOpen(uri)) setBlocked(true);
  };

  return (
    <VLCPlayer
      style={style}
      source={{
        uri,
        initType: 2,
        initOptions: [
          "--network-caching=1250",
          "--live-caching=1250",
          "--clock-jitter=0",
          "--clock-synchro=0",
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
      onPlaying={() => {
        recordStablePlayback(uri);
        onStatus("playing");
      }}
      onError={fail}
      onStopped={fail}
    />
  );
}

function ExpoStream({ uri, onStatus, style }: Props) {
  const mountedRef = useRef(true);
  const [blocked, setBlocked] = useState(() => isCircuitOpen(uri));
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        player.pause();
      } catch {}
    };
  }, [player]);

  useEffect(() => {
    const circuitOpen = isCircuitOpen(uri);
    setBlocked(circuitOpen);
    if (!uri || circuitOpen) {
      if (circuitOpen) onStatus("error");
      return;
    }

    let cancelled = false;
    onStatus("loading");
    (async () => {
      try {
        await player.replaceAsync({
          uri,
          headers: { "User-Agent": USER_AGENT },
          contentType: uri.toLowerCase().includes(".m3u8") ? "hls" : "progressive",
        });
        if (!cancelled && mountedRef.current) player.play();
      } catch {
        if (!cancelled && mountedRef.current) {
          recordFailure(uri);
          onStatus("error");
          if (isCircuitOpen(uri)) setBlocked(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        player.pause();
      } catch {}
    };
  }, [onStatus, player, uri]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (!mountedRef.current) return;
      if (status === "readyToPlay") {
        recordStablePlayback(uri);
        onStatus("playing");
      } else if (status === "loading") {
        onStatus("loading");
      } else if (error || status === "error") {
        recordFailure(uri);
        onStatus("error");
        if (isCircuitOpen(uri)) setBlocked(true);
      }
    });
    return () => sub.remove();
  }, [onStatus, player, uri]);

  if (blocked) return null;

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
