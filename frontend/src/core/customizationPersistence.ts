import { storage } from "@/src/utils/storage";
import {
  importLegacyNativeCustomization,
  nativeCustomizationAvailable,
  readNativeCustomization,
  type NativeCustomizationSnapshot,
} from "@/src/nativeCustomization";

export const LEGACY_HIDDEN_KEY = "gs_hidden_channel_ids";
export const LEGACY_ORDER_KEY = "gs_channel_custom_order";
export const LEGACY_NUMBERS_KEY = "gs_channel_custom_numbers";
export const LEGACY_GROUPS_KEY = "gs_phase9_custom_guide_groups_v1";

const EMPTY: NativeCustomizationSnapshot = {
  hiddenIds: [],
  customOrder: [],
  customNumbers: {},
  groups: [],
};

let migrationPromise: Promise<NativeCustomizationSnapshot> | null = null;

export async function loadNativeCustomizationWithMigration(): Promise<NativeCustomizationSnapshot> {
  if (!nativeCustomizationAvailable) return EMPTY;
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const [hiddenIds, customOrder, customNumbers, groups] = await Promise.all([
      storage.getItem<string[]>(LEGACY_HIDDEN_KEY, []),
      storage.getItem<string[]>(LEGACY_ORDER_KEY, []),
      storage.getItem<Record<string, number>>(LEGACY_NUMBERS_KEY, {}),
      storage.getItem<{ id: string; name: string; channelIds: string[] }[]>(LEGACY_GROUPS_KEY, []),
    ]);
    await importLegacyNativeCustomization(
      Array.isArray(hiddenIds) ? hiddenIds : [],
      Array.isArray(customOrder) ? customOrder : [],
      customNumbers && typeof customNumbers === "object" ? customNumbers : {},
      Array.isArray(groups) ? groups : [],
    );
    const snapshot = await readNativeCustomization();
    // Native snapshot is now authoritative. Remove the old large JSON values so
    // future single-row Room writes cannot drift from a stale second source.
    await Promise.all([
      storage.removeItem(LEGACY_HIDDEN_KEY),
      storage.removeItem(LEGACY_ORDER_KEY),
      storage.removeItem(LEGACY_NUMBERS_KEY),
      storage.removeItem(LEGACY_GROUPS_KEY),
    ]).catch(() => undefined);
    return snapshot;
  })();
  try {
    return await migrationPromise;
  } catch (error) {
    // Permit a later retry after native/bridge startup races.
    migrationPromise = null;
    throw error;
  }
}

export async function refreshNativeCustomizationSnapshot(): Promise<NativeCustomizationSnapshot> {
  return nativeCustomizationAvailable ? readNativeCustomization() : EMPTY;
}
