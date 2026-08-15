import dayjs from "dayjs";
import { File, Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import type { Channel, GuideResponse, Program, SourceStatus } from "@/src/api";
import { clearGuidePrograms } from "@/src/core/guideProgramsStore";
import {
  enforcePlaylistByteLimit,
  parseM3ULinesWithStats,
} from "@/src/core/sourceParsing";
import {
  clearNativeEpg,
  loadNativeEpgWindow,
  nativeEpgAvailable,
  nativePlaylistIsCurrent,
  queryNativeGuideWindow,
  refreshNativeEpg,
  upsertNativePlaylistChannels,
  upsertNativePlaylistEpgMatches,
} from "@/src/nativeEpg";
import {
  applyLogoOnlyUpdates,
  applyXmltvMatchesToChannels,
  buildXmltvMatchIndexes,
  channelMatchIdentity,
  emptyMatchQuality,
  formatNativeEpgError,
  mergeMatchQuality,
  type EpgMatchQuality,
} from "@/src/core/epgMatching";
import { applyManualEpgRemaps, type EpgManualRemap } from "@/src/core/epgUserOverrides";
import { cleanupLegacyEpgArtifactsOnce } from "@/src/utils/legacyEpgCleanup";
import {
  DEFAULT_GUIDE_WINDOW_HOURS,
  resolveGuideWindowHours,
} from "@/src/core/guideWindowPolicy";

export const API_BASE = "";
/** Playlist URL — set via EXPO_PUBLIC_M3U_URL at build time. Never hardcode provider URLs. */
export const SOURCE_M3U = (process.env.EXPO_PUBLIC_M3U_URL || "").trim();
/** XMLTV URL — set via EXPO_PUBLIC_EPG_URL at build time. Never hardcode provider URLs. */
export const SOURCE_EPG = (process.env.EXPO_PUBLIC_EPG_URL || "").trim();

/** Shared empty programmes array — reused for channels with no EPG in-window. Never mutate. */
const EMPTY_PROGRAMS: Program[] = [];
/** Cold paint only; the Guide immediately replaces this with its exact 7/7 runway. */
const INITIAL_GUIDE_RUNWAY_ROWS = 120;

const DEFAULT_EPG_REFRESH_HOURS = 24;
const SOURCE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
let epgRefreshIntervalMs = DEFAULT_EPG_REFRESH_HOURS * 60 * 60 * 1000;

export function setEpgRefreshIntervalHours(hours: number): void {
  const boundedHours = Math.min(48, Math.max(1, Math.round(Number(hours) || DEFAULT_EPG_REFRESH_HOURS)));
  epgRefreshIntervalMs = boundedHours * 60 * 60 * 1000;
}
const PROGRESS_THROTTLE_MS = 150;
/** Above this, match current-group / priority ids first, then the rest (keeps channels-first paint snappy). */
const HUGE_PLAYLIST_MATCH_THRESHOLD = 400;
/** Bounded JS row cache; the native SQLite index remains authoritative. */
let maxProgrammeWindowKeys = 1800;
const CACHE_ROOT = FileSystem.documentDirectory || "";
const CHANNEL_CACHE = CACHE_ROOT ? `${CACHE_ROOT}charm_native_channels_v2.json` : "";
const LEGACY_CHANNEL_CACHE = CACHE_ROOT ? `${CACHE_ROOT}charm_native_channels_v1.json` : "";
const CHANNEL_CACHE_TMP = CHANNEL_CACHE ? `${CHANNEL_CACHE}.tmp` : "";
const CHANNEL_CACHE_BAK = CHANNEL_CACHE ? `${CHANNEL_CACHE}.bak` : "";

type NativeMeta = {
  ts: number;
  channels: Channel[];
  epgProgramCount: number;
  epgChannelCount: number;
  epgError?: string;
  /** Soft epochs — independent playlist vs guide; never a hard joint snapshot. */
  playlistEpoch?: number;
  guideEpoch?: number;
  playlistRefreshedAt?: number;
  guideRefreshedAt?: number;
  matchFingerprint?: string;
  matchQuality?: EpgMatchQuality;
  /** "tvg" | "full" — logo-only skip must not ignore policy changes. */
  matchPolicy?: string;
  /** Playlist id/tvg_id/name fingerprint — logo-only only when this is unchanged. */
  playlistIdentityFingerprint?: string;
};

let MEM: NativeMeta | null = null;
let refreshPromise: Promise<NativeMeta> | null = null;
let lastSourceError: string | null = null;
const listeners = new Set<() => void>();
let sourceEmitScheduled = false;

/** Runtime match policy — store syncs this from settings (prefer tvg-id only). */
let preferTvgIdOnly = false;
/** Optional priority channel ids for huge-list first-pass matching (current group / viewport). */
let priorityMatchChannelIds: string[] = [];
/** Manual per-channel XMLTV remaps (user wins over auto-match). */
let manualEpgRemaps: EpgManualRemap = {};
/** Optional viewport ids for guide window queries (perf). */
let viewportGuideChannelIds: string[] | null = null;
/** Merged programme window — viewport fetches must not wipe off-screen rows. */
let programmeWindowCache: Record<string, Program[]> = {};
/** Negative cache avoids re-querying unmatched/no-data rows on every D-pad move. */
let programmeWindowEmptyKeys = new Set<string>();
/** Shared LRU order for positive and negative window rows. */
let programmeWindowAccessOrder = new Set<string>();
let programmeWindowCacheKey = "";
/** Coalesce overlapping warm/viewport reads so one channel is never queried twice. */
const programmeWindowInFlight = new Map<string, Promise<void>>();
let lastNativeMatchWriteFingerprint = "";

export function setPreferTvgIdOnlyMatching(value: boolean): void {
  preferTvgIdOnly = !!value;
  // Force a full rematch on next EPG refresh — do not keep a logo-only short-circuit.
  if (MEM) {
    MEM = { ...MEM, matchFingerprint: undefined, matchPolicy: undefined };
  }
}

export function setPriorityMatchChannelIds(ids: string[]): void {
  priorityMatchChannelIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
}

export function setManualEpgRemaps(remaps: EpgManualRemap): void {
  manualEpgRemaps = remaps && typeof remaps === "object" ? remaps : {};
  // Keep SQL join table aligned with user remaps without waiting for a full EPG refresh.
  if (MEM?.channels?.length) {
    void syncMatchesToNative(MEM.channels, MEM.guideEpoch || 0).catch(() => undefined);
  }
}

export function setViewportGuideChannelIds(ids: string[] | null): void {
  viewportGuideChannelIds = ids && ids.length ? ids.filter(Boolean) : null;
}

/** Conveyor-belt eviction: drop native window rows outside the hysteresis keep set. */
export function retainProgrammeWindowCache(keepIds: Iterable<string>): void {
  const keep = Array.from(keepIds).filter(Boolean);
  if (!keep.length) return;
  trimProgrammeWindowCache(keep, "strict");
}

async function syncPlaylistToNative(channels: Channel[], playlistEpoch: number): Promise<void> {
  if (!nativeEpgAvailable || !channels.length) return;
  const contentFingerprint = playlistNativeContentFingerprint(channels);
  if (await nativePlaylistIsCurrent(contentFingerprint)) return;
  await upsertNativePlaylistChannels(
    channels.map((channel) => ({
      playlistId: channel.id,
      rawTvgId: channel.raw_tvg_id || channel.tvg_id || "",
      name: channel.name || "",
      logo: channel.logo || "",
      group: channel.group || "",
    })),
    playlistEpoch,
    contentFingerprint,
  );
}

/** Two independent 32-bit hashes keep the cold-start native handshake compact. */
function playlistNativeContentFingerprint(channels: Channel[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let charCount = 0;
  for (const channel of channels) {
    const value = `${channel.id}\0${channel.raw_tvg_id || channel.tvg_id || ""}\0${channel.name || ""}\0${channel.logo || ""}\0${channel.group || ""}\x01`;
    charCount += value.length;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 0x01000193);
      h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b);
    }
  }
  return `playlist-v1:${channels.length}:${charCount}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

async function syncMatchesToNative(channels: Channel[], guideEpoch: number): Promise<void> {
  if (!nativeEpgAvailable || !channels.length) return;
  const remapped = withManualRemaps(channels);
  const policy = matchPolicyKey();
  const rows = remapped.map((channel) => {
    const manual = Object.prototype.hasOwnProperty.call(manualEpgRemaps, channel.id);
    const xmltvId = (channel.tvg_id || "").trim();
    return {
      playlistId: channel.id,
      xmltvId,
      logoXmltvId: xmltvId,
      ambiguous: false,
      matchPolicy: policy,
      manual,
    };
  });
  const writeFingerprint = rows
    .map((row) => `${row.playlistId}\u0001${row.xmltvId}\u0001${row.logoXmltvId}\u0001${row.matchPolicy}\u0001${row.manual ? 1 : 0}`)
    .join("\u0002");
  if (writeFingerprint === lastNativeMatchWriteFingerprint) {
    lastNativeMatchWriteFingerprint = writeFingerprint;
    return;
  }
  await upsertNativePlaylistEpgMatches(rows, guideEpoch);
  lastNativeMatchWriteFingerprint = writeFingerprint;
}

function resolveGuideWindowBounds(startISO?: string, hours = DEFAULT_GUIDE_WINDOW_HOURS): {
  winStart: dayjs.Dayjs;
  winEnd: dayjs.Dayjs;
  startMs: number;
  endMs: number;
  now: dayjs.Dayjs;
} {
  const now = dayjs();
  // The initial call starts at the real current instant, so no past time frame
  // can be panned into view. Store passes this exact ISO value to every runway
  // patch, keeping the cache key stable while the remote is held.
  const winStart = startISO ? dayjs(startISO) : now;
  const windowHours = resolveGuideWindowHours(hours, DEFAULT_GUIDE_WINDOW_HOURS);
  const winEnd = winStart.add(windowHours, "hour");
  return {
    winStart,
    winEnd,
    startMs: winStart.valueOf(),
    endMs: winEnd.valueOf(),
    now,
  };
}

function clearProgrammeWindowCache(): void {
  programmeWindowCache = {};
  programmeWindowEmptyKeys.clear();
  programmeWindowAccessOrder.clear();
  programmeWindowCacheKey = "";
  // In-flight native reads cannot be cancelled, but their cache-key guard keeps
  // them from merging stale results after this reset. Let new-window reads start.
  programmeWindowInFlight.clear();
}

function touchProgrammeWindowKey(channelId: string): void {
  programmeWindowAccessOrder.delete(channelId);
  programmeWindowAccessOrder.add(channelId);
}

/** Evict off-window rows; soft mode only caps LRU size, strict drops outside keep. */
function trimProgrammeWindowCache(keepKeys: Iterable<string>, mode: "soft" | "strict" = "soft"): void {
  const keep = new Set(keepKeys);
  if (mode === "strict" && keep.size > 0) {
    for (const key of Object.keys(programmeWindowCache)) {
      if (keep.has(key)) continue;
      delete programmeWindowCache[key];
      programmeWindowAccessOrder.delete(key);
    }
    for (const key of Array.from(programmeWindowEmptyKeys)) {
      if (keep.has(key)) continue;
      programmeWindowEmptyKeys.delete(key);
    }
  }
  let protectedPasses = programmeWindowAccessOrder.size;
  while (programmeWindowAccessOrder.size > maxProgrammeWindowKeys && protectedPasses > 0) {
    const oldest = programmeWindowAccessOrder.values().next().value as string | undefined;
    if (!oldest) break;
    if (keep.has(oldest)) {
      touchProgrammeWindowKey(oldest);
      protectedPasses -= 1;
      continue;
    }
    programmeWindowAccessOrder.delete(oldest);
    delete programmeWindowCache[oldest];
    programmeWindowEmptyKeys.delete(oldest);
  }
}

export function setProgrammeWindowCacheLimit(limit: number): void {
  maxProgrammeWindowKeys = Math.max(128, Math.min(4000, Math.floor(limit || 1800)));
  trimProgrammeWindowCache(viewportGuideChannelIds || []);
}

export function trimProgrammeWindowCacheForMemoryPressure(
  keepIds: string[] = [],
  critical = false,
): void {
  const previous = maxProgrammeWindowKeys;
  maxProgrammeWindowKeys = critical
    ? Math.max(128, keepIds.length)
    : Math.max(256, Math.floor(previous / 2), keepIds.length);
  trimProgrammeWindowCache(keepIds);
  maxProgrammeWindowKeys = previous;
}

function hasCachedProgrammeResult(channelId: string): boolean {
  const cached = !!programmeWindowCache[channelId] || programmeWindowEmptyKeys.has(channelId);
  if (cached) touchProgrammeWindowKey(channelId);
  return cached;
}

function mergeProgrammeQueryResult(
  requestedIds: Iterable<string>,
  programmes: Record<string, Program[]>,
): void {
  for (const channelId of requestedIds) {
    if (!channelId) continue;
    const list = programmes[channelId];
    if (list?.length) {
      programmeWindowEmptyKeys.delete(channelId);
      programmeWindowCache[channelId] = list;
    } else {
      delete programmeWindowCache[channelId];
      programmeWindowEmptyKeys.add(channelId);
    }
    touchProgrammeWindowKey(channelId);
  }
}

function matchPolicyKey(): string {
  return preferTvgIdOnly ? "tvg" : "full";
}

function playlistIdentityFingerprint(channels: Channel[]): string {
  // Logo URLs intentionally excluded — logo-only EPG drift must not force rematch.
  return channels.map((channel) => channelMatchIdentity(channel)).join("\n");
}

function withManualRemaps(channels: Channel[]): Channel[] {
  return applyManualEpgRemaps(channels, manualEpgRemaps);
}

function restoreLastGoodMatchesAfterEpgFailure(
  freshChannels: Channel[],
  lastGoodChannels: Channel[] = [],
): Channel[] {
  if (!freshChannels.length || !lastGoodChannels.length) return freshChannels;
  const previousById = new Map(lastGoodChannels.map((channel) => [channel.id, channel] as const));
  return freshChannels.map((channel) => {
    const previous = previousById.get(channel.id);
    if (!previous) return channel;
    return {
      ...channel,
      tvg_id: previous.tvg_id || channel.tvg_id,
      logo: channel.logo || previous.logo,
    };
  });
}

async function nextTick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Two-phase match on huge lists: priority/viewport first + emit, then remainder.
 * Avoids waiting for the full rematch before the visible group feels “live”.
 * Returns auto-matched rows only — manual remaps are applied at loadGuide / UI read time
 * so clearing a remap can restore the auto-matched tvg_id.
 */
async function matchChannelsWithPhases(
  channels: Channel[],
  indexes: ReturnType<typeof buildXmltvMatchIndexes>,
  epgLogos: Record<string, string>,
  onPartial?: (channels: Channel[], quality: EpgMatchQuality) => void | Promise<void>,
): Promise<{ channels: Channel[]; quality: EpgMatchQuality }> {
  const huge = channels.length >= HUGE_PLAYLIST_MATCH_THRESHOLD;
  const priority =
    huge && priorityMatchChannelIds.length
      ? Array.from(new Set(priorityMatchChannelIds)).slice(0, 500)
      : [];

  if (priority.length > 0 && onPartial) {
    const phase1 = applyXmltvMatchesToChannels(channels, indexes, epgLogos, {
      preferTvgIdOnly,
      onlyChannelIds: priority,
    });
    await onPartial(phase1.channels, phase1.quality);
    await nextTick();
    const restIds = channels.map((c) => c.id).filter((id) => !priority.includes(id));
    const phase2 = applyXmltvMatchesToChannels(phase1.channels, indexes, epgLogos, {
      preferTvgIdOnly,
      onlyChannelIds: restIds,
    });
    return {
      channels: phase2.channels,
      quality: mergeMatchQuality(phase1.quality, phase2.quality),
    };
  }

  const applied = applyXmltvMatchesToChannels(channels, indexes, epgLogos, {
    preferTvgIdOnly,
    priorityChannelIds: priority.length ? priority : undefined,
  });
  return { channels: applied.channels, quality: applied.quality };
}

export type LoadPhase = "idle" | "update_available" | "channels" | "downloading" | "decompressing" | "parsing" | "indexing" | "matching" | "caching" | "finalizing" | "ready" | "error";
export type EpgProgress = {
  phase: LoadPhase;
  ratio: number;
  etaSeconds: number | null;
  /** Present on error (and cleared on successful phases). */
  message?: string | null;
};

let progress: EpgProgress = { phase: "idle", ratio: 0, etaSeconds: null, message: null };
const progressListeners = new Set<(value: EpgProgress) => void>();
let lastProgressEmit = 0;
let progressTimer: ReturnType<typeof setTimeout> | null = null;

function notifyProgress(snapshot: EpgProgress): void {
  lastProgressEmit = Date.now();
  for (const listener of Array.from(progressListeners)) {
    if (!progressListeners.has(listener)) continue;
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("CharmIPTV progress listener failed", error);
    }
  }
}

export function subscribeProgress(listener: (value: EpgProgress) => void): () => void {
  progressListeners.add(listener);
  try {
    listener(progress);
  } catch (error) {
    console.warn("CharmIPTV initial progress listener failed", error);
  }
  return () => {
    progressListeners.delete(listener);
  };
}

function setProgress(next: Partial<EpgProgress>, force = false): void {
  const previousPhase = progress.phase;
  progress = {
    ...progress,
    ...next,
    // Clear stale error copy whenever we leave the error phase unless caller sets message.
    message:
      next.message !== undefined
        ? next.message
        : next.phase && next.phase !== "error"
          ? null
          : progress.message,
  };
  const phaseChanged = progress.phase !== previousPhase;
  const terminal = progress.phase === "ready" || progress.phase === "error" || progress.ratio >= 1;
  const elapsed = Date.now() - lastProgressEmit;

  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }

  if (force || phaseChanged || terminal || elapsed >= PROGRESS_THROTTLE_MS) {
    notifyProgress(progress);
    return;
  }

  progressTimer = setTimeout(() => {
    progressTimer = null;
    notifyProgress(progress);
  }, Math.max(1, PROGRESS_THROTTLE_MS - elapsed));
}

function emit(): void {
  if (sourceEmitScheduled) return;
  sourceEmitScheduled = true;
  queueMicrotask(() => {
    sourceEmitScheduled = false;
    for (const listener of Array.from(listeners)) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        console.warn("CharmIPTV source listener failed", error);
      }
    }
  });
}

export function subscribeSource(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function providerHttpUrls(url: string, label: "playlist" | "EPG"): string[] {
  const value = url.trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new Error(`${label} URL must use HTTP or HTTPS`);
  }
  if (!value.toLowerCase().startsWith("http://")) return [value];
  // Preserve PR #23's proven HTTPS-first provider behavior. Some IPTV servers
  // serve playlists over HTTP but reject the XMLTV endpoint unless upgraded.
  // Keep the configured HTTP form as a compatibility fallback.
  return [`https://${value.slice(7)}`, value];
}

function isProviderTransportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /\bhttp\s+\d{3}\b|network|timeout|timed out|failed to connect|unable to download|unable to resolve|unknown host|connection|socket|ssl|handshake|cleartext/i.test(
    message,
  );
}

async function refreshConfiguredNativeEpg(allowNotModified: boolean) {
  const candidates = providerHttpUrls(SOURCE_EPG, "EPG");
  let firstError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await refreshNativeEpg(candidate, allowNotModified);
    } catch (error) {
      if (firstError == null) firstError = error;
      // Retry only transport failures. A parse, storage, or SQLite failure must
      // retain the last-good guide and surface immediately, not download again.
      if (!isProviderTransportFailure(error)) throw error;
    }
  }
  throw firstError || new Error("Could not download the TV guide");
}

function sortChannels(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }),
  );
}

async function readMetaFile(path: string): Promise<NativeMeta | null> {
  if (!path) return null;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path)) as NativeMeta;
    if (!Array.isArray(parsed.channels) || !parsed.channels.length || !Number.isFinite(parsed.ts)) return null;
    return {
      ts: parsed.ts,
      channels: sortChannels(parsed.channels),
      epgProgramCount: Number(parsed.epgProgramCount || 0),
      epgChannelCount: Number(parsed.epgChannelCount || 0),
      epgError: parsed.epgError,
      playlistEpoch: parsed.playlistEpoch,
      guideEpoch: parsed.guideEpoch,
      playlistRefreshedAt: parsed.playlistRefreshedAt,
      guideRefreshedAt: parsed.guideRefreshedAt,
      matchFingerprint: parsed.matchFingerprint,
      matchQuality: parsed.matchQuality,
      matchPolicy: parsed.matchPolicy,
      playlistIdentityFingerprint: parsed.playlistIdentityFingerprint,
    };
  } catch {
    return null;
  }
}

async function readChannelCache(): Promise<NativeMeta | null> {
  const primary = await readMetaFile(CHANNEL_CACHE);
  if (primary) return primary;
  const backup = await readMetaFile(CHANNEL_CACHE_BAK);
  return backup || null;
}

async function persistMeta(meta: NativeMeta): Promise<void> {
  if (!CHANNEL_CACHE || !CHANNEL_CACHE_TMP || !CHANNEL_CACHE_BAK) return;
  const json = JSON.stringify(meta);
  await FileSystem.writeAsStringAsync(CHANNEL_CACHE_TMP, json);
  if (!(await readMetaFile(CHANNEL_CACHE_TMP))) {
    await FileSystem.deleteAsync(CHANNEL_CACHE_TMP, { idempotent: true }).catch(() => undefined);
    throw new Error("Channel cache verification failed");
  }
  const validCurrent = await readMetaFile(CHANNEL_CACHE);
  if (validCurrent) {
    await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: CHANNEL_CACHE, to: CHANNEL_CACHE_BAK });
  } else {
    // Never rotate a corrupt primary over a valid last-good backup.
    await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  }
  try {
    await FileSystem.moveAsync({ from: CHANNEL_CACHE_TMP, to: CHANNEL_CACHE });
    if (!(await readMetaFile(CHANNEL_CACHE))) throw new Error("Promoted channel cache is invalid");
    await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);
  } catch (error) {
    await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
    const backup = await FileSystem.getInfoAsync(CHANNEL_CACHE_BAK).catch(() => null);
    if (backup?.exists) {
      await FileSystem.moveAsync({ from: CHANNEL_CACHE_BAK, to: CHANNEL_CACHE }).catch(() => undefined);
    }
    throw error;
  }
}

async function* readLocalPlaylistLines(file: File): AsyncGenerator<string> {
  const handle = file.open();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunkBytes = 128 * 1024;
  const maximumLineChars = 1024 * 1024;
  let carry = "";
  let chunks = 0;
  try {
    while (handle.offset != null && handle.size != null && handle.offset < handle.size) {
      const bytes = handle.readBytes(Math.min(chunkBytes, handle.size - handle.offset));
      if (!bytes.length) break;
      carry += decoder.decode(bytes, { stream: true });
      let lineStart = 0;
      let nextBreak = carry.indexOf("\n", lineStart);
      while (nextBreak >= 0) {
        yield carry.slice(lineStart, nextBreak).replace(/\r$/, "");
        lineStart = nextBreak + 1;
        nextBreak = carry.indexOf("\n", lineStart);
      }
      carry = carry.slice(lineStart);
      if (carry.length > maximumLineChars) throw new Error("Playlist contains an invalid oversized line");
      chunks += 1;
      const ratio = file.size > 0 ? Math.min(1, (handle.offset || 0) / file.size) : 1;
      setProgress({ phase: "channels", ratio: 0.05 + ratio * 0.12, etaSeconds: null });
      // Parsing runs only after the network is closed. Yield between local-file
      // chunks so startup/focus work is not monopolized by a large playlist.
      if (chunks % 2 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    carry += decoder.decode();
    if (carry) yield carry.replace(/\r$/, "");
  } finally {
    handle.close();
  }
}

async function fetchPlaylist(): Promise<Channel[]> {
  if (!SOURCE_M3U) {
    throw new Error("Playlist is not configured for this build (missing EXPO_PUBLIC_M3U_URL).");
  }
  const candidates = providerHttpUrls(SOURCE_M3U, "playlist");
  let firstError: unknown = null;
  const localFile = new File(Paths.cache, "charm_playlist_download.m3u.tmp");
  for (const candidate of candidates) {
    try {
      if (localFile.exists) localFile.delete();
      await File.downloadFileAsync(candidate, localFile, {
        headers: { "User-Agent": "CharmIPTV/Experimental-v3" },
        idempotent: true,
      });
      // File.downloadFileAsync resolves only after the HTTP body is complete;
      // local parsing therefore never competes with an open provider socket.
      enforcePlaylistByteLimit(localFile.size);
      const { channels } = await parseM3ULinesWithStats(readLocalPlaylistLines(localFile));
      const sorted = sortChannels(channels);
      if (!sorted.length) throw new Error("Playlist contained no playable channels");
      return sorted;
    } catch (error) {
      if (firstError == null) firstError = error;
      if (!isProviderTransportFailure(error)) throw error;
    } finally {
      if (localFile.exists) {
        try {
          localFile.delete();
        } catch {}
      }
    }
  }
  throw firstError || new Error("Could not download playlist");
}

async function ensureLoaded(): Promise<NativeMeta> {
  // Best-effort once per install: drop superseded JS/expo EPG files (never v3 native DB).
  void cleanupLegacyEpgArtifactsOnce();

  if (MEM && MEM.channels.length > 0) return MEM;
  const cached = await readChannelCache();
  if (cached) {
    if (cached.channels.length === 0) {
      return refreshInternal(true);
    }
    MEM = cached;
    if (cached.epgError) {
      lastSourceError = cached.epgError;
      setProgress({ phase: "error", ratio: 0, etaSeconds: null, message: cached.epgError }, true);
    }
    // Rebuild SQL playlist/match tables after upgrade or cold start (queryGuideWindow needs them).
    void syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0)
      .then(() => syncMatchesToNative(cached.channels, cached.guideEpoch || 0))
      .catch(() => undefined);
    const playlistAgeBase = cached.playlistRefreshedAt || cached.ts;
    const guideAgeBase = cached.guideRefreshedAt || cached.ts;
    if (playlistAgeBase <= 0 || Date.now() - playlistAgeBase >= SOURCE_REFRESH_INTERVAL_MS) {
      if (!cached.epgError) {
        setProgress({ phase: "update_available", ratio: 0, etaSeconds: null, message: null }, true);
      }
      void refreshInternal(false);
    } else if (guideAgeBase <= 0 || Date.now() - guideAgeBase >= epgRefreshIntervalMs) {
      void refreshEpgOnly();
    }
    return cached;
  }

  const legacy = await readMetaFile(LEGACY_CHANNEL_CACHE);
  if (legacy) {
    if (legacy.channels.length === 0) {
      return refreshInternal(true);
    }
    MEM = { ...legacy, ts: 0 };
    await persistMeta(MEM).catch(() => undefined);
    void refreshInternal(false);
    return MEM;
  }

  return refreshInternal(true);
}

async function refreshInternal(force: boolean): Promise<NativeMeta> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const cached = MEM || (await readChannelCache());
    const playlistAgeBase = cached?.playlistRefreshedAt || cached?.ts || 0;
    if (!force && cached && playlistAgeBase > 0 && Date.now() - playlistAgeBase < SOURCE_REFRESH_INTERVAL_MS) {
      MEM = cached;
      void syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0)
        .then(() => syncMatchesToNative(cached.channels, cached.guideEpoch || 0))
        .catch(() => undefined);
      return cached;
    }

    lastSourceError = null;
    let channels = cached?.channels || [];
    try {
      setProgress({ phase: "channels", ratio: 0.05, etaSeconds: null }, true);
      channels = await fetchPlaylist();
      const playlistRefreshedAt = Date.now();
      const playlistEpoch = (cached?.playlistEpoch || 0) + 1;
      const playlistFp = playlistIdentityFingerprint(channels);
      MEM = {
        ts: cached?.ts || 0,
        channels,
        epgProgramCount: cached?.epgProgramCount || 0,
        epgChannelCount: cached?.epgChannelCount || 0,
        playlistEpoch,
        playlistRefreshedAt,
        guideEpoch: cached?.guideEpoch,
        guideRefreshedAt: cached?.guideRefreshedAt,
        matchFingerprint: cached?.matchFingerprint,
        matchQuality: cached?.matchQuality,
        matchPolicy: cached?.matchPolicy,
        playlistIdentityFingerprint: playlistFp,
      };
      // Channels-first paint — EPG continues async below.
      await persistMeta(MEM);
      // Sync raw playlist rows into SQLite before match rewrites tvg_id.
      void syncPlaylistToNative(channels, playlistEpoch).catch(() => undefined);
      emit();

      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");
      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");
      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);
      const epg = await refreshConfiguredNativeEpg(true);
      if (epg.notModified && cached?.channels?.length) {
        const checkedAt = Date.now();
        MEM = {
          ...cached,
          ts: checkedAt,
          playlistEpoch,
          playlistRefreshedAt,
          playlistIdentityFingerprint: playlistFp,
          epgProgramCount: Math.max(0, Math.round(epg.count || cached.epgProgramCount || 0)),
          epgError: undefined,
        };
        await persistMeta(MEM);
        emit();
        setProgress({ phase: "ready", ratio: 1, etaSeconds: 0, message: null }, true);
        return MEM;
      }
      setProgress({ phase: "indexing", ratio: 0.91, etaSeconds: null }, true);

      const epgLogos = epg.channelLogos || {};
      const epgNames = epg.channelNames || {};
      const indexes = buildXmltvMatchIndexes({
        channelIds: new Set([
          ...Object.keys(epgLogos),
          ...Object.keys(epgNames),
          ...(epg.channelIdsWithPrograms || []),
        ]),
        channelNames: epgNames,
        idsWithPrograms: epg.channelIdsWithPrograms || [],
      });

      const policy = matchPolicyKey();
      const playlistUnchanged = cached?.playlistIdentityFingerprint === playlistFp;
      const policyUnchanged = (cached?.matchPolicy || policy) === policy;
      const epgUnchanged = !!cached?.matchFingerprint && cached.matchFingerprint === indexes.fingerprint;

      let matchedChannelsWithLogos: Channel[];
      let quality: EpgMatchQuality;
      setProgress({ phase: "matching", ratio: 0.94, etaSeconds: null }, true);

      if (playlistUnchanged && policyUnchanged && epgUnchanged && cached?.channels?.length) {
        // Same playlist identity + same EPG indexes: keep prior matches, logos only.
        // Do not run logo-only against freshly fetched raw rows (drops remapped tvg_ids).
        const logoOnly = applyLogoOnlyUpdates(
          cached.channels,
          epgLogos,
          indexes.fingerprint,
          indexes.fingerprint,
        );
        matchedChannelsWithLogos = logoOnly || cached.channels;
        quality = cached.matchQuality || emptyMatchQuality();
      } else {
        const applied = await matchChannelsWithPhases(
          channels,
          indexes,
          epgLogos,
          async (partialChannels, partialQuality) => {
            // Two-phase: paint priority/viewport matches without waiting for the full list.
            // Keep the same channel array length/order to reduce FlashList thrash.
            MEM = {
              ...MEM!,
              channels: partialChannels,
              epgChannelCount: partialQuality.matched,
              matchQuality: partialQuality,
            };
            emit();
          },
        );
        matchedChannelsWithLogos = applied.channels;
        quality = applied.quality;
      }

      const guideRefreshedAt = Date.now();
      const guideEpoch =
        typeof epg.guideEpoch === "number" && Number.isFinite(epg.guideEpoch)
          ? Math.round(epg.guideEpoch)
          : (MEM.guideEpoch || 0) + 1;

      clearProgrammeWindowCache();
      MEM = {
        ...MEM,
        ts: guideRefreshedAt,
        channels: matchedChannelsWithLogos,
        epgProgramCount: Math.max(0, Math.round(epg.count || 0)),
        epgChannelCount: quality.matched,
        epgError: undefined,
        guideEpoch,
        guideRefreshedAt,
        matchFingerprint: indexes.fingerprint,
        matchQuality: quality,
        matchPolicy: policy,
        playlistIdentityFingerprint: playlistFp,
      };
      setProgress({ phase: "caching", ratio: 0.975, etaSeconds: null }, true);
      await persistMeta(MEM);
      setProgress({ phase: "finalizing", ratio: 0.99, etaSeconds: null }, true);
      await syncMatchesToNative(matchedChannelsWithLogos, guideEpoch).catch(() => undefined);
      if (LEGACY_CHANNEL_CACHE) {
        void FileSystem.deleteAsync(LEGACY_CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
      }
      emit();
      setProgress({ phase: "ready", ratio: 1, etaSeconds: 0, message: null }, true);
      return MEM;
    } catch (error) {
      const message = formatNativeEpgError(error);
      lastSourceError = message;
      setProgress({ phase: "error", ratio: 0, etaSeconds: null, message }, true);
      if (MEM) {
        MEM = {
          ...MEM,
          channels: restoreLastGoodMatchesAfterEpgFailure(MEM.channels, cached?.channels),
          epgError: message,
        };
        await persistMeta(MEM).catch(() => undefined);
        emit();
        return MEM;
      }
      if (cached) {
        MEM = { ...cached, epgError: message };
        return MEM;
      }
      throw error instanceof Error ? error : new Error(message);
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Read only cache misses, then use a per-channel XMLTV fallback for cold-start
 * SQL-match holes. This is intentionally a small, serializable viewport query:
 * D-pad focus must never flood the bridge with the entire guide window.
 */
async function loadProgrammeCacheMisses(
  channels: Channel[],
  playlistIds: string[],
  startMs: number,
  endMs: number,
): Promise<Record<string, Program[]>> {
  const requested = Array.from(new Set(playlistIds.filter(Boolean)));
  if (!requested.length || !nativeEpgAvailable) return {};

  const requestCacheKey = programmeWindowCacheKey;
  const owned: string[] = [];
  const waits = new Set<Promise<void>>();
  for (const id of requested) {
    if (hasCachedProgrammeResult(id)) continue;
    const inFlightKey = `${requestCacheKey}|${id}`;
    const existing = programmeWindowInFlight.get(inFlightKey);
    if (existing) waits.add(existing);
    else owned.push(id);
  }

  if (owned.length) {
    const task = (async () => {
      const joined = await queryNativeGuideWindow(owned, startMs, endMs);
      const merged: Record<string, Program[]> = { ...joined };
      const missingAfterJoin = owned.filter((id) => !merged[id]?.length);

      // A native match-table write can race a cold app launch. Fall back per
      // channel rather than only when the entire viewport is empty.
      if (missingAfterJoin.length) {
        const byId = new Map(channels.map((channel) => [channel.id, channel]));
        const xmltvIds = missingAfterJoin
          .map((id) => (byId.get(id)?.tvg_id || id).trim())
          .filter(Boolean);
        if (xmltvIds.length) {
          const byXmltv = await loadNativeEpgWindow(xmltvIds, startMs, endMs);
          for (const playlistId of missingAfterJoin) {
            const xmltvId = (byId.get(playlistId)?.tvg_id || playlistId).trim();
            const list = byXmltv[xmltvId];
            if (list?.length) merged[playlistId] = list;
          }
        }
      }

      // A date/epoch change may finish while SQLite is reading. Never merge an
      // old window into the newly cleared cache.
      if (programmeWindowCacheKey === requestCacheKey) {
        mergeProgrammeQueryResult(owned, merged);
      }
    })();
    for (const id of owned) programmeWindowInFlight.set(`${requestCacheKey}|${id}`, task);
    const cleanup = () => {
      for (const id of owned) {
        const inFlightKey = `${requestCacheKey}|${id}`;
        if (programmeWindowInFlight.get(inFlightKey) === task) {
          programmeWindowInFlight.delete(inFlightKey);
        }
      }
    };
    void task.then(cleanup, cleanup);
    waits.add(task);
  }

  if (waits.size) await Promise.all(waits);
  const result: Record<string, Program[]> = {};
  if (programmeWindowCacheKey !== requestCacheKey) return result;
  for (const id of requested) {
    const list = programmeWindowCache[id];
    if (list?.length) result[id] = list;
    else if (programmeWindowEmptyKeys.has(id)) result[id] = EMPTY_PROGRAMS;
  }
  return result;
}

export async function loadGuide(
  startISO?: string,
  hours = DEFAULT_GUIDE_WINDOW_HOURS,
  force = false,
): Promise<GuideResponse> {
  const parsed = force ? await refreshInternal(true) : await ensureLoaded();
  const { winStart, winEnd, startMs, endMs, now } = resolveGuideWindowBounds(startISO, hours);

  // Apply user remaps at read time so clear-remap restores auto-matched ids from MEM.
  const remapped = withManualRemaps(parsed.channels);
  const cacheKey = `${startMs}|${endMs}|${parsed.guideEpoch || 0}`;
  if (programmeWindowCacheKey !== cacheKey) {
    clearProgrammeWindowCache();
    programmeWindowCacheKey = cacheKey;
  }

  const allPlaylistIds = remapped.map((channel) => channel.id).filter(Boolean);
  // Channel metadata remains complete, but programme objects are fetched only
  // for the current vertical runway. Before the first viewport report, seed a
  // bounded leading set so the first Guide paint is immediately useful.
  const requestedIds = viewportGuideChannelIds?.length
    ? viewportGuideChannelIds
    : allPlaylistIds.slice(0, INITIAL_GUIDE_RUNWAY_ROWS);
  const playlistIds = Array.from(new Set(requestedIds.filter(Boolean)));

  await loadProgrammeCacheMisses(remapped, playlistIds, startMs, endMs);
  trimProgrammeWindowCache(playlistIds, "soft");

  // Shared empty list — avoid allocating tens of thousands of `[]` on big playlists.
  // Never mutate EMPTY_PROGRAMS.
  const emptyPrograms: Program[] = EMPTY_PROGRAMS;
  const programsByChannelId: Record<string, Program[]> = {};
  const queriedPlaylistIds = new Set(playlistIds);
  const channels = remapped.map((channel) => {
    const list = programmeWindowCache[channel.id];
    if (list?.length) {
      programsByChannelId[channel.id] = list;
      return { ...channel, programs: list };
    }
    // Queried rows explicitly clear programmes that disappeared. Off-runway
    // channels stay empty until their page enters the sliding window.
    if (queriedPlaylistIds.has(channel.id)) programsByChannelId[channel.id] = emptyPrograms;
    return { ...channel, programs: emptyPrograms };
  });

  return {
    start: winStart.toISOString(),
    end: winEnd.toISOString(),
    now: now.toISOString(),
    channels,
    programsByChannelId,
    guideEpoch: parsed.guideEpoch || 0,
  };
}

/** Fetch one exact vertical Guide runway without rebuilding channel metadata. */
export async function loadGuideProgramsForChannelIds(
  channelIds: string[],
  startISO?: string,
  hours = DEFAULT_GUIDE_WINDOW_HOURS,
): Promise<Record<string, Program[]>> {
  if (!channelIds.length) return {};
  const unique = Array.from(new Set(channelIds.filter(Boolean)));
  if (!nativeEpgAvailable) {
    return Object.fromEntries(unique.map((id) => [id, EMPTY_PROGRAMS]));
  }
  const parsed = MEM || (await ensureLoaded().catch(() => null));
  if (!parsed?.channels?.length) {
    return Object.fromEntries(unique.map((id) => [id, EMPTY_PROGRAMS]));
  }

  const { startMs, endMs } = resolveGuideWindowBounds(startISO, hours);
  const cacheKey = `${startMs}|${endMs}|${parsed.guideEpoch || 0}`;
  if (programmeWindowCacheKey !== cacheKey) {
    clearProgrammeWindowCache();
    programmeWindowCacheKey = cacheKey;
  }

  const remapped = withManualRemaps(parsed.channels);
  await loadProgrammeCacheMisses(remapped, unique, startMs, endMs);
  if (programmeWindowCacheKey !== cacheKey) return {};

  const delta: Record<string, Program[]> = {};
  for (const id of unique) {
    const cached = programmeWindowCache[id];
    delta[id] = cached?.length ? cached : EMPTY_PROGRAMS;
  }
  trimProgrammeWindowCache([...(viewportGuideChannelIds || []), ...unique]);
  return delta;
}

export async function refreshSource(force = false): Promise<SourceStatus> {
  await refreshInternal(force);
  return sourceStatus();
}

/** Hourly scheduler entry point: fetch only XMLTV when the user's guide age is due. */
export async function refreshEpgIfDue(): Promise<boolean> {
  const cached = MEM || (await readChannelCache());
  if (!cached?.channels?.length) return false;
  const guideAgeBase = cached.guideRefreshedAt || cached.ts || 0;
  if (guideAgeBase > 0 && Date.now() - guideAgeBase < epgRefreshIntervalMs) return false;
  await refreshEpgOnly();
  return true;
}

/** Refresh XMLTV only — keep current playlist rows (independent epochs). */
export async function refreshEpgOnly(): Promise<SourceStatus> {
  // Serialize against every refresh that may have started while an earlier
  // wait was settling. The final check and assignment have no await between
  // them, so ownership cannot be overwritten by another continuation.
  while (refreshPromise) await refreshPromise;
  const initialCached = MEM || (await readChannelCache());
  while (refreshPromise) await refreshPromise;
  if (!initialCached?.channels?.length) {
    await refreshInternal(true);
    return sourceStatus();
  }
  refreshPromise = (async () => {
    const cached = MEM?.channels?.length ? MEM : initialCached;
    lastSourceError = null;
    try {
      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");
      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");
      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);
      const epg = await refreshConfiguredNativeEpg(true);
      if (epg.notModified) {
        const checkedAt = Date.now();
        MEM = {
          ...cached,
          ...MEM,
          ts: checkedAt,
          epgProgramCount: Math.max(0, Math.round(epg.count || cached.epgProgramCount || 0)),
          epgError: undefined,
          guideEpoch:
            typeof epg.guideEpoch === "number" && Number.isFinite(epg.guideEpoch)
              ? Math.round(epg.guideEpoch)
              : cached.guideEpoch,
        };
        setProgress({ phase: "finalizing", ratio: 0.99, etaSeconds: null }, true);
        await persistMeta(MEM);
        emit();
        setProgress({ phase: "ready", ratio: 1, etaSeconds: 0, message: null }, true);
        return MEM;
      }
      setProgress({ phase: "indexing", ratio: 0.91, etaSeconds: null }, true);
      const epgLogos = epg.channelLogos || {};
      const epgNames = epg.channelNames || {};
      const indexes = buildXmltvMatchIndexes({
        channelIds: new Set([
          ...Object.keys(epgLogos),
          ...Object.keys(epgNames),
          ...(epg.channelIdsWithPrograms || []),
        ]),
        channelNames: epgNames,
        idsWithPrograms: epg.channelIdsWithPrograms || [],
      });
      const policy = matchPolicyKey();
      const policyUnchanged = (cached.matchPolicy || policy) === policy;
      const epgUnchanged = !!cached.matchFingerprint && cached.matchFingerprint === indexes.fingerprint;
      let refreshedChannels: Channel[];
      let quality: EpgMatchQuality;
      setProgress({ phase: "matching", ratio: 0.94, etaSeconds: null }, true);
      if (policyUnchanged && epgUnchanged) {
        refreshedChannels =
          applyLogoOnlyUpdates(cached.channels, epgLogos, indexes.fingerprint, indexes.fingerprint) ||
          cached.channels;
        quality = cached.matchQuality || emptyMatchQuality();
      } else {
        const applied = await matchChannelsWithPhases(cached.channels, indexes, epgLogos, async (partial, partialQuality) => {
          MEM = {
            ...cached,
            ...MEM,
            channels: partial,
            epgChannelCount: partialQuality.matched,
            matchQuality: partialQuality,
          };
          emit();
        });
        refreshedChannels = applied.channels;
        quality = applied.quality;
      }
      const guideRefreshedAt = Date.now();
      const guideEpoch =
        typeof epg.guideEpoch === "number" && Number.isFinite(epg.guideEpoch)
          ? Math.round(epg.guideEpoch)
          : (cached.guideEpoch || 0) + 1;
      clearProgrammeWindowCache();
      MEM = {
        ...cached,
        ...MEM,
        ts: guideRefreshedAt,
        channels: refreshedChannels,
        epgProgramCount: Math.max(0, Math.round(epg.count || 0)),
        epgChannelCount: quality.matched,
        epgError: undefined,
        guideEpoch,
        guideRefreshedAt,
        matchFingerprint: indexes.fingerprint,
        matchQuality: quality,
        matchPolicy: policy,
      };
      setProgress({ phase: "caching", ratio: 0.975, etaSeconds: null }, true);
      await persistMeta(MEM);
      setProgress({ phase: "finalizing", ratio: 0.99, etaSeconds: null }, true);
      await syncMatchesToNative(refreshedChannels, guideEpoch).catch(() => undefined);
      emit();
      setProgress({ phase: "ready", ratio: 1, etaSeconds: 0, message: null }, true);
      return MEM;
    } catch (error) {
      const message = formatNativeEpgError(error);
      lastSourceError = message;
      setProgress({ phase: "error", ratio: 0, etaSeconds: null, message }, true);
      if (MEM) {
        MEM = { ...MEM, epgError: message };
        await persistMeta(MEM).catch(() => undefined);
        emit();
        return MEM;
      }
      throw error instanceof Error ? error : new Error(message);
    }
  })();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
  return sourceStatus();
}

export function sourceStatus(): SourceStatus {
  const channels = MEM?.channels || [];
  return {
    m3u_url: SOURCE_M3U ? "configured" : "not configured",
    epg_url: SOURCE_EPG ? "configured" : "not configured",
    channel_count: channels.length,
    channels_with_epg: MEM?.epgChannelCount || 0,
    last_refresh: MEM && MEM.ts > 0 ? new Date(MEM.ts).toISOString() : null,
    refreshing: !!refreshPromise,
    error: MEM?.epgError || lastSourceError,
  };
}

export type SourceDiagnostics = {
  mode: "cloudflare" | "direct" | "unconfigured";
  cacheBytes: number;
  cacheAgeMinutes: number | null;
  channels: number;
  programs: number;
  refreshInFlight: boolean;
  epgError: string | null;
  nextAutoRefresh: string | null;
  matchQuality: EpgMatchQuality | null;
  playlistRefreshedAt: string | null;
  guideRefreshedAt: string | null;
  playlistEpoch: number | null;
  guideEpoch: number | null;
};

export async function sourceDiagnostics(): Promise<SourceDiagnostics> {
  let cacheBytes = 0;
  if (CHANNEL_CACHE) {
    try {
      const info = await FileSystem.getInfoAsync(CHANNEL_CACHE);
      if (info.exists && typeof info.size === "number") cacheBytes += info.size;
    } catch {}
  }
  return {
    mode: SOURCE_M3U ? "direct" : "unconfigured",
    cacheBytes,
    cacheAgeMinutes: MEM && MEM.ts > 0 ? Math.max(0, Math.round((Date.now() - MEM.ts) / 60000)) : null,
    channels: MEM?.channels.length || 0,
    programs: MEM?.epgProgramCount || 0,
    refreshInFlight: !!refreshPromise,
    epgError: MEM?.epgError || lastSourceError,
    nextAutoRefresh: MEM && MEM.ts > 0 ? new Date(MEM.ts + epgRefreshIntervalMs).toISOString() : null,
    matchQuality: MEM?.matchQuality || null,
    playlistRefreshedAt:
      MEM?.playlistRefreshedAt && MEM.playlistRefreshedAt > 0
        ? new Date(MEM.playlistRefreshedAt).toISOString()
        : null,
    guideRefreshedAt:
      MEM?.guideRefreshedAt && MEM.guideRefreshedAt > 0
        ? new Date(MEM.guideRefreshedAt).toISOString()
        : null,
    playlistEpoch: MEM?.playlistEpoch ?? null,
    guideEpoch: MEM?.guideEpoch ?? null,
  };
}

/**
 * Safe guide maintenance — clears native EPG + channel meta cache only.
 * Never touches favorites / recents / reminders.
 */
export async function clearGuideCache(): Promise<void> {
  MEM = null;
  lastNativeMatchWriteFingerprint = "";
  lastSourceError = null;
  clearProgrammeWindowCache();
  clearGuidePrograms();
  viewportGuideChannelIds = null;
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  await clearNativeEpg();
  if (CHANNEL_CACHE) await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  if (CHANNEL_CACHE_TMP) await FileSystem.deleteAsync(CHANNEL_CACHE_TMP, { idempotent: true }).catch(() => undefined);
  if (CHANNEL_CACHE_BAK) await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);
  if (LEGACY_CHANNEL_CACHE) await FileSystem.deleteAsync(LEGACY_CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  void cleanupLegacyEpgArtifactsOnce();
  setProgress({ phase: "idle", ratio: 0, etaSeconds: null, message: null }, true);
  emit();
}

/** Release only disposable Guide programme objects; SQLite and channel metadata survive. */
export function releaseGuideProgrammeMemory(): void {
  clearProgrammeWindowCache();
  clearGuidePrograms();
}
