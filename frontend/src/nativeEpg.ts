import { DeviceEventEmitter, NativeModules, Platform } from "react-native";
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
const EMPTY_NATIVE_PROGRAMS: Program[] = [];

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
  url?: string;
  streamType?: string;
  position?: number;
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
  getStoredPlaylist?(): Promise<{ channels: Channel[]; playlistEpoch?: number; playlistRefreshedAt?: number; guideEpoch?: number; guideRefreshedAt?: number; epgProgramCount?: number; primaryGuideRefreshedAt?: number; userGuideRefreshedAt?: number; primaryEpgProgramCount?: number; userEpgProgramCount?: number }>;
  configureSource?(
    playlistId: string,
    url: string,
    refreshHours: number,
    serverOffsetMinutes: number,
    playlistOffsetMinutes: number,
    channelOffsets: Record<string, number>,
  ): Promise<boolean>;
  consumeScheduledRefreshDue?(): Promise<boolean>;
  refresh(url: string, allowNotModified: boolean, activeXmltvIds: string[], activeChannelNames: string[]): Promise<NativeRefreshResult>;
  getWindow(startMs: number, endMs: number, channelIds: string[]): Promise<NativeWindow>;
  queryGuideWindow?(startMs: number, endMs: number, playlistChannelIds: string[]): Promise<NativeWindow>;
  isPlaylistCurrent?(contentFingerprint: string): Promise<boolean>;
  touchPlaylistRefresh?(playlistEpoch: number): Promise<boolean>;
  upsertPlaylistChannels?(
    channels: NativePlaylistChannelRow[],
    playlistEpoch: number,
    contentFingerprint: string,
  ): Promise<boolean>;
  upsertPlaylistEpgMatches?(matches: NativePlaylistEpgMatchRow[], guideEpoch: number): Promise<boolean>;
  searchProgrammes?(query: string, limit: number): Promise<NativeProgramme[]>;
  configureGuideOwnership?(primaryEnabled: boolean, userEnabled: boolean, userUrl: string, userOverrides: Record<string, string>): Promise<boolean>;
  setGuideChannelBinding?(channelId: string, xmltvId: string): Promise<number>;
  listUserGuideChannels?(query: string, offset: number, limit: number): Promise<{ total: number; rows: { id: string; name: string }[] }>;
  refreshUserGuide?(url: string): Promise<{ count: number; channelNames?: Record<string, string>; channelIdsWithPrograms?: string[] }>;
  clear(): Promise<boolean>;
};

type CharmCustomEpgModule = {
  setGuideChannelBinding?(channelId: string, xmltvId: string): Promise<number>;
  listUserGuideChannels?(query: string, offset: number, limit: number): Promise<{ total: number; rows: { id: string; name: string }[] }>;
  refreshUserGuide?(url: string): Promise<{
    count: number;
    directoryCount?: number;
    bindingCount?: number;
    guideEpoch?: number;
    guideRefreshedAt?: number;
    programmeSwapSucceeded?: boolean;
  }>;
};

type CharmEpgRamModule = {
  replaceMatches(matches: NativePlaylistEpgMatchRow[]): Promise<boolean>;
  queryGuideWindow(startMs: number, endMs: number, playlistChannelIds: string[]): Promise<NativeWindow | null>;
  getWindow(startMs: number, endMs: number, channelIds: string[]): Promise<NativeWindow | null>;
  clearMemory(): Promise<boolean>;
  stats(): Promise<Record<string, number | boolean>>;
};

const nativeModule = NativeModules.CharmEpg as CharmEpgModule | undefined;
const customEpgModule = NativeModules.CharmCustomEpg as CharmCustomEpgModule | undefined;
const ramModule = NativeModules.CharmEpgRam as CharmEpgRamModule | undefined;

export const nativeEpgAvailable = Platform.OS === "android" && !!nativeModule;
export const nativeEpgRamAvailable = Platform.OS === "android" && !!ramModule;
let ownershipRequiresSqlite = false;
let primaryGuideEnabled = true;
let userGuideEnabled = false;
let userGuideUrl = "";

function toProgram(program: NativeProgramme): Program {
  const startMs = Number(program.startMs);
  const endMs = Number(program.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs <= 0 || endMs <= startMs) {
    throw new Error("Native EPG returned an invalid programme time range");
  }
  return {
    title: program.title || "No Information",
    desc: program.description || "",
    category: program.category || "",
    start: new Date(startMs).toISOString(),
    stop: new Date(endMs).toISOString(),
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

export async function readNativeStoredPlaylist(): Promise<{
  channels: Channel[];
  playlistEpoch: number;
  playlistRefreshedAt: number;
  guideEpoch: number;
  guideRefreshedAt: number;
  epgProgramCount: number;
} | null> {
  if (!nativeModule?.getStoredPlaylist) return null;
  const value = await nativeModule.getStoredPlaylist();
  const channels = Array.isArray(value?.channels) ? value.channels : [];
  if (!channels.length) return null;
  return {
    channels,
    playlistEpoch: Number(value.playlistEpoch || 0),
    playlistRefreshedAt: Number(value.playlistRefreshedAt || 0),
    guideEpoch: Number(value.guideEpoch || 0),
    guideRefreshedAt: Number(value.guideRefreshedAt || 0),
    epgProgramCount: Number(value.epgProgramCount || 0),
  };
}

export async function refreshNativeEpg(
  url: string,
  allowNotModified: boolean,
  activeXmltvIds: string[],
  activeChannelNames: string[],
  onProgress?: (phase: string, ratio: number) => void,
): Promise<NativeRefreshResult> {
  if (!nativeModule) throw new Error("Native EPG engine is unavailable");
  const subscription = onProgress
    ? DeviceEventEmitter.addListener("CharmEpgImportProgress", (event: { phase?: string; ratio?: number }) => {
        if (typeof event?.ratio === "number") onProgress(event.phase || "downloading", event.ratio);
      })
    : null;
  let result: NativeRefreshResult;
  try {
    result = await nativeModule.refresh(url, allowNotModified, activeXmltvIds, activeChannelNames);
  } finally {
    subscription?.remove();
  }
  return result;
}

export async function configureNativeEpgSource(
  url: string,
  refreshHours: number,
  serverOffsetMinutes = 0,
  playlistOffsetMinutes = 0,
  channelOffsets: Record<string, number> = {},
): Promise<void> {
  if (!nativeModule?.configureSource) return;
  await nativeModule.configureSource(
    "default",
    url,
    refreshHours,
    serverOffsetMinutes,
    playlistOffsetMinutes,
    channelOffsets,
  );
}

export async function consumeNativeScheduledEpgRefresh(): Promise<boolean> {
  return nativeModule?.consumeScheduledRefreshDue?.() ?? false;
}

export async function searchNativeEpg(
  query: string,
  limit = 24,
): Promise<{ channelId: string; program: Program }[]> {
  const value = query.trim();
  if (!nativeModule?.searchProgrammes || value.length < 2) return [];
  const rows = await nativeModule.searchProgrammes(value, Math.max(1, Math.min(80, limit)));
  return rows.flatMap((row) => {
    if (!row?.channelId) return [];
    try {
      return [{ channelId: row.channelId, program: toProgram(row) }];
    } catch {
      // One malformed provider row must not discard every valid Search result.
      return [];
    }
  });
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

  if (ramModule && !ownershipRequiresSqlite) {
    const ramWindow = await ramModule.queryGuideWindow(startMs, endMs, uniqueIds);
    if (ramWindow) return windowToPrograms(ramWindow, uniqueIds);
  }
  if (typeof nativeModule.queryGuideWindow === "function") {
    const window = await nativeModule.queryGuideWindow(startMs, endMs, uniqueIds);
    return windowToPrograms(window, uniqueIds);
  }
  return loadNativeEpgWindow(uniqueIds, startMs, endMs);
}

export async function touchNativePlaylistRefresh(playlistEpoch: number): Promise<void> {
  if (nativeModule?.touchPlaylistRefresh) {
    await nativeModule.touchPlaylistRefresh(playlistEpoch);
  }
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

export async function configureNativeGuideOwnership(
  primaryEnabled: boolean,
  userEnabled: boolean,
  userUrl: string,
  userOverrides: Record<string, string>,
): Promise<void> {
  const normalizedUserUrl = userUrl.trim();
  const effectiveUserEnabled = userEnabled && !!normalizedUserUrl;
  if (nativeModule?.configureGuideOwnership) {
    // Native ownership is authoritative. Do not flip the in-process routing flag
    // until the durable control-DB transaction has actually succeeded.
    await nativeModule.configureGuideOwnership(primaryEnabled, userEnabled, normalizedUserUrl, userOverrides);
  }
  primaryGuideEnabled = primaryEnabled;
  userGuideEnabled = effectiveUserEnabled;
  userGuideUrl = normalizedUserUrl;
  ownershipRequiresSqlite = !primaryEnabled || (effectiveUserEnabled && Object.keys(userOverrides).length > 0);
  if (ramModule) {
    // Any ownership rewrite invalidates primary-only RAM joins, including the
    // transition back to RAM after the final custom binding is cleared.
    await ramModule.clearMemory().catch(() => undefined);
  }
}

export async function setNativeGuideChannelBinding(channelId: string, xmltvId: string | null): Promise<number> {
  const bindingModule = customEpgModule?.setGuideChannelBinding ? customEpgModule : nativeModule;
  if (!bindingModule?.setGuideChannelBinding) return 0;
  const normalizedXmltvId = xmltvId?.trim() || "";
  const count = Math.max(0, Math.round(await bindingModule.setGuideChannelBinding(channelId, normalizedXmltvId)));
  ownershipRequiresSqlite = !primaryGuideEnabled || (userGuideEnabled && count > 0);

  // The filtered custom store intentionally did not keep programmes for an id
  // before it was assigned. Persist ownership synchronously, but do not make a
  // D-pad assignment wait for a full XMLTV network/parse cycle. The native custom
  // EPG executor serializes this hydration safely behind the binding write while
  // Guide continues serving its last-good rows.
  if (normalizedXmltvId && userGuideEnabled && userGuideUrl) {
    void refreshNativeUserGuide(userGuideUrl).catch((error) => {
      console.warn("CharmIPTV deferred custom EPG hydration failed", error);
    });
  }
  if (ramModule) await ramModule.clearMemory().catch(() => undefined);
  return count;
}

export async function listNativeUserGuideChannels(
  query = "",
  offset = 0,
  limit = 50,
): Promise<{ total: number; rows: { id: string; name: string }[] }> {
  const directoryModule = customEpgModule?.listUserGuideChannels ? customEpgModule : nativeModule;
  if (!directoryModule?.listUserGuideChannels) return { total: 0, rows: [] };
  return directoryModule.listUserGuideChannels(query, Math.max(0, offset), Math.max(1, Math.min(100, limit)));
}

export async function refreshNativeUserGuide(url: string): Promise<{
  count: number;
  channelNames?: Record<string, string>;
  channelIdsWithPrograms?: string[];
  directoryCount?: number;
  bindingCount?: number;
  guideEpoch?: number;
  guideRefreshedAt?: number;
  programmeSwapSucceeded?: boolean;
}> {
  const refreshModule = customEpgModule?.refreshUserGuide ? customEpgModule : nativeModule;
  if (!refreshModule?.refreshUserGuide) throw new Error("Custom native EPG engine is unavailable");
  return refreshModule.refreshUserGuide(url);
}

export async function clearNativeEpg(): Promise<void> {
  if (ramModule) await ramModule.clearMemory();
  if (nativeModule) await nativeModule.clear();
}
