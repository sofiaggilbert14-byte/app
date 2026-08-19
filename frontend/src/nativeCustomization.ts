import { NativeModules, Platform } from "react-native";

export type NativeCustomGroup = {
  id: string;
  name: string;
  position: number;
  channelIds: string[];
};

export type NativeCustomizationSnapshot = {
  hiddenIds: string[];
  customOrder: string[];
  customNumbers: Record<string, number>;
  groups: NativeCustomGroup[];
};

type CharmCustomizationModule = {
  getSnapshot(): Promise<NativeCustomizationSnapshot>;
  importLegacyIfEmpty(
    hiddenIds: string[],
    customOrder: string[],
    customNumbers: Record<string, number>,
    groups: { id: string; name: string; channelIds: string[] }[],
  ): Promise<boolean>;
  setHidden(channelId: string, hidden: boolean): Promise<boolean>;
  setCustomNumber(channelId: string, number: number, hasNumber: boolean): Promise<boolean>;
  setOrder(channelIds: string[]): Promise<boolean>;
  moveChannel(channelId: string, direction: number): Promise<boolean>;
  clearOrder(): Promise<boolean>;
  createGroup(groupId: string, name: string): Promise<boolean>;
  renameGroup(groupId: string, name: string): Promise<boolean>;
  deleteGroup(groupId: string): Promise<boolean>;
  moveGroup(groupId: string, direction: number): Promise<boolean>;
  setGroupMembership(groupId: string, channelId: string, include: boolean): Promise<boolean>;
};

const nativeModule = NativeModules.CharmCustomization as CharmCustomizationModule | undefined;
export const nativeCustomizationAvailable = Platform.OS === "android" && !!nativeModule;

const EMPTY: NativeCustomizationSnapshot = {
  hiddenIds: [],
  customOrder: [],
  customNumbers: {},
  groups: [],
};

function normalizeSnapshot(value: NativeCustomizationSnapshot | null | undefined): NativeCustomizationSnapshot {
  if (!value) return EMPTY;
  return {
    hiddenIds: Array.isArray(value.hiddenIds) ? value.hiddenIds.filter(Boolean) : [],
    customOrder: Array.isArray(value.customOrder) ? value.customOrder.filter(Boolean) : [],
    customNumbers: value.customNumbers && typeof value.customNumbers === "object" ? value.customNumbers : {},
    groups: Array.isArray(value.groups)
      ? value.groups
          .filter((group) => group && group.id && group.name)
          .map((group) => ({
            id: String(group.id),
            name: String(group.name),
            position: Number(group.position) || 0,
            channelIds: Array.isArray(group.channelIds) ? group.channelIds.filter(Boolean) : [],
          }))
      : [],
  };
}

export async function readNativeCustomization(): Promise<NativeCustomizationSnapshot> {
  if (!nativeModule) return EMPTY;
  return normalizeSnapshot(await nativeModule.getSnapshot());
}

export async function importLegacyNativeCustomization(
  hiddenIds: string[],
  customOrder: string[],
  customNumbers: Record<string, number>,
  groups: { id: string; name: string; channelIds: string[] }[],
): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.importLegacyIfEmpty(hiddenIds, customOrder, customNumbers, groups);
}

export async function nativeSetChannelHidden(channelId: string, hidden: boolean): Promise<void> {
  if (nativeModule) await nativeModule.setHidden(channelId, hidden);
}

export async function nativeSetCustomNumber(channelId: string, number: number | null): Promise<void> {
  if (nativeModule) await nativeModule.setCustomNumber(channelId, number || 0, number != null);
}

export async function nativeSetChannelOrder(channelIds: string[]): Promise<void> {
  if (nativeModule) await nativeModule.setOrder(channelIds);
}

export async function nativeMoveChannel(channelId: string, direction: -1 | 1): Promise<void> {
  if (nativeModule) await nativeModule.moveChannel(channelId, direction);
}

export async function nativeClearChannelOrder(): Promise<void> {
  if (nativeModule) await nativeModule.clearOrder();
}

export async function nativeCreateCustomGroup(groupId: string, name: string): Promise<void> {
  if (nativeModule) await nativeModule.createGroup(groupId, name);
}

export async function nativeRenameCustomGroup(groupId: string, name: string): Promise<void> {
  if (nativeModule) await nativeModule.renameGroup(groupId, name);
}

export async function nativeDeleteCustomGroup(groupId: string): Promise<void> {
  if (nativeModule) await nativeModule.deleteGroup(groupId);
}

export async function nativeMoveCustomGroup(groupId: string, direction: -1 | 1): Promise<void> {
  if (nativeModule) await nativeModule.moveGroup(groupId, direction);
}

export async function nativeSetCustomGroupMembership(
  groupId: string,
  channelId: string,
  include: boolean,
): Promise<void> {
  if (nativeModule) await nativeModule.setGroupMembership(groupId, channelId, include);
}
