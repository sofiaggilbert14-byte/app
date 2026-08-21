import React from "react";
import { useIsFocused } from "@react-navigation/native";

/**
 * Expo Router tab routes stay mounted after navigation. Mount the real screen
 * subtree only while its tab owns focus so hidden lists, Guide subscriptions,
 * settings listeners and search/database state cannot compete with fullscreen
 * playback or remain resident in RAM.
 */
export function FocusedTabMount({ children }: { children: React.ReactNode }) {
  const isFocused = useIsFocused();
  return isFocused ? <>{children}</> : null;
}
