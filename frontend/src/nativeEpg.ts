import { NativeModules, Platform } from "react-native";
import type { Channel, Program } from "@/src/api";

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
const RAM_HISTORY_MS = 6 * 60 * 60 * 1000;
const RAM_FUTURE_MS = 12 * 60 * 60 * 1000;

type NativePlaylistResult = {
  channels: Channel[];
  rejected: number;
  truncated: boolean;
};

type NativeRefreshResult = {
  count: number;
  windowStartMs: number;
  windowEndMs: number;
  guideEpoch?: number;
  notModified?: boolean;
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
  fetchPlaylist?(url: string): Promise<NativePlaylistResult>;
  refresh(url: string, allowNotModified: boolean): Promise<NativeRefreshResult>;
  getWindow(startMs: number, endMs: number, channelIds: string[]): Promise<NativeWindow>;
  queryGuideWindow?(startMs: number, endMs: number, playlistChannelIds: string[]): Promise<NativeWindow>;
  isPlaylistCurrent?(contentFingerprint: string): Promise<boolean>;
  upsertPlaylistChannels?(
    channels: NativePlaylistChannelRow[],
    playlistEpoch: number,
    contentFingerprint: string,
  ): Promise<boolean>;
  upsertPlaylistEpgMatches?(matches: NativePlaylistEpgMatchRow[], guideEpoch: number): Promise<boolean>;
  getCurrent(): Promise<NativeCurrent>;
  clear(): Promise<boolean>;
};

type CharmEpgRamModule = {
  warm(startMs: number, endMs: number): Promise<boolean>;
  replaceMatches(matches: NativePlaylistEpgMatchRow[]): Promise<boolean>;
  queryGuideWindow(startMs: number, endMs: number, playlistChannelIds: string[]): Promise<NativeWindow | null>;
  getWindow(startMs: number, endMs: number, channelIds: string[]): Promise<NativeWindow | null>;
  clearMemory(): Promise<boolean>;
  stats(): Promise<Record<string, number | boolean>>;
};

const nativeModule = NativeModules.CharmEpg as CharmEpgModule | undefined;
const ramModule = NativeModules.CharmEpgRam as CharmEpgRamModule | undefined;

export const nativeEpgAvailable = Platform.OS === "android" && !!nativeModule;
export const nativeEpgRamAvailable = Platform.OS === "android" && !!ramModule;

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

export async function fetchNativePlaylist(url: string): Promise<NativePlaylistResult> {
  if (!nativeModule || typeof nativeModule.fetchPlaylist !== "function") {
    throw new Error("Native playlist engine is unavailable");
  }
  return nativeModule.fetchPlaylist(url);
}

export async function refreshNativeEpg(url: string, allowNotModified: boolean): Promise<NativeRefreshResult> {
  if (!nativeModule) throw new Error("Native EPG engine is unavailable");
  const result = await nativeModule.refresh(url, allowNotModified);
  // SQLite retains the broad 72h guide. RAM intentionally keeps only a near-now
  // runway so a larger disk horizon never turns into a larger heap snapshot.
  if (
    ramModule &&
    Number.isFinite(result.windowStartMs) &&
    Number.isFinite(result.windowEndMs) &&
    result.windowEndMs > result.windowStartMs &&
    result.count > 0
  ) {
    const now = Date.now();
    const warmStart = Math.max(result.windowStartMs, now - RAM_HISTORY_MS);
    const warmEnd = Math.min(result.windowEndMs, now + RAM_FUTURE_MS);
    if (warmEnd > warmStart) {
      void ramModule.warm(warmStart, warmEnd).catch(() => undefined);
    }
  }
  return result;
}

export async function warmNativeEpgRam(startMs: number, endMs: number): Promise<boolean> {
  if (!ramModule || endMs <= startMs) return false;
  return ramModule.warm(startMs, endMs);
}

export async function clearNativeEpgRam(): Promise<void> {
  if (ramModule) await ramModule.clearMemory();
}

export async function loadNativeEpgWindow(
  channelIds: string[],
  startMs: number,
  endMs: number,
): Promise<Record<string, Program[]>> {
  if (!nativeModule) return {};
  const uniqueIds = Array.from(new Set(channelIds.filter(Boolean)));
  if (!uniqueIds.length) return {};

  if (ramModule) {
    const ramWindow = await ramModule.getWindow(startMs, endMs, uniqueIds);
    if (ramWindow) return windowToPrograms(ramWindow, uniqueIds);
  }
  const window = await nativeModule.getWindow(startMs, endMs, uniqueIds);
  return windowToPrograms(window, uniqueIds);
}

/** Joined guide window keyed by playlist channel id. RAM is preferred; SQLite is fallback. */
export async function queryNativeGuideWindow(
  playlistChannelIds: string[],
  startMs: number,
  endMs: number,
): Promise<Record<string, Program[]>> {
  if (!nativeModule) return {};
  const uniqueIds = Array.from(new Set(playlistChannelIds.filter(Boolean)));
  if (!uniqueIds.length) return {};

  if (ramModule) {
    const ramWindow = await ramModule.queryGuideWindow(startMs, endMs, uniqueIds);
    if (ramWindow) return windowToPrograms(ramWindow, uniqueIds);
  }
  if (typeof nativeModule.queryGuideWindow === "function") {
    const window = await nativeModule.queryGuideWindow(startMs, endMs, uniqueIds);
    return windowToPrograms(window, uniqueIds);
  }
  return loadNativeEpgWindow(uniqueIds, startMs, endMs);
}

export async function upsertNativePlaylistChannels(
  channels: NativePlaylistChannelRow[],
  playlistEpoch: number,
  contentFingerprint: string,
): Promise<boolean> {
  if (!nativeModule || typeof nativeModule.upsertPlaylistChannels !== "function") return false;
  if (!channels.length) return false;
  return nativeModule.upsertPlaylistChannels(channels, playlistEpoch, contentFingerprint);
}

export async function nativePlaylistIsCurrent(contentFingerprint: string): Promise<boolean> {
  if (!nativeModule || typeof nativeModule.isPlaylistCurrent !== "function") return false;
  if (!contentFingerprint) return false;
  return nativeModule.isPlaylistCurrent(contentFingerprint);
}

export async function upsertNativePlaylistEpgMatches(
  matches: NativePlaylistEpgMatchRow[],
  guideEpoch: number,
): Promise<void> {
  if (nativeModule && typeof nativeModule.upsertPlaylistEpgMatches === "function") {
    await nativeModule.upsertPlaylistEpgMatches(matches, guideEpoch);
  }
  if (ramModule) await ramModule.replaceMatches(matches);
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
  if (ramModule) await ramModule.clearMemory();
  if (nativeModule) await nativeModule.clear();
}
