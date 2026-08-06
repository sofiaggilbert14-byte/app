import { Stack, useRouter } from "expo-router";
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

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function NotificationRouter() {
  const router = useRouter();
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const channelId = resp.notification.request.content.data?.channelId as string | undefined;
      if (channelId) {
        router.push({ pathname: "/player", params: { channelId } });
      }
    });
    return () => sub.remove();
  }, [router]);
  return null;
}

function ReminderAutoSwitcher() {
  const router = useRouter();
  const { reminders, removeReminder } = useStore();

  useEffect(() => {
    if (reminders.length === 0) return;
    const check = () => {
      const now = Date.now();
      const due = [...reminders]
        .sort((a, b) => a.start.localeCompare(b.start))
        .find((reminder) => {
          const start = Date.parse(reminder.start);
          const stop = reminder.stop ? Date.parse(reminder.stop) : start + 2 * 60 * 60 * 1000;
          return Number.isFinite(start) && now >= start && now <= stop;
        });
      if (!due) return;
      removeReminder(due.key).catch(() => {});
      router.replace({ pathname: "/player", params: { channelId: due.channelId } });
    };
    check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [reminders, removeReminder, router]);

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
              <ReminderAutoSwitcher />
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