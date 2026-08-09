import { NativeModules, Platform } from "react-native";
import type { Program } from "@/src/api";

type NativeProgramme = {
  channelId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  startMs: number;
  endMs: number;
};

type NativeWindow = Record<string, NativeProgramme[]>;
type NativeCurrent = Record<string, NativeProgramme>;
const EMPTY_NATIVE_PROGRAMS: Program[] = [];

type NativeRefreshResult = {
  count: number;
  windowStartMs: number;
  windowEndMs: number;
  guideEpoch?: number;
  channelLogos?: Record<string, string>;
  channelNames?: Record<string, string>;
  channelIdsWithPrograms?: string[];
};

export type NativePlaylistChannelRow = {
  playlistId: string;
  rawTvgId?: string;
  name?: string;
  logo?: string;
  group?: string;
};

export type NativePlaylistEpgMatchRow = {
  playlistId: string;
  xmltvId?: string;
  logoXmltvId?: string;
  ambiguous?: boolean;
  matchPolicy?: string;
  manual?: boolean;
};

type CharmEpgModule = {
  refresh(url: string): Promise<NativeRefreshResult>;
  getWindow(startMs: number, endMs: number, channelIds: string[]): Promise<NativeWindow>;
  queryGuideWindow?(startMs: number, endMs: number, playlistChannelIds: string[]): Promise<NativeWindow>;
  upsertPlaylistChannels?(channels: NativePlaylistChannelRow[], playlistEpoch: number): Promise<boolean>;
  upsertPlaylistEpgMatches?(matches: NativePlaylistEpgMatchRow[], guideEpoch: number): Promise<boolean>;
  getCurrent(): Promise<NativeCurrent>;
  clear(): Promise<boolean>;
};

const nativeModule = NativeModules.CharmEpg as CharmEpgModule | undefined;

export const nativeEpgAvailable = Platform.OS === "android" && !!nativeModule;

function toProgram(program: NativeProgramme): Program {
  return {
    title: program.title || "No Information",
    desc: program.description || "",
    category: program.category || "",
    start: new Date(program.startMs).toISOString(),
    stop: new Date(program.endMs).toISOString(),
  };
}

function windowToPrograms(window: NativeWindow, channelIds: string[]): Record<string, Program[]> {
  const result: Record<string, Program[]> = {};
  for (const channelId of channelIds) {
    if (result[channelId]) continue;
    const programmes = window[channelId];
    result[channelId] = programmes?.length
      ? programmes.map(toProgram)
      : EMPTY_NATIVE_PROGRAMS;
  }
  return result;
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
  const uniqueIds = Array.from(new Set(channelIds.filter(Boolean)));
  if (!uniqueIds.length) return {};

  const window = await nativeModule.getWindow(startMs, endMs, uniqueIds);
  return windowToPrograms(window, uniqueIds);
}

/** Joined guide window keyed by playlist channel id (SQL MATCH ⋈ PROGRAMMES). */
export async function queryNativeGuideWindow(
  playlistChannelIds: string[],
  startMs: number,
  endMs: number,
): Promise<Record<string, Program[]>> {
  if (!nativeModule) return {};
  const uniqueIds = Array.from(new Set(playlistChannelIds.filter(Boolean)));
  if (!uniqueIds.length) return {};

  if (typeof nativeModule.queryGuideWindow === "function") {
    const window = await nativeModule.queryGuideWindow(startMs, endMs, uniqueIds);
    return windowToPrograms(window, uniqueIds);
  }
  // Older APKs: fall back to XMLTV-keyed getWindow (caller must pass xmltv ids).
  return loadNativeEpgWindow(uniqueIds, startMs, endMs);
}

export async function upsertNativePlaylistChannels(
  channels: NativePlaylistChannelRow[],
  playlistEpoch: number,
): Promise<void> {
  if (!nativeModule || typeof nativeModule.upsertPlaylistChannels !== "function") return;
  if (!channels.length) return;
  await nativeModule.upsertPlaylistChannels(channels, playlistEpoch);
}

export async function upsertNativePlaylistEpgMatches(
  matches: NativePlaylistEpgMatchRow[],
  guideEpoch: number,
): Promise<void> {
  if (!nativeModule || typeof nativeModule.upsertPlaylistEpgMatches !== "function") return;
  await nativeModule.upsertPlaylistEpgMatches(matches, guideEpoch);
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
