import React from "react";
import { BackHandler, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

/** Hardware BACK handler that only runs while the screen is focused. */
export function useTvBackHandler(onBack: () => boolean, enabled = true) {
  useFocusEffect(
    React.useCallback(() => {
      if (!enabled || Platform.OS === "web") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
      return () => sub.remove();
    }, [enabled, onBack]),
  );
}

// On living-room devices, BACK should feel predictable. In secondary tabs,
// BACK returns to the guide instead of bouncing out of the app.
export function useTvBackToGuide(enabled = true) {
  const router = useRouter();

  useTvBackHandler(
    React.useCallback(() => {
      router.replace("/guide");
      return true;
    }, [router]),
    enabled,
  );
}
