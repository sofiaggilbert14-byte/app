import { DeviceEventEmitter, NativeModules, Platform } from "react-native";
import type { Channel, Program } from "@/src/api";
import { getMultiEpgSources } from "@/src/core/multiEpgSources";
import { enforcePlaylistByteLimit, enforcePlaylistTextLimit, parseM3UWithStats } from "@/src/core/sourceParsing";

type NativeProgramme = { channelId: string; title: string; description?: string | null; category?: string | null; startMs: number; endMs: number };
type NativeWindow = Record<string, NativeProgramme[]>;
const EMPTY_NATIVE_PROGRAMS: Program[] = [];
type NativePlaylistResult = { channels: Channel[]; rejected: number; truncated: boolean };
type NativeRefreshResult = { count: number; windowStartMs: number; windowEndMs: number; guideEpoch?: number; notModified?: boolean; channelLogos?: Record<string, string>; channelNames?: Record<string, string>; channelIdsWithPrograms?: string[] };
export type NativePlaylistChannelRow = { playlistId: string; rawTvgId?: string; name?: string; logo?: string; group?: string; url?: string; streamType?: string; position?: number };
export type NativePlaylistEpgMatchRow = { playlistId: string; xmltvId?: string; logoXmltvId?: string; ambiguous?: boolean; matchPolicy?: string; manual?: boolean };

const PLAYLIST_FETCH_TIMEOUT_MS = 45_000;

type CharmEpgModule = {
  fetchPlaylist?(url: string): Promise<NativePlaylistResult>;
  getStoredPlaylist?(): Promise<{ channels: Channel[]; playlistEpoch?: number; playlistRefreshedAt?: number; guideEpoch?: number; guideRefreshedAt?: number; epgProgramCount?: number; primaryGuideRefreshedAt?: number; userGuideRefreshedAt?: number; primaryEpgProgramCount?: number; userEpgProgramCount?: number }>;
  configureSource?(playlistId: string, url: string, refreshHours: number, serverOffsetMinutes: number, playlistOffsetMinutes: number, channelOffsets: Record<string, number>, pastDays: number): Promise<boolean>;
  consumeScheduledRefreshDue?(): Promise<boolean>;
  refresh(url: string, allowNotModified: boolean, activeXmltvIds: string[], activeChannelNames: string[]): Promise<NativeRefreshResult>;
  getWindow(startMs: number, endMs: number, channelIds: string[]): Promise<NativeWindow>;
  queryGuideWindow?(startMs: number, endMs: number, playlistChannelIds: string[]): Promise<NativeWindow>;
  isPlaylistCurrent?(contentFingerprint: string): Promise<boolean>;
  touchPlaylistRefresh?(playlistEpoch: number): Promise<boolean>;
  upsertPlaylistChannels?(channels: NativePlaylistChannelRow[], playlistEpoch: number, contentFingerprint: string): Promise<boolean>;
  upsertPlaylistEpgMatches?(matches: NativePlaylistEpgMatchRow[], guideEpoch: number): Promise<boolean>;
  searchProgrammes?(query: string, limit: number): Promise<NativeProgramme[]>;
  configureGuideOwnership?(primaryEnabled: boolean, userEnabled: boolean, userUrl: string, userOverrides: Record<string, string>): Promise<boolean>;
  configureUserGuideSources?(primaryEnabled: boolean, sources: { id: string; url: string; enabled: boolean; refreshHours: number }[]): Promise<boolean>;
  setGuideChannelBinding?(channelId: string, xmltvId: string): Promise<number>;
  listUserGuideChannels?(query: string, offset: number, limit: number): Promise<{ total: number; rows: { id: string; name: string }[] }>;
  refreshUserGuide?(url: string): Promise<{ count: number; channelNames?: Record<string, string>; channelIdsWithPrograms?: string[] }>;
  clear(): Promise<boolean>;
};

type CharmCustomEpgModule = {
  setGuideChannelBinding?(channelId: string, xmltvId: string): Promise<number>;
  listUserGuideChannels?(query: string, offset: number, limit: number): Promise<{ total: number; rows: { id: string; name: string }[] }>;
  refreshUserGuide?(url: string): Promise<{ count: number; directoryCount?: number; bindingCount?: number; guideEpoch?: number; guideRefreshedAt?: number; programmeSwapSucceeded?: boolean }>;
  clearUserGuide?(): Promise<boolean>;
  setSourceChannelBinding?(sourceId: string, channelId: string, xmltvId: string): Promise<number>;
  listSourceGuideChannels?(sourceId: string, query: string, offset: number, limit: number): Promise<{ total: number; rows: { id: string; name: string }[] }>;
  searchSourceProgrammes?(sourceId: string, query: string, limit: number): Promise<NativeProgramme[]>;
  refreshSourceGuide?(sourceId: string, url: string): Promise<{ count: number; directoryCount?: number; bindingCount?: number; guideEpoch?: number; guideRefreshedAt?: number; programmeSwapSucceeded?: boolean }>;
  clearSourceGuide?(sourceId: string): Promise<boolean>;
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
  const startMs = Number(program.startMs), endMs = Number(program.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs <= 0 || endMs <= startMs) throw new Error("Native EPG returned an invalid programme time range");
  return { title: program.title || "No Information", desc: program.description || "", category: program.category || "", start: new Date(startMs).toISOString(), stop: new Date(endMs).toISOString() };
}
function windowToPrograms(window: NativeWindow, channelIds: string[]): Record<string, Program[]> {
  const result: Record<string, Program[]> = {};
  for (const channelId of channelIds) { if (result[channelId]) continue; const programmes = window[channelId]; result[channelId] = programmes?.length ? programmes.map(toProgram) : EMPTY_NATIVE_PROGRAMS; }
  return result;
}
function convertSearchRows(rows: NativeProgramme[]): { channelId: string; program: Program }[] {
  return rows.flatMap((row) => {
    if (!row?.channelId) return [];
    try { return [{ channelId: row.channelId, program: toProgram(row) }]; } catch { return []; }
  });
}

export async function fetchNativePlaylist(url: string): Promise<NativePlaylistResult> {
  const cleanUrl = (url || "").trim();
  if (!cleanUrl) throw new Error("Playlist URL is empty");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYLIST_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(cleanUrl, {
      headers: { "User-Agent": "CharmIPTV/Experimental-v3" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`M3U HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || "");
    if (Number.isFinite(contentLength) && contentLength > 0) enforcePlaylistByteLimit(contentLength);
    const text = await response.text();
    enforcePlaylistTextLimit(text);
    return parseM3UWithStats(text, (value) => value);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Playlist request timed out before channels could be loaded");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export async function readNativeStoredPlaylist(): Promise<{ channels: Channel[]; playlistEpoch: number; playlistRefreshedAt: number; guideEpoch: number; guideRefreshedAt: number; epgProgramCount: number } | null> {
  if (!nativeModule?.getStoredPlaylist) return null; const value = await nativeModule.getStoredPlaylist(); const channels = Array.isArray(value?.channels) ? value.channels : []; if (!channels.length) return null;
  return { channels, playlistEpoch: Number(value.playlistEpoch || 0), playlistRefreshedAt: Number(value.playlistRefreshedAt || 0), guideEpoch: Number(value.guideEpoch || 0), guideRefreshedAt: Number(value.guideRefreshedAt || 0), epgProgramCount: Number(value.epgProgramCount || 0) };
}
export async function refreshNativeEpg(url: string, allowNotModified: boolean, activeXmltvIds: string[], activeChannelNames: string[], onProgress?: (phase: string, ratio: number) => void): Promise<NativeRefreshResult> {
  if (!nativeModule) throw new Error("Native EPG engine is unavailable");
  const subscription = onProgress ? DeviceEventEmitter.addListener("CharmEpgImportProgress", (event: { phase?: string; ratio?: number }) => { if (typeof event?.ratio === "number") onProgress(event.phase || "downloading", event.ratio); }) : null;
  try { return await nativeModule.refresh(url, allowNotModified, activeXmltvIds, activeChannelNames); } finally { subscription?.remove(); }
}
export async function configureNativeEpgSource(url: string, refreshHours: number, serverOffsetMinutes = 0, playlistOffsetMinutes = 0, channelOffsets: Record<string, number> = {}, pastDays = 7): Promise<void> {
  if (!nativeModule?.configureSource) return; await nativeModule.configureSource("default", url, refreshHours, serverOffsetMinutes, playlistOffsetMinutes, channelOffsets, pastDays);
}
export async function consumeNativeScheduledEpgRefresh(): Promise<boolean> { return nativeModule?.consumeScheduledRefreshDue?.() ?? false; }

export async function searchNativeEpg(query: string, limit = 24): Promise<{ channelId: string; program: Program }[]> {
  const value = query.trim(); if (!nativeModule?.searchProgrammes || value.length < 2) return [];
  const safeLimit = Math.max(1, Math.min(80, limit));
  const combined = convertSearchRows(await nativeModule.searchProgrammes(value, safeLimit));
  const seen = new Set(combined.map((item) => `${item.channelId}:${item.program.start}`));
  if (customEpgModule?.searchSourceProgrammes && combined.length < safeLimit) {
    const sources = await getMultiEpgSources();
    for (const source of sources) {
      if (combined.length >= safeLimit) break;
      if (!source.enabled || !source.url || !Object.keys(source.overrides).length) continue;
      const rows = await customEpgModule.searchSourceProgrammes(source.id, value, safeLimit - combined.length).catch(() => []);
      for (const item of convertSearchRows(rows)) {
        const key = `${item.channelId}:${item.program.start}`; if (seen.has(key)) continue; seen.add(key); combined.push(item); if (combined.length >= safeLimit) break;
      }
    }
  }
  return combined;
}

export async function clearNativeEpgRam(): Promise<void> { if (ramModule) await ramModule.clearMemory(); }
export async function clearNativeUserGuide(): Promise<void> { if (!customEpgModule?.clearUserGuide) throw new Error("Custom EPG clear is unavailable on this build"); await customEpgModule.clearUserGuide(); await clearNativeEpgRam(); }
export async function loadNativeEpgWindow(channelIds: string[], startMs: number, endMs: number): Promise<Record<string, Program[]>> {
  if (!nativeModule) return {}; const uniqueIds = Array.from(new Set(channelIds.filter(Boolean))); if (!uniqueIds.length) return {};
  if (ramModule) { const ramWindow = await ramModule.getWindow(startMs, endMs, uniqueIds); if (ramWindow) return windowToPrograms(ramWindow, uniqueIds); }
  return windowToPrograms(await nativeModule.getWindow(startMs, endMs, uniqueIds), uniqueIds);
}
export async function queryNativeGuideWindow(playlistChannelIds: string[], startMs: number, endMs: number): Promise<Record<string, Program[]>> {
  if (!nativeModule) return {}; const uniqueIds = Array.from(new Set(playlistChannelIds.filter(Boolean))); if (!uniqueIds.length) return {};
  if (ramModule && !ownershipRequiresSqlite) { const ramWindow = await ramModule.queryGuideWindow(startMs, endMs, uniqueIds); if (ramWindow) return windowToPrograms(ramWindow, uniqueIds); }
  if (typeof nativeModule.queryGuideWindow === "function") return windowToPrograms(await nativeModule.queryGuideWindow(startMs, endMs, uniqueIds), uniqueIds);
  return loadNativeEpgWindow(uniqueIds, startMs, endMs);
}
export async function touchNativePlaylistRefresh(playlistEpoch: number): Promise<void> { if (nativeModule?.touchPlaylistRefresh) await nativeModule.touchPlaylistRefresh(playlistEpoch); }
export async function upsertNativePlaylistChannels(channels: NativePlaylistChannelRow[], playlistEpoch: number, contentFingerprint: string): Promise<boolean> { if (!nativeModule?.upsertPlaylistChannels || !channels.length) return false; return nativeModule.upsertPlaylistChannels(channels, playlistEpoch, contentFingerprint); }
export async function nativePlaylistIsCurrent(contentFingerprint: string): Promise<boolean> { if (!nativeModule?.isPlaylistCurrent || !contentFingerprint) return false; return nativeModule.isPlaylistCurrent(contentFingerprint); }
export async function upsertNativePlaylistEpgMatches(matches: NativePlaylistEpgMatchRow[], guideEpoch: number): Promise<void> { if (nativeModule?.upsertPlaylistEpgMatches) await nativeModule.upsertPlaylistEpgMatches(matches, guideEpoch); if (ramModule) await ramModule.replaceMatches(matches); }

export async function configureNativeGuideOwnership(primaryEnabled: boolean, userEnabled: boolean, userUrl: string, userOverrides: Record<string, string>): Promise<void> {
  const normalizedUserUrl = userUrl.trim(); const effectiveUserEnabled = userEnabled && !!normalizedUserUrl;
  if (nativeModule?.configureGuideOwnership) await nativeModule.configureGuideOwnership(primaryEnabled, userEnabled, normalizedUserUrl, userOverrides);
  primaryGuideEnabled = primaryEnabled; userGuideEnabled = effectiveUserEnabled; userGuideUrl = normalizedUserUrl; ownershipRequiresSqlite = !primaryEnabled || (effectiveUserEnabled && Object.keys(userOverrides).length > 0);
  if (ramModule) await ramModule.clearMemory().catch(() => undefined);
}
export type NativeUserGuideSource = { id: string; url: string; enabled: boolean; refreshHours: number };
export async function configureNativeUserGuideSources(primaryEnabled: boolean, sources: NativeUserGuideSource[], options?: { clearRam?: boolean }): Promise<void> {
  if (nativeModule?.configureUserGuideSources) await nativeModule.configureUserGuideSources(primaryEnabled, sources.slice(0, 8));
  primaryGuideEnabled = primaryEnabled; ownershipRequiresSqlite = sources.some((source) => source.enabled && !!source.url);
  if (options?.clearRam !== false && ramModule) await ramModule.clearMemory().catch(() => undefined);
}
export async function setNativeSourceGuideBinding(sourceId: string, channelId: string, xmltvId: string | null): Promise<number> { if (!customEpgModule?.setSourceChannelBinding) throw new Error("Multi-source EPG assignments are unavailable on this build"); const count = await customEpgModule.setSourceChannelBinding(sourceId, channelId, xmltvId?.trim() || ""); if (ramModule) await ramModule.clearMemory().catch(() => undefined); return Math.max(0, Math.round(count)); }
export async function listNativeSourceGuideChannels(sourceId: string, query = "", offset = 0, limit = 50) { if (!customEpgModule?.listSourceGuideChannels) return { total: 0, rows: [] }; return customEpgModule.listSourceGuideChannels(sourceId, query, Math.max(0, offset), Math.max(1, Math.min(100, limit))); }
export async function refreshNativeSourceGuide(sourceId: string, url: string) { if (!customEpgModule?.refreshSourceGuide) throw new Error("Multi-source EPG refresh is unavailable on this build"); return customEpgModule.refreshSourceGuide(sourceId, url); }
export async function clearNativeSourceGuide(sourceId: string): Promise<void> { if (!customEpgModule?.clearSourceGuide) throw new Error("Multi-source EPG clear is unavailable on this build"); await customEpgModule.clearSourceGuide(sourceId); if (ramModule) await ramModule.clearMemory().catch(() => undefined); }
export async function setNativeGuideChannelBinding(channelId: string, xmltvId: string | null): Promise<number> {
  const bindingModule = customEpgModule?.setGuideChannelBinding ? customEpgModule : nativeModule; if (!bindingModule?.setGuideChannelBinding) return 0; const normalizedXmltvId = xmltvId?.trim() || "";
  const count = Math.max(0, Math.round(await bindingModule.setGuideChannelBinding(channelId, normalizedXmltvId))); ownershipRequiresSqlite = !primaryGuideEnabled || (userGuideEnabled && count > 0);
  if (normalizedXmltvId && userGuideEnabled && userGuideUrl) void refreshNativeUserGuide(userGuideUrl).catch((error) => console.warn("CharmIPTV deferred custom EPG hydration failed", error));
  if (ramModule) await ramModule.clearMemory().catch(() => undefined); return count;
}
export async function listNativeUserGuideChannels(query = "", offset = 0, limit = 50): Promise<{ total: number; rows: { id: string; name: string }[] }> { const directoryModule = customEpgModule?.listUserGuideChannels ? customEpgModule : nativeModule; if (!directoryModule?.listUserGuideChannels) return { total: 0, rows: [] }; return directoryModule.listUserGuideChannels(query, Math.max(0, offset), Math.max(1, Math.min(100, limit))); }
export async function refreshNativeUserGuide(url: string): Promise<{ count: number; channelNames?: Record<string, string>; channelIdsWithPrograms?: string[]; directoryCount?: number; bindingCount?: number; guideEpoch?: number; guideRefreshedAt?: number; programmeSwapSucceeded?: boolean }> { const refreshModule = customEpgModule?.refreshUserGuide ? customEpgModule : nativeModule; if (!refreshModule?.refreshUserGuide) throw new Error("Custom native EPG engine is unavailable"); return refreshModule.refreshUserGuide(url); }
export async function clearNativeEpg(): Promise<void> { if (ramModule) await ramModule.clearMemory(); if (nativeModule) await nativeModule.clear(); }
