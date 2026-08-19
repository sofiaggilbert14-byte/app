import { useEffect } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { refreshEpgOnly, refreshSourcesIfDue } from "@/src/source";
import { consumeNativeScheduledEpgRefresh } from "@/src/nativeEpg";
import { isGuideSurfing } from "@/src/utils/guideSurfGate";
import { getSourceRefreshPreferences } from "@/src/core/sourceRefreshPreferences";

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
    let initialCheckPending = true;
    const automaticRefreshEligibleAt = Date.now() + 30_000;

    const check = async () => {
      if (!active || running || Date.now() < automaticRefreshEligibleAt) return;
      if (initialCheckPending) {
        initialCheckPending = false;
        const prefs = await getSourceRefreshPreferences();
        if (!prefs.updateEpgOnAppStart) return;
      }
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

    // TiviMate-style cold start: let UI/playback own CPU, sockets and SQLite
    // first. The source layer has the same 30s boot window; keeping this scheduler
    // aligned prevents a second immediate path from bypassing that protection.
    const initialTimer = setTimeout(() => void check(), 30_000);
    const timer = setInterval(() => void check(), 10 * 60 * 1000);
    const sub = AppState.addEventListener("change", (state) => {
      active = state !== "background" && state !== "inactive";
      if (active) void check();
    });

    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
      sub.remove();
    };
  }, [pathname]);

  return null;
}

