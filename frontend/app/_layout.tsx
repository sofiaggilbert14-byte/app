import { Stack, usePathname, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { LogBox, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { GuideProvider, useStore } from "@/src/store";
import { ProgramModal } from "@/src/components/ProgramModal";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { PointerOverlay } from "@/src/components/PointerOverlay";
import { PurpleTvDrawerProvider } from "@/src/components/PurpleTvShell";
import { SourceRefreshScheduler } from "@/src/components/SourceRefreshScheduler";
import { TvQuickActionsOverlay } from "@/src/components/TvQuickActionsOverlay";
import { TvCalibrationFrame, TvCalibrationProvider } from "@/src/tvCalibration";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { StartupVersion4 } from "@/src/components/StartupVersion4";

// Keep real errors visible for TV QA; only silence known noisy module warnings.
LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "Require cycle:",
]);
SplashScreen.preventAutoHideAsync();

function NotificationRouter() {
  const router = useRouter();
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const channelId = resp.notification.request.content.data?.channelId as string | undefined;
      if (channelId) {
        openFullscreenPlayer(router, channelId);
      }
    });
    return () => sub.remove();
  }, [router]);
  return null;
}

function ReminderCleanup() {
  const pathname = usePathname();
  const { reminders, removeReminder } = useStore();

  useEffect(() => {
    if (reminders.length === 0 || pathname?.startsWith("/player")) return;
    // Expire due reminders only outside fullscreen playback. OS notification
    // delivery remains independent; this cleanup is maintenance, not playback work.
    // Notification tap handling (NotificationRouter) is the user-driven switch path.
    const check = () => {
      const now = Date.now();
      for (const reminder of reminders) {
        const start = Date.parse(reminder.start);
        const stop = reminder.stop ? Date.parse(reminder.stop) : start + 2 * 60 * 60 * 1000;
        if (!Number.isFinite(start)) continue;
        if (now > stop) {
          removeReminder(reminder.key).catch(() => {});
        }
      }
    };
    check();
    // Slow interval — reminders are sparse; avoid wakeups on weak boxes.
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [pathname, reminders, removeReminder]);

  return null;
}

function StartScreenRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { startScreen, lastChannelId, loading } = useStore();
  const doneRef = React.useRef(false);

  useEffect(() => {
    if (doneRef.current || loading) return;
    if (pathname && pathname !== "/" && pathname !== "/index") return;
    doneRef.current = true;
    if (startScreen === "guide") {
      router.replace("/guide" as any);
      return;
    }
    if (startScreen === "last_channel" && lastChannelId) {
      openFullscreenPlayer(router, lastChannelId);
    }
  }, [lastChannelId, loading, pathname, router, startScreen]);

  return null;
}

export default function RootLayout() {
  const [iconsLoaded, iconErr] = useIconFonts();
  const [fontsLoaded, fontErr] = useAppFonts();
  const { width, height } = useWindowDimensions();

  const ready = (iconsLoaded || iconErr) && (fontsLoaded || fontErr);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, width, height }}>
      <SafeAreaProvider>
        <TvCalibrationProvider>
          <TvCalibrationFrame>
            <GuideProvider>
              <PurpleTvDrawerProvider>
                <StatusBar style="light" />
                <NotificationRouter />
                <SourceRefreshScheduler />
                <ReminderCleanup />
                <StartScreenRedirect />
                <ErrorBoundary>
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#070711" } }}>
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="player" options={{ animation: "fade" }} />
                  </Stack>
                </ErrorBoundary>
                <ErrorBoundary>
                  <ProgramModal />
                </ErrorBoundary>
                <ErrorBoundary>
                  <TvQuickActionsOverlay />
                </ErrorBoundary>
                <PointerOverlay />
                <StartupVersion4 />
              </PurpleTvDrawerProvider>
            </GuideProvider>
          </TvCalibrationFrame>
        </TvCalibrationProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
