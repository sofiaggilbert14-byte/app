import React from "react";
import { BackHandler, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

// On living-room devices, BACK should feel predictable. In the secondary tabs,
// BACK returns to the guide instead of bouncing out of the app or landing in a
// confusing navigation history state.
export function useTvBackToGuide(enabled = true) {
  const router = useRouter();

  useFocusEffect(
    React.useCallback(() => {
      if (!enabled || Platform.OS === "web") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        router.replace("/");
        return true;
      });
      return () => sub.remove();
    }, [enabled, router]),
  );
}
