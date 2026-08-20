import React from "react";
import { BackHandler, Platform } from "react-native";
import { useFocusEffect, usePathname, useRouter } from "expo-router";

const GUIDE_DOUBLE_BACK_WINDOW_MS = 650;

/** Hardware BACK handler that only runs while the screen is focused. */
export function useTvBackHandler(onBack: () => boolean, enabled = true) {
  const pathname = usePathname();
  const lastGuideBackAtRef = React.useRef(0);

  useFocusEffect(
    React.useCallback(() => {
      if (!enabled || Platform.OS === "web") return;
      lastGuideBackAtRef.current = 0;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        // TiViMate-style layer routing for the TV Guide: BACK is consumed by the
        // active Guide layer instead of falling through to the view that still
        // owns focus. Charm intentionally requires a deliberate double press for
        // each layer transition: timeline -> group tabs, then group tabs -> main
        // TV drawer. Resetting after a successful pair means each transition gets
        // its own independent double-back gesture.
        if (pathname?.startsWith("/guide")) {
          const now = Date.now();
          const elapsed = now - lastGuideBackAtRef.current;
          if (lastGuideBackAtRef.current === 0 || elapsed > GUIDE_DOUBLE_BACK_WINDOW_MS) {
            lastGuideBackAtRef.current = now;
            return true;
          }
          lastGuideBackAtRef.current = 0;
        }
        return onBack();
      });
      return () => {
        lastGuideBackAtRef.current = 0;
        sub.remove();
      };
    }, [enabled, onBack, pathname]),
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
