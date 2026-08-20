import { NativeModules, Platform } from "react-native";
import type { SourceRefreshIntervalHours } from "@/src/core/sourceRefreshPreferences";

const CustomEpg: any = Platform.OS === "android" ? NativeModules.CharmCustomEpg : null;

export async function setNativeCustomEpgRetentionDays(pastDays: 1 | 3 | 7 | 14): Promise<void> {
  try {
    await CustomEpg?.setRetentionDays?.(pastDays);
  } catch {
    // Settings persistence remains authoritative; native sync retries on next load/check.
  }
}

/**
 * Keep the native EPG source rows aligned with the setting the UI displays.
 * The legacy `user` source shares the global EPG interval, while additional
 * sources keep their own per-source refreshHours value.
 */
export async function syncNativeCustomEpgPolicy(
  epgHours: SourceRefreshIntervalHours,
  pastDays: 1 | 3 | 7 | 14,
): Promise<void> {
  await setNativeCustomEpgRetentionDays(pastDays);
  try {
    const [{ getEpgSourcePreferences }, { getMultiEpgSources }, { configureNativeUserGuideSources }] = await Promise.all([
      import("@/src/core/epgSourcePreferences"),
      import("@/src/core/multiEpgSources"),
      import("@/src/nativeEpg"),
    ]);
    const [primary, extras] = await Promise.all([
      getEpgSourcePreferences(),
      getMultiEpgSources(),
    ]);
    await configureNativeUserGuideSources(primary.primaryEnabled, [
      {
        id: "user",
        url: primary.userUrl,
        enabled: primary.userEnabled,
        refreshHours: epgHours,
      },
      ...extras.map((source) => ({
        id: source.id,
        url: source.url,
        enabled: source.enabled,
        refreshHours: source.refreshHours,
      })),
    ]);
  } catch {
    // Native module may be unavailable on web/Expo Go; next Android startup retries.
  }
}
