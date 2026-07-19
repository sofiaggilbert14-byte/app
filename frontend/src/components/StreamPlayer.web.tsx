import React, { useEffect } from "react";
import { View, StyleProp, ViewStyle } from "react-native";

export type StreamStatus = "loading" | "playing" | "error";

// The web preview can't play these HTTP IPTV streams (CORS + mixed content),
// and libVLC is native-only. Render a lightweight placeholder that reports
// "error" so the player screen shows its "needs the installed app build" note —
// no <video> element, so the browser console stays clean.
export const vlcAvailable = false;

type Props = {
  uri: string;
  onStatus: (s: StreamStatus) => void;
  style?: StyleProp<ViewStyle>;
};

export function StreamPlayer({ onStatus, style }: Props) {
  useEffect(() => {
    onStatus("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={[{ backgroundColor: "#000" }, style]} />;
}
