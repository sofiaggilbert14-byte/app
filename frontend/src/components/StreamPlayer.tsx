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
  if (state.blockedUntil <= now && state.failures.length < MAX_FAILURES_PER_WINDOW) state.blockedUntil = 0;
  failureStateByUri.set(uri, state);
  return state;
}

function circuitRemainingMs(uri: string): number {
  return Math.max(0, getFailureState(uri).blockedUntil - Date.now());
}

function isCircuitOpen(uri: string): boolean {
  return circuitRemainingMs(uri) > 0;
}

function recordFailure(uri: string): void {
  if (!uri) return;
  const now = Date.now();
  const state = getFailureState(uri);
  state.failures.push(now);
  if (state.failures.length >= MAX_FAILURES_PER_WINDOW) state.blockedUntil = now + CIRCUIT_COOLDOWN_MS;
  failureStateByUri.set(uri, state);
}

function recordStablePlayback(uri: string): void {
  if (!uri) return;
  const state = getFailureState(uri);
  state.failures = state.failures.slice(-2);
  state.blockedUntil = 0;
  failureStateByUri.set(uri, state);
}

export const vlcAvailable = Platform.OS !== "web" && !!UIManager.getViewManagerConfig?.("RCTVLCPlayer");

const VLCPlayer: any = vlcAvailable
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must be lazy outside installed builds
  ? require("react-native-vlc-media-player").VLCPlayer
  : null;

type Props = {
  uri: string;
  onStatus: (s: StreamStatus) => void;
  style?: StyleProp<ViewStyle>;
};

function useCircuitCooldown(uri: string, onStatus: (s: StreamStatus) => void) {
  const [blocked, setBlocked] = useState(() => isCircuitOpen(uri));

  useEffect(() => {
    const remaining = circuitRemainingMs(uri);
    const open = remaining > 0;
    setBlocked(open);
    if (!open) return;

    // Keep the parent in loading state during cooldown so its 3-second error
    // retry loop does not remount us repeatedly. Emit one error when the
    // cooldown expires, which permits a single fresh reconnect attempt.
    onStatus("loading");
    const timer = setTimeout(() => {
      setBlocked(false);
      onStatus("error");
    }, remaining + 25);
    return () => clearTimeout(timer);
  }, [onStatus, uri]);

  return { blocked, setBlocked };
}

function VlcStream({ uri, onStatus, style }: Props) {
  const activeRef = useRef(true);
  const { blocked, setBlocked } = useCircuitCooldown(uri, onStatus);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  if (blocked) return null;

  const fail = () => {
    if (!activeRef.current) return;
    recordFailure(uri);
    if (isCircuitOpen(uri)) {
      setBlocked(true);
      onStatus("loading");
    } else {
      onStatus("error");
    }
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
      onOpen={() => activeRef.current && onStatus("loading")}
      onBuffering={() => activeRef.current && onStatus("loading")}
      onPlaying={() => {
        if (!activeRef.current) return;
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
  const { blocked, setBlocked } = useCircuitCooldown(uri, onStatus);
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
    if (!uri || blocked) return;

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
          if (isCircuitOpen(uri)) {
            setBlocked(true);
            onStatus("loading");
          } else {
            onStatus("error");
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        player.pause();
      } catch {}
    };
  }, [blocked, onStatus, player, uri, setBlocked]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (!mountedRef.current || blocked) return;
      if (status === "readyToPlay") {
        recordStablePlayback(uri);
        onStatus("playing");
      } else if (status === "loading") {
        onStatus("loading");
      } else if (error || status === "error") {
        recordFailure(uri);
        if (isCircuitOpen(uri)) {
          setBlocked(true);
          onStatus("loading");
        } else {
          onStatus("error");
        }
      }
    });
    return () => sub.remove();
  }, [blocked, onStatus, player, uri, setBlocked]);

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
