import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, useWindowDimensions, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/src/store";
import { addTvKeyListener, setPointerActive, tap, tvRemoteAvailable } from "@/src/utils/tvRemote";

// A virtual mouse cursor for TV remotes. When pointer mode is on, the D-pad
// moves this cursor and the SELECT button taps whatever is underneath it.
// Only active on Android with the native TvRemote module present.
export function PointerOverlay() {
  const { pointerMode, setPointerMode } = useStore();
  const { width, height } = useWindowDimensions();
  const active = pointerMode && Platform.OS === "android" && tvRemoteAvailable;

  const [pos, setPos] = useState({ x: width / 2, y: height / 2 });
  const posRef = useRef(pos);
  posRef.current = pos;

  // Hold-to-repeat acceleration for smooth movement.
  const speedRef = useRef(24);

  useEffect(() => {
    setPointerActive(active);
    return () => setPointerActive(false);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const clamp = (v: number, max: number) => Math.max(8, Math.min(max - 8, v));
    const unsub = addTvKeyListener((key) => {
      if (key === "SELECT") {
        tap(posRef.current.x, posRef.current.y);
        return;
      }
      if (key === "BACK") {
        setPointerMode(false);
        return;
      }
      const step = speedRef.current;
      setPos((p) => {
        let { x, y } = p;
        if (key === "LEFT") x -= step;
        else if (key === "RIGHT") x += step;
        else if (key === "UP") y -= step;
        else if (key === "DOWN") y += step;
        return { x: clamp(x, width), y: clamp(y, height) };
      });
    });
    return unsub;
  }, [active, setPointerMode, width, height]);

  if (!active) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.cursor, { left: pos.x - 11, top: pos.y - 11 }]}>
        <Ionicons name="navigate" size={22} color="#fff" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cursor: {
    position: "absolute",
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 6,
  },
});
