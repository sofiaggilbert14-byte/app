import { NativeModules, Platform } from "react-native";

export type NativeEpgBindingMap = Record<string, string>;

type EpgBindingModule = {
  getBindings(): Promise<NativeEpgBindingMap>;
  importLegacyIfEmpty(overrides: NativeEpgBindingMap): Promise<boolean>;
  setBinding(channelId: string, xmltvId: string): Promise<boolean>;
  clearBindings(): Promise<boolean>;
};

const nativeModule = NativeModules.CharmEpgBindings as EpgBindingModule | undefined;
export const nativeEpgBindingsAvailable = Platform.OS === "android" && !!nativeModule;

function sanitize(value: unknown): NativeEpgBindingMap {
  if (!value || typeof value !== "object") return {};
  const out: NativeEpgBindingMap = {};
  let count = 0;
  for (const [rawChannelId, rawXmltvId] of Object.entries(value as Record<string, unknown>)) {
    const channelId = String(rawChannelId || "").trim().slice(0, 180);
    const xmltvId = String(rawXmltvId || "").trim().slice(0, 180);
    if (!channelId || !xmltvId || channelId.includes("://") || xmltvId.includes("://")) continue;
    out[channelId] = xmltvId;
    if (++count >= 10_000) break;
  }
  return out;
}

export async function readNativeEpgBindings(): Promise<NativeEpgBindingMap> {
  if (!nativeModule) return {};
  return sanitize(await nativeModule.getBindings());
}

export async function importLegacyNativeEpgBindings(overrides: NativeEpgBindingMap): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.importLegacyIfEmpty(sanitize(overrides));
}

export async function setNativeEpgBinding(channelId: string, xmltvId: string | null): Promise<void> {
  if (!nativeModule) return;
  const id = String(channelId || "").trim().slice(0, 180);
  const sourceId = String(xmltvId || "").trim().slice(0, 180);
  if (!id || id.includes("://") || sourceId.includes("://")) return;
  await nativeModule.setBinding(id, sourceId);
}

export async function clearNativeEpgBindings(): Promise<void> {
  if (nativeModule) await nativeModule.clearBindings();
}
