import dayjs from "dayjs";
import * as FileSystem from "expo-file-system/legacy";
import type { Channel, GuideResponse, Program, SourceStatus } from "@/src/api";
import {
  enforcePlaylistByteLimit,
  enforcePlaylistTextLimit,
  parseM3UWithStats,
} from "@/src/core/sourceParsing";
import {
  clearNativeEpg,
  loadNativeEpgWindow,
  nativeEpgAvailable,
  refreshNativeEpg,
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

export const API_BASE = "";
/** Playlist URL — set via EXPO_PUBLIC_M3U_URL at build time. Never hardcode provider URLs. */
export const SOURCE_M3U = (process.env.EXPO_PUBLIC_M3U_URL || "").trim();
/** XMLTV URL — set via EXPO_PUBLIC_EPG_URL at build time. Never hardcode provider URLs. */
export const SOURCE_EPG = (process.env.EXPO_PUBLIC_EPG_URL || "").trim();

/** Shared empty programmes array — reused for channels with no EPG in-window. Never mutate. */
const EMPTY_PROGRAMS: Program[] = [];

const TTL_MS = 24 * 60 * 60 * 1000;
const PROGRESS_THROTTLE_MS = 150;
/** Above this, match current-group / priority ids first, then the rest (keeps channels-first paint snappy). */
const HUGE_PLAYLIST_MATCH_THRESHOLD = 400;
/** Cap merged programme rows held in JS — weak Fire TVs thrash if this grows with the full playlist. */
const MAX_PROGRAMME_WINDOW_KEYS = 700;
const CACHE_ROOT = FileSystem.documentDirectory || "";
const CHANNEL_CACHE = CACHE_ROOT ? `${CACHE_ROOT}charm_native_channels_v2.json` : "";
const LEGACY_CHANNEL_CACHE = CACHE_ROOT ? `${CACHE_ROOT}charm_native_channels_v1.json` : "";
const CHANNEL_CACHE_TMP = CHANNEL_CACHE ? `${CHANNEL_CACHE}.tmp` : "";

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
let programmeWindowCacheKey = "";

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
}

export function setViewportGuideChannelIds(ids: string[] | null): void {
  viewportGuideChannelIds = ids && ids.length ? ids.filter(Boolean) : null;
}

function clearProgrammeWindowCache(): void {
  programmeWindowCache = {};
  programmeWindowCacheKey = "";
}

/** Drop off-viewport programme rows so JS heap stays bounded on huge playlists. */
function trimProgrammeWindowCache(keepKeys: Iterable<string>): void {
  const keep = new Set(keepKeys);
  let keys = Object.keys(programmeWindowCache);
  if (keys.length <= MAX_PROGRAMME_WINDOW_KEYS) return;
  for (const key of keys) {
    if (keep.has(key)) continue;
    delete programmeWindowCache[key];
  }
  keys = Object.keys(programmeWindowCache);
  if (keys.length <= MAX_PROGRAMME_WINDOW_KEYS) return;
  const overflow = keys.length - MAX_PROGRAMME_WINDOW_KEYS;
  let dropped = 0;
  for (const key of keys) {
    if (keep.has(key)) continue;
    delete programmeWindowCache[key];
    dropped += 1;
    if (dropped >= overflow) break;
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

export type LoadPhase = "idle" | "channels" | "downloading" | "decompressing" | "parsing" | "indexing" | "caching" | "ready" | "error";
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

function https(url: string): string {
  return url && url.startsWith("http://") ? `https://${url.slice(7)}` : url;
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
  return readMetaFile(CHANNEL_CACHE);
}

async function persistMeta(meta: NativeMeta): Promise<void> {
  if (!CHANNEL_CACHE || !CHANNEL_CACHE_TMP) return;
  const json = JSON.stringify(meta);
  await FileSystem.writeAsStringAsync(CHANNEL_CACHE_TMP, json);
  await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  await FileSystem.moveAsync({ from: CHANNEL_CACHE_TMP, to: CHANNEL_CACHE });
}

async function fetchPlaylist(): Promise<Channel[]> {
  if (!SOURCE_M3U) {
    throw new Error("Playlist is not configured for this build (missing EXPO_PUBLIC_M3U_URL).");
  }
  const response = await fetch(https(SOURCE_M3U), {
    headers: { "User-Agent": "CharmIPTV/Experimental-v3" },
  });
  if (!response.ok) throw new Error(`M3U HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || "");
  if (Number.isFinite(contentLength) && contentLength > 0) {
    enforcePlaylistByteLimit(contentLength);
  }
  const text = await response.text();
  enforcePlaylistTextLimit(text);
  const { channels } = parseM3UWithStats(text, (url) => url, (ratio) => {
    setProgress({ phase: "channels", ratio: 0.05 + ratio * 0.12, etaSeconds: null });
  });
  const sorted = sortChannels(channels);
  // Empty / unusable refresh must not wipe a last-good on-disk list (refreshInternal catch).
  if (!sorted.length) throw new Error("Playlist contained no playable channels");
  return sorted;
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
    if (cached.ts <= 0) void refreshInternal(false);
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
    if (!force && cached && cached.ts > 0 && Date.now() - cached.ts < TTL_MS) {
      MEM = cached;
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
      emit();

      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");
      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");
      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);
      const epg = await refreshNativeEpg(https(SOURCE_EPG));
      setProgress({ phase: "caching", ratio: 0.9, etaSeconds: null }, true);

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
      await persistMeta(MEM);
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
        MEM = { ...MEM, epgError: message };
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

export async function loadGuide(startISO?: string, hours = 8, force = false): Promise<GuideResponse> {
  const parsed = force ? await refreshInternal(true) : await ensureLoaded();
  const now = dayjs();
  const winStart = startISO ? dayjs(startISO) : now.subtract(1, "hour");
  const winEnd = winStart.add(hours, "hour");
  const startMs = winStart.valueOf();
  const endMs = winEnd.valueOf();

  // Apply user remaps at read time so clear-remap restores auto-matched ids from MEM.
  const remapped = withManualRemaps(parsed.channels);
  const cacheKey = `${startMs}|${endMs}|${parsed.guideEpoch || 0}`;
  if (programmeWindowCacheKey !== cacheKey) {
    clearProgrammeWindowCache();
    programmeWindowCacheKey = cacheKey;
  }

  const byChannelId = new Map(remapped.map((channel) => [channel.id, channel]));
  const allGuideIds = remapped.map((channel) => channel.tvg_id || channel.id).filter(Boolean);
  let guideIds = allGuideIds;

  // Huge lists: query viewport (+ priority group) first for felt speed, then merge into cache
  // so off-screen rows keep previously fetched programmes instead of being wiped.
  // Also scope the first paint when a viewport has already been reported (any list size).
  const huge = remapped.length >= HUGE_PLAYLIST_MATCH_THRESHOLD;
  if ((huge || viewportGuideChannelIds?.length) && viewportGuideChannelIds?.length) {
    const want = new Set<string>([
      ...viewportGuideChannelIds,
      ...priorityMatchChannelIds.slice(0, 400),
    ]);
    const scoped: string[] = [];
    for (const id of want) {
      const channel = byChannelId.get(id);
      const key = channel ? channel.tvg_id || channel.id : id;
      if (key) scoped.push(key);
    }
    if (scoped.length) guideIds = scoped;
  }
  guideIds = Array.from(new Set(guideIds));

  const programmes = nativeEpgAvailable
    ? await loadNativeEpgWindow(guideIds, startMs, endMs)
    : {};

  for (const [key, list] of Object.entries(programmes)) {
    if (list?.length) programmeWindowCache[key] = list;
  }
  trimProgrammeWindowCache(guideIds);

  // After a scoped paint, warm a ring around the viewport in the background.
  // Never warm the entire playlist in one shot, and never emit() (that rebuilds
  // every React channel + TimelineGrid row — the main hitch on weak sticks).
  if (huge && nativeEpgAvailable && guideIds.length < allGuideIds.length) {
    const warmKey = cacheKey;
    const have = new Set(guideIds);
    const ring: string[] = [];
    for (const id of allGuideIds) {
      if (have.has(id)) continue;
      ring.push(id);
      if (ring.length >= 180) break;
    }
    if (ring.length) {
      void loadNativeEpgWindow(ring, startMs, endMs)
        .then((partial) => {
          if (programmeWindowCacheKey !== warmKey) return;
          for (const [key, list] of Object.entries(partial)) {
            if (!list?.length) continue;
            programmeWindowCache[key] = list;
          }
          trimProgrammeWindowCache([...guideIds, ...ring]);
          // Intentionally no emit() — next focus/viewport refresh attaches rows.
        })
        .catch(() => undefined);
    }
  }

  // Shared empty list — avoid allocating tens of thousands of `[]` on big playlists.
  // Never mutate EMPTY_PROGRAMS.
  const emptyPrograms: Program[] = EMPTY_PROGRAMS;

  const channels = remapped.map((channel) => {
    const key = channel.tvg_id || channel.id;
    const list = programmeWindowCache[key];
    if (!list?.length) return { ...channel, programs: emptyPrograms };
    return { ...channel, programs: list };
  });

  // epgChannelCount stays match-quality matched count (not in-window hits).

  return {
    start: winStart.toISOString(),
    end: winEnd.toISOString(),
    now: now.toISOString(),
    channels,
  };
}

export async function refreshSource(force = false): Promise<SourceStatus> {
  await refreshInternal(force);
  return sourceStatus();
}

/** Refresh XMLTV only — keep current playlist rows (independent epochs). */
export async function refreshEpgOnly(): Promise<SourceStatus> {
  // Wait for any in-flight refresh, then always rematch with the current policy.
  if (refreshPromise) await refreshPromise;
  refreshPromise = (async () => {
    const cached = MEM || (await readChannelCache());
    if (!cached?.channels?.length) {
      return refreshInternal(true);
    }
    lastSourceError = null;
    try {
      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");
      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");
      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);
      const epg = await refreshNativeEpg(https(SOURCE_EPG));
      setProgress({ phase: "caching", ratio: 0.9, etaSeconds: null }, true);
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
      const applied = await matchChannelsWithPhases(cached.channels, indexes, epgLogos, async (partial, quality) => {
        MEM = {
          ...cached,
          ...MEM,
          channels: partial,
          epgChannelCount: quality.matched,
          matchQuality: quality,
        };
        emit();
      });
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
        channels: applied.channels,
        epgProgramCount: Math.max(0, Math.round(epg.count || 0)),
        epgChannelCount: applied.quality.matched,
        epgError: undefined,
        guideEpoch,
        guideRefreshedAt,
        matchFingerprint: indexes.fingerprint,
        matchQuality: applied.quality,
        matchPolicy: matchPolicyKey(),
      };
      await persistMeta(MEM);
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
    nextAutoRefresh: MEM && MEM.ts > 0 ? new Date(MEM.ts + TTL_MS).toISOString() : null,
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
  lastSourceError = null;
  clearProgrammeWindowCache();
  viewportGuideChannelIds = null;
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  await clearNativeEpg();
  if (CHANNEL_CACHE) await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  if (CHANNEL_CACHE_TMP) await FileSystem.deleteAsync(CHANNEL_CACHE_TMP, { idempotent: true }).catch(() => undefined);
  if (LEGACY_CHANNEL_CACHE) await FileSystem.deleteAsync(LEGACY_CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  void cleanupLegacyEpgArtifactsOnce();
  setProgress({ phase: "idle", ratio: 0, etaSeconds: null, message: null }, true);
  emit();
}
