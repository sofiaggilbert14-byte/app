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
  getWindow(startMs: number, endMs: number): Promise<NativeWindow>;
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

export async function loadNativeEpgWindow(
  channelIds: string[],
  startMs: number,
  endMs: number,
): Promise<Record<string, Program[]>> {
  if (!nativeModule) return {};
  const window = await nativeModule.getWindow(startMs, endMs);
  const result: Record<string, Program[]> = {};

  for (const channelId of channelIds) {
    if (!channelId || result[channelId]) continue;
    const programmes = window[channelId];
    if (!programmes?.length) continue;
    result[channelId] = programmes.map(toProgram);
  }
  return result;
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