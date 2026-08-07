import { Stack, usePathname, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
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
import { TvCalibrationFrame, TvCalibrationProvider } from "@/src/tvCalibration";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";

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
    if (reminders.length === 0) return;
    // Expire due reminders without hijacking an active player session.
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
    const timer = setInterval(check, pathname?.startsWith("/player") ? 60000 : 30000);
    return () => clearInterval(timer);
  }, [pathname, reminders, removeReminder]);

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
              <StatusBar style="light" />
              <NotificationRouter />
              <ReminderCleanup />
              <ErrorBoundary>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#070711" } }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="player" options={{ animation: "fade" }} />
                </Stack>
              </ErrorBoundary>
              <ErrorBoundary>
                <ProgramModal />
              </ErrorBoundary>
              <PointerOverlay />
            </GuideProvider>
          </TvCalibrationFrame>
        </TvCalibrationProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
