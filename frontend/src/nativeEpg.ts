import { NativeModules, Platform } from "react-native";
import type { Program } from "@/src/api";

type NativeProgramme = {
  channelId: string;
  title: string;
  description?: string | null;
  startMs: number;
  endMs: number;
};

type NativeWindow = Record<string, NativeProgramme[]>;
type NativeCurrent = Record<string, NativeProgramme>;

type NativeRefreshResult = {
  count: number;
  windowStartMs: number;
  windowEndMs: number;
  channelLogos?: Record<string, string>;
  channelNames?: Record<string, string>;
  channelIdsWithPrograms?: string[];
};

type CharmEpgModule = {
  refresh(url: string): Promise<NativeRefreshResult>;
  getWindow(
    startMs: number,
    endMs: number,
    channelIds: string[],
    includeDescriptions: boolean,
  ): Promise<NativeWindow>;
  getCurrent(): Promise<NativeCurrent>;
  clear(): Promise<boolean>;
};

const nativeModule = NativeModules.CharmEpg as CharmEpgModule | undefined;

export const nativeEpgAvailable = Platform.OS === "android" && !!nativeModule;

function toProgram(program: NativeProgramme): Program {
  return {
    title: program.title || "No Information",
    desc: program.description || "",
    category: "",
    start: new Date(program.startMs).toISOString(),
    stop: new Date(program.endMs).toISOString(),
  };
}

export async function refreshNativeEpg(url: string): Promise<NativeRefreshResult> {
  if (!nativeModule) throw new Error("Native EPG engine is unavailable");
  return nativeModule.refresh(url);
}

/**
 * Bulk guide paint: filter in native SQLite and skip description blobs so the
 * bridge payload stays lean for large lineups on weak Android TV devices.
 */
export async function loadNativeEpgWindow(
  channelIds: string[],
  startMs: number,
  endMs: number,
  options?: { includeDescriptions?: boolean },
): Promise<Record<string, Program[]>> {
  if (!nativeModule) return {};
  const ids = Array.from(new Set(channelIds.filter(Boolean)));
  if (!ids.length) return {};

  const includeDescriptions = options?.includeDescriptions === true;
  const window = await nativeModule.getWindow(startMs, endMs, ids, includeDescriptions);
  const result: Record<string, Program[]> = {};

  for (const channelId of ids) {
    const programmes = window[channelId];
    if (!programmes?.length) continue;
    result[channelId] = programmes.map(toProgram);
  }
  return result;
}

/** Lazy description fetch for program modal / focused preview enrichment. */
export async function loadNativeChannelPrograms(
  channelId: string,
  startMs: number,
  endMs: number,
): Promise<Program[]> {
  if (!nativeModule || !channelId) return [];
  const window = await nativeModule.getWindow(startMs, endMs, [channelId], true);
  return (window[channelId] || []).map(toProgram);
}

export async function loadNativeCurrentPrograms(): Promise<Record<string, Program>> {
  if (!nativeModule) return {};
  const current = await nativeModule.getCurrent();
  const result: Record<string, Program> = {};
  for (const [channelId, programme] of Object.entries(current)) {
    result[channelId] = toProgram(programme);
  }
  return result;
}

export async function clearNativeEpg(): Promise<void> {
  if (nativeModule) await nativeModule.clear();
}
