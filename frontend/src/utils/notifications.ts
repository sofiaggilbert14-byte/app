import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Program Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: "#E11D48",
      });
    }
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

export async function scheduleProgramReminder(opts: {
  title: string;
  body: string;
  date: Date;
  data: Record<string, any>;
}): Promise<string | null> {
  try {
    const now = Date.now();
    // fire ~2 min before start; if that is in the past, fire almost immediately
    const fireAt = Math.max(opts.date.getTime() - 2 * 60000, now + 3000);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        data: opts.data,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(fireAt),
        channelId: "reminders",
      },
    });
    return id;
  } catch {
    return null;
  }
}

export async function cancelReminder(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {}
}
