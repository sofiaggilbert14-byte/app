import { useEffect } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { refreshEpgOnly, refreshSourcesIfDue } from "@/src/source";
import { consumeNativeScheduledEpgRefresh } from "@/src/nativeEpg";
import { isGuideSurfing } from "@/src/utils/guideSurfGate";

/**
 * Lightweight scheduler for direct-source builds. It checks freshness when the
 * app becomes active and at a low cadence while the app remains in the foreground.
 * Native EPG HTTP validators still suppress unchanged payload work with 304s.
 */
export function SourceRefreshScheduler() {
  const pathname = usePathname();

  useEffect(() => {
    let active = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let running = false;

    const check = async () => {
      if (!active || running) return;
      // A native EPG swap competes with guide SQLite reads and player decoder
      // memory on low-RAM televisions. Automatic work waits for a safe screen;
      // Settings / EPG Sources remain the explicit manual refresh paths.
      if (pathname?.startsWith("/guide") || pathname?.startsWith("/player") || isGuideSurfing()) return;
      running = true;
      try {
        const nativeDue = await consumeNativeScheduledEpgRefresh();
        if (nativeDue) await refreshEpgOnly();
        else await refreshSourcesIfDue();
      } catch {
        // Last-good playlist/guide remains authoritative; normal source UI surfaces errors.
      } finally {
        running = false;
      }
    };

    void check();
    const timer = setInterval(() => void check(), 10 * 60 * 1000);
    const sub = AppState.addEventListener("change", (state) => {
      active = state !== "background" && state !== "inactive";
      if (active) void check();
    });

    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [pathname]);

  return null;
}
