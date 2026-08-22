import React, { useEffect } from "react";
import { View, StyleProp, ViewStyle } from "react-native";

export type StreamStatus = "loading" | "playing" | "error";

// The web preview can't play these HTTP IPTV streams (CORS + mixed content).
// Render a lightweight placeholder that reports "error" so the player screen
// can offer a manual retry without creating a browser video element, so the
// browser console stays clean.

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
