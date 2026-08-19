import dayjs from "dayjs";
import * as FileSystem from "expo-file-system/legacy";
import type { Channel, GuideResponse, Program, SourceStatus } from "@/src/api";
import { clearGuidePrograms } from "@/src/core/guideProgramsStore";
import {
  clearNativeEpg,
  fetchNativePlaylist,
  readNativeStoredPlaylist,
  loadNativeEpgWindow,
  nativeEpgAvailable,
  nativePlaylistIsCurrent,
  touchNativePlaylistRefresh,
  queryNativeGuideWindow,
  refreshNativeEpg,
  refreshNativeUserGuide,
  configureNativeEpgSource,
  configureNativeGuideOwnership,
  upsertNativePlaylistChannels,
  upsertNativePlaylistEpgMatches,
} from "@/src/nativeEpg";
import {
  applyLogoOnlyUpdates,
  applyXmltvMatchesToChannels,
  buildXmltvMatchIndexes,
  emptyMatchQuality,
  formatNativeEpgError,
  mergeMatchQuality,
  type EpgMatchQuality,
} from "@/src/core/epgMatching";
import { applyManualEpgRemaps, type EpgManualRemap } from "@/src/core/epgUserOverrides";
import { cleanupLegacyEpgArtifactsOnce } from "@/src/utils/legacyEpgCleanup";
import {
  getSourceRefreshPreferences,
  isRefreshDue,
  nextRefreshAt,
} from "@/src/core/sourceRefreshPreferences";
import { getLogoPriority, type LogoPriority } from "@/src/core/logoPreferences";
import { getEpgSourcePreferences, type EpgSourcePreferences } from "@/src/core/epgSourcePreferences";

export const API_BASE = "";
/** Playlist URL — set via EXPO_PUBLIC_M3U_URL at build time. Never hardcode provider URLs. */
export const SOURCE_M3U = (process.env.EXPO_PUBLIC_M3U_URL || "").trim();
/** XMLTV URL — set via EXPO_PUBLIC_EPG_URL at build time. Never hardcode provider URLs. */
export const SOURCE_EPG = (process.env.EXPO_PUBLIC_EPG_URL || "").trim();

/** Shared empty programmes array — reused for channels with no EPG in-window. Never mutate. */
const EMPTY_PROGRAMS: Program[] = [];

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
let playlistOnlyRefreshPromise: Promise<SourceStatus> | null = null;
let lastSourceError: string | null = null;
let startupRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const STARTUP_SOURCE_REFRESH_DELAY_MS = 30_000;

function scheduleStartupSourceRefresh(): void {
  if (startupRefreshTimer) return;
  startupRefreshTimer = setTimeout(() => {
    startupRefreshTimer = null;
    void refreshSourcesIfDue().catch(() => undefined);
  }, STARTUP_SOURCE_REFRESH_DELAY_MS);
}
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
/** True only when this process successfully parsed or promoted the primary channel cache. */
let channelCacheKnownGood = false;

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
    channels.map((channel, position) => ({
      playlistId: channel.id,
      rawTvgId: channel.raw_tvg_id || channel.tvg_id || "",
      name: channel.name || "",
      logo: channel.playlist_logo || channel.logo || "",
      group: channel.group || "",
      url: channel.url || "",
      streamType: channel.stream_type || "unknown",
      position,
    })),
    playlistEpoch,
    contentFingerprint,
  );
}

function activeEpgBindings(
  channels: Channel[],
  excludedPlaylistIds: ReadonlySet<string> = new Set(),
): { ids: string[]; names: string[] } {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const channel of channels) {
    if (excludedPlaylistIds.has(channel.id)) continue;
    const id = (channel.raw_tvg_id || channel.tvg_id || "").trim();
    const name = (channel.name || "").trim();
    if (id) ids.add(id);
    if (name) names.add(name);
  }
  return { ids: Array.from(ids), names: Array.from(names) };
}

async function applyPersistedGuideOwnership(): Promise<EpgSourcePreferences> {
  const prefs = await getEpgSourcePreferences();
  await configureNativeGuideOwnership(
    prefs.primaryEnabled,
    prefs.userEnabled,
    prefs.userUrl,
    prefs.userOverrides,
  );
  return prefs;
}

function applyNativeImportProgress(phase: string, ratio: number): void {
  const safePhase: LoadPhase =
    phase === "decompressing" || phase === "parsing" || phase === "indexing"
      ? phase
      : "downloading";
  setProgress({ phase: safePhase, ratio: Math.max(0.2, Math.min(0.9, ratio)), etaSeconds: null });
}

function hashFields(value: string, state: { h1: number; h2: number; chars: number }): void {
  state.chars += value.length;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    state.h1 = Math.imul(state.h1 ^ code, 0x01000193);
    state.h2 = Math.imul(state.h2 ^ (code + index), 0x85ebca6b);
  }
}

/** Two independent 32-bit hashes keep the cold-start native handshake compact. */
function playlistNativeContentFingerprint(channels: Channel[]): string {
  const state = { h1: 0x811c9dc5, h2: 0x9e3779b9, chars: 0 };
  for (let position = 0; position < channels.length; position += 1) {
    const channel = channels[position];
    // This fingerprint protects the native provider catalog, not user identity.
    // Include every provider-owned playback field so rotating Xtream/M3U stream
    // URLs, stream-type changes, and provider reorderings cannot leave SQLite
    // serving stale rows on the next cold start. Stable favorites/customization
    // remain keyed by channel.id in their separate stores.
    hashFields(
      `${channel.id}\0${channel.raw_tvg_id || channel.tvg_id || ""}\0${channel.name || ""}\0${channel.playlist_logo || channel.logo || ""}\0${channel.group || ""}\0${channel.url || ""}\0${channel.stream_type || "unknown"}\0${position}\x01`,
      state,
    );
  }
  return `playlist-v2:${channels.length}:${state.chars}:${(state.h1 >>> 0).toString(16)}:${(state.h2 >>> 0).toString(16)}`;
}

async function syncMatchesToNative(channels: Channel[], guideEpoch: number): Promise<void> {
  if (!nativeEpgAvailable || !channels.length) return;
  const remapped = withManualRemaps(channels);
  const policy = matchPolicyKey();
  const rows: {
    playlistId: string;
    xmltvId: string;
    logoXmltvId: string;
    ambiguous: boolean;
    matchPolicy: string;
    manual: boolean;
  }[] = [];
  const fingerprintState = { h1: 0x811c9dc5, h2: 0x9e3779b9, chars: 0 };
  for (const channel of remapped) {
    const manual = Object.prototype.hasOwnProperty.call(manualEpgRemaps, channel.id);
    const xmltvId = (channel.tvg_id || "").trim();
    rows.push({
      playlistId: channel.id,
      xmltvId,
      logoXmltvId: xmltvId,
      ambiguous: false,
      matchPolicy: policy,
      manual,
    });
    hashFields(`${channel.id}\u0001${xmltvId}\u0001${policy}\u0001${manual ? 1 : 0}\u0002`, fingerprintState);
  }
  const writeFingerprint = `matches-v2:${rows.length}:${fingerprintState.chars}:${(fingerprintState.h1 >>> 0).toString(16)}:${(fingerprintState.h2 >>> 0).toString(16)}`;
  if (writeFingerprint === lastNativeMatchWriteFingerprint) return;
  await upsertNativePlaylistEpgMatches(rows, guideEpoch);
  lastNativeMatchWriteFingerprint = writeFingerprint;
}

function resolveGuideWindowBounds(startISO?: string, hours = 6): {
  winStart: dayjs.Dayjs;
  winEnd: dayjs.Dayjs;
  startMs: number;
  endMs: number;
  now: dayjs.Dayjs;
} {
  const now = dayjs();
  // A live guide must keep one stable time window while focus moves. Including
  // the current millisecond in the cache key cleared every programme row on
  // every D-pad patch. Minute alignment is only a cold-start fallback; Store
  // subsequently passes the exact rendered window start back to us.
  const winStart = startISO ? dayjs(startISO) : now.startOf("minute").subtract(1, "hour");
  const winEnd = winStart.add(hours, "hour");
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

function buildXmltvChannelIdSet(
  logos: Record<string, string>,
  names: Record<string, string>,
  programIds: Iterable<string>,
): Set<string> {
  const ids = new Set<string>();
  for (const id in logos) if (id) ids.add(id);
  for (const id in names) if (id) ids.add(id);
  for (const id of programIds) if (id) ids.add(id);
  return ids;
}

function playlistIdentityFingerprint(channels: Channel[]): string {
  // Logo URLs intentionally excluded — logo-only EPG drift must not force rematch.
  const state = { h1: 0x811c9dc5, h2: 0x9e3779b9, chars: 0 };
  for (const channel of channels) {
    hashFields(`${channel.id}\0${(channel.raw_tvg_id || channel.tvg_id || "").trim()}\0${(channel.name || "").trim()}\x01`, state);
  }
  return `identity-v2:${channels.length}:${state.chars}:${(state.h1 >>> 0).toString(16)}:${(state.h2 >>> 0).toString(16)}`;
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
  logoPriority: LogoPriority,
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
      logoPriority,
      onlyChannelIds: priority,
    });
    await onPartial(phase1.channels, phase1.quality);
    await nextTick();
    const prioritySet = new Set(priority);
    const restIds: string[] = [];
    for (const channel of channels) if (!prioritySet.has(channel.id)) restIds.push(channel.id);
    const phase2 = applyXmltvMatchesToChannels(phase1.channels, indexes, epgLogos, {
      preferTvgIdOnly,
      logoPriority,
      onlyChannelIds: restIds,
    });
    return {
      channels: phase2.channels,
      quality: mergeMatchQuality(phase1.quality, phase2.quality),
    };
  }

  const applied = applyXmltvMatchesToChannels(channels, indexes, epgLogos, {
    preferTvgIdOnly,
    logoPriority,
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

function sourceUrl(url: string): string {
  // Preserve provider protocol exactly. Sideload builds intentionally allow
  // cleartext HTTP for Xtream-style servers (often :25461); forcing HTTPS here
  // makes otherwise valid M3U/XMLTV endpoints unreachable.
  return (url || "").trim();
}

function sortChannelsInPlace(channels: Channel[]): Channel[] {
  channels.sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }),
  );
  return channels;
}

async function readMetaFile(path: string): Promise<NativeMeta | null> {
  if (!path) return null;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path)) as NativeMeta;
    if (!Array.isArray(parsed.channels) || !parsed.channels.length || !Number.isFinite(parsed.ts)) return null;
    // Normalize in place. The old path cloned every channel, then cloned the
    // entire array again to sort it — a large transient heap spike at 6k+ rows.
    for (const channel of parsed.channels) {
      channel.playlist_logo = channel.playlist_logo || (!channel.epg_logo ? channel.logo : "") || "";
    }
    sortChannelsInPlace(parsed.channels);
    return {
      ts: parsed.ts,
      channels: parsed.channels,
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

async function readNativeChannelCache(): Promise<NativeMeta | null> {
  if (!nativeEpgAvailable) return null;
  try {
    const stored = await readNativeStoredPlaylist();
    if (!stored?.channels?.length) return null;
    const logoPriority = await getLogoPriority();
    for (const channel of stored.channels) {
      const playlistLogo = channel.playlist_logo || channel.logo || "";
      const epgLogo = channel.epg_logo || "";
      channel.playlist_logo = playlistLogo;
      channel.logo = logoPriority === "epg" ? (epgLogo || playlistLogo) : (playlistLogo || epgLogo);
    }
    sortChannelsInPlace(stored.channels);
    const guideRefreshedAt = stored.guideRefreshedAt || 0;
    const playlistRefreshedAt = stored.playlistRefreshedAt || 0;
    return {
      ts: guideRefreshedAt || playlistRefreshedAt,
      channels: stored.channels,
      epgProgramCount: stored.epgProgramCount || 0,
      epgChannelCount: 0,
      playlistEpoch: stored.playlistEpoch || 0,
      guideEpoch: stored.guideEpoch || 0,
      playlistRefreshedAt,
      guideRefreshedAt,
      playlistIdentityFingerprint: playlistIdentityFingerprint(stored.channels),
    };
  } catch {
    return null;
  }
}

async function readChannelCache(): Promise<NativeMeta | null> {
  const primary = await readMetaFile(CHANNEL_CACHE);
  if (primary) {
    channelCacheKnownGood = true;
    return primary;
  }
  channelCacheKnownGood = false;
  const backup = await readMetaFile(CHANNEL_CACHE_BAK);
  return backup || null;
}

async function persistMeta(meta: NativeMeta): Promise<void> {
  if (!CHANNEL_CACHE || !CHANNEL_CACHE_TMP || !CHANNEL_CACHE_BAK) return;
  const json = JSON.stringify(meta);
  await FileSystem.writeAsStringAsync(CHANNEL_CACHE_TMP, json);
  const tmpInfo = await FileSystem.getInfoAsync(CHANNEL_CACHE_TMP).catch(() => null);
  if (!tmpInfo?.exists || !(typeof tmpInfo.size === "number") || tmpInfo.size < 2) {
    await FileSystem.deleteAsync(CHANNEL_CACHE_TMP, { idempotent: true }).catch(() => undefined);
    throw new Error("Channel cache verification failed");
  }

  // Do not parse the previous 6k+ channel JSON while the new metadata graph and
  // serialized JSON are both live. `channelCacheKnownGood` is set only by a
  // successful primary parse/promotion; an existing backup remains untouched when
  // the primary was not proven good in this process.
  const currentInfo = await FileSystem.getInfoAsync(CHANNEL_CACHE).catch(() => null);
  if (channelCacheKnownGood && currentInfo?.exists) {
    await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: CHANNEL_CACHE, to: CHANNEL_CACHE_BAK });
  } else {
    await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  }
  try {
    await FileSystem.moveAsync({ from: CHANNEL_CACHE_TMP, to: CHANNEL_CACHE });
    const promoted = await FileSystem.getInfoAsync(CHANNEL_CACHE).catch(() => null);
    if (!promoted?.exists || !(typeof promoted.size === "number") || promoted.size < 2) {
      throw new Error("Promoted channel cache is invalid");
    }
    await FileSystem.deleteAsync(CHANNEL_CACHE_BAK, { idempotent: true }).catch(() => undefined);
    channelCacheKnownGood = true;
  } catch (error) {
    channelCacheKnownGood = false;
    await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
    const backup = await FileSystem.getInfoAsync(CHANNEL_CACHE_BAK).catch(() => null);
    if (backup?.exists) {
      const restored = await FileSystem.moveAsync({ from: CHANNEL_CACHE_BAK, to: CHANNEL_CACHE })
        .then(() => true)
        .catch(() => false);
      channelCacheKnownGood = restored;
    }
    throw error;
  }
}

async function fetchPlaylist(): Promise<Channel[]> {
  if (!SOURCE_M3U) {
    throw new Error("Playlist is not configured for this build (missing EXPO_PUBLIC_M3U_URL).");
  }
  setProgress({ phase: "channels", ratio: 0.06, etaSeconds: null });
  const parsed = await fetchNativePlaylist(sourceUrl(SOURCE_M3U));
  setProgress({ phase: "channels", ratio: 0.17, etaSeconds: null });
  const channels = Array.isArray(parsed.channels) ? parsed.channels : [];
  sortChannelsInPlace(channels);
  if (!channels.length) throw new Error("Playlist contained no playable channels");
  return channels;
}

async function ensureLoaded(): Promise<NativeMeta> {
  // Best-effort once per install: drop superseded JS/expo EPG files (never v3 native DB).
  void cleanupLegacyEpgArtifactsOnce();

  if (MEM && MEM.channels.length > 0) return MEM;
  const nativeCached = await readNativeChannelCache();
  const cached = nativeCached || (await readChannelCache());
  if (cached) {
    if (cached.channels.length === 0) {
      return refreshInternal(true);
    }
    MEM = cached;
    void applyPersistedGuideOwnership().catch(() => undefined);
    if (cached.epgError) {
      lastSourceError = cached.epgError;
      setProgress({ phase: "error", ratio: 0, etaSeconds: null, message: cached.epgError }, true);
    }
    // A native snapshot came from these exact SQL tables; keep cold start read-only.
    // JSON fallback/legacy caches still rebuild native indexes after upgrade.
    if (!nativeCached) {
      void syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0)
        .then(() => syncMatchesToNative(cached.channels, cached.guideEpoch || 0))
        .catch(() => undefined);
    }
    scheduleStartupSourceRefresh();
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
    if (!force && cached?.channels?.length) {
      const refreshPrefs = await getSourceRefreshPreferences();
      const playlistLast = cached.playlistRefreshedAt != null ? cached.playlistRefreshedAt : cached.ts;
      if (!isRefreshDue(playlistLast, refreshPrefs.playlistHours)) {
        MEM = cached;
        void syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0)
          .then(() => syncMatchesToNative(cached.channels, cached.guideEpoch || 0))
          .catch(() => undefined);
        return cached;
      }
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
      await syncPlaylistToNative(channels, playlistEpoch);
      await touchNativePlaylistRefresh(playlistEpoch);
      emit();

      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");
      const ownership = await applyPersistedGuideOwnership();
      const userOverrideIds = ownership.userEnabled
        ? new Set(Object.keys(ownership.userOverrides))
        : new Set<string>();
      const refreshPreferences = await getSourceRefreshPreferences();
      // The custom source manager performs a deliberate full XMLTV index when
      // the user presses Refresh Custom EPG. Background/scheduled refreshes only
      // need to spend network/CPU/disk when at least one playlist channel is
      // actually owned by the custom source.
      if (ownership.userEnabled && ownership.userUrl && userOverrideIds.size > 0) {
        await refreshNativeUserGuide(ownership.userUrl);
      }
      if (!ownership.primaryEnabled) {
        // Built-in EPG is truly off: no download, parse, match, or background
        // refresh. Re-read effective ownership so user-bound channels use the
        // custom DB's last successful swap clock (or zero when none exists).
        const checkedAt = Date.now();
        const effectiveGuide = await readNativeStoredPlaylist();
        clearProgrammeWindowCache();
        MEM = {
          ...MEM,
          ts: checkedAt,
          epgError: undefined,
          epgProgramCount: effectiveGuide?.epgProgramCount ?? MEM.epgProgramCount,
          guideEpoch: effectiveGuide?.guideEpoch ?? MEM.guideEpoch,
          guideRefreshedAt: effectiveGuide?.guideRefreshedAt ?? MEM.guideRefreshedAt,
        };
        await persistMeta(MEM);
        emit();
        setProgress({ phase: "ready", ratio: 1, etaSeconds: 0, message: null }, true);
        return MEM;
      }
      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");
      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);
      const activeBindings = activeEpgBindings(channels, userOverrideIds);
      await configureNativeEpgSource(sourceUrl(SOURCE_EPG), refreshPreferences.epgHours);
      const epg = await refreshNativeEpg(
        sourceUrl(SOURCE_EPG),
        false,
        activeBindings.ids,
        activeBindings.names,
        applyNativeImportProgress,
      );
      setProgress({ phase: "indexing", ratio: 0.91, etaSeconds: null }, true);

      const epgLogos = epg.channelLogos || {};
      const epgNames = epg.channelNames || {};
      const logoPriority = await getLogoPriority();
      const indexes = buildXmltvMatchIndexes({
        channelIds: buildXmltvChannelIdSet(
          epgLogos,
          epgNames,
          epg.channelIdsWithPrograms || [],
        ),
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

      if (logoPriority === "playlist" && playlistUnchanged && policyUnchanged && epgUnchanged && cached?.channels?.length) {
        // Same playlist identity + same EPG indexes: keep prior matches, logos only.
        // Do not run logo-only against freshly fetched raw rows (drops remapped tvg_ids).
        const logoOnly = applyLogoOnlyUpdates(
          cached.channels,
          epgLogos,
          indexes.fingerprint,
          indexes.fingerprint,
          logoPriority,
        );
        matchedChannelsWithLogos = logoOnly || cached.channels;
        quality = cached.matchQuality || emptyMatchQuality();
      } else {
        const applied = await matchChannelsWithPhases(
          channels,
          indexes,
          epgLogos,
          logoPriority,
          async (partialChannels, partialQuality) => {
            // Two-phase: paint priority/viewport matches without waiting for the full list.
            // Keep the same channel array length/order to avoid Guide data churn.
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

      // A native match-table write can race a cold app launch. The direct-primary
      // fallback is allowed only for channels still owned by the primary guide.
      // Never let stale built-in rows bleed into a user override or into primary-off
      // mode just because the ownership-aware join correctly returned no row.
      if (missingAfterJoin.length) {
        const ownership = await getEpgSourcePreferences();
        const userOwned = ownership.userEnabled
          ? ownership.userOverrides
          : {};
        const primaryFallbackIds = ownership.primaryEnabled
          ? missingAfterJoin.filter((id) => !Object.prototype.hasOwnProperty.call(userOwned, id))
          : [];

        if (primaryFallbackIds.length) {
          const wanted = new Set(primaryFallbackIds);
          const byId = new Map<string, Channel>();
          for (const channel of channels) {
            if (!wanted.has(channel.id)) continue;
            byId.set(channel.id, channel);
            if (byId.size >= wanted.size) break;
          }
          const xmltvIds: string[] = [];
          for (const id of primaryFallbackIds) {
            const xmltvId = (byId.get(id)?.tvg_id || id).trim();
            if (xmltvId) xmltvIds.push(xmltvId);
          }
          if (xmltvIds.length) {
            const byXmltv = await loadNativeEpgWindow(xmltvIds, startMs, endMs);
            for (const playlistId of primaryFallbackIds) {
              const xmltvId = (byId.get(playlistId)?.tvg_id || playlistId).trim();
              const list = byXmltv[xmltvId];
              if (list?.length) merged[playlistId] = list;
            }
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

export async function loadGuide(startISO?: string, hours = 6, force = false): Promise<GuideResponse> {
  const parsed = force ? await refreshInternal(true) : await ensureLoaded();
  const { winStart, winEnd, startMs, endMs, now } = resolveGuideWindowBounds(startISO, hours);

  // Apply user remaps at read time so clear-remap restores auto-matched ids from MEM.
  const remapped = withManualRemaps(parsed.channels);
  const cacheKey = `${startMs}|${endMs}|${parsed.guideEpoch || 0}`;
  if (programmeWindowCacheKey !== cacheKey) {
    clearProgrammeWindowCache();
    programmeWindowCacheKey = cacheKey;
  }

  const huge = remapped.length >= HUGE_PLAYLIST_MATCH_THRESHOLD;
  let playlistIds: string[];
  if ((huge || viewportGuideChannelIds?.length) && viewportGuideChannelIds?.length) {
    const want = new Set<string>([
      ...viewportGuideChannelIds,
      ...priorityMatchChannelIds.slice(0, 192),
    ]);
    playlistIds = Array.from(want).filter(Boolean);
  } else if (huge) {
    // Do not allocate/map all playlist ids before the first viewport exists.
    playlistIds = remapped.slice(0, 96).map((channel) => channel.id).filter(Boolean);
  } else {
    playlistIds = remapped.map((channel) => channel.id).filter(Boolean);
  }
  playlistIds = Array.from(new Set(playlistIds));

  await loadProgrammeCacheMisses(remapped, playlistIds, startMs, endMs);
  // Soft trim only — strict viewport trim would wipe the conveyor hysteresis band
  // that retainProgrammeWindowCache(expandRunwayKeepSet(...)) intentionally keeps.
  trimProgrammeWindowCache(playlistIds, "soft");

  // Programme data travels separately from channel metadata. Never clone every
  // channel just to attach EMPTY_PROGRAMS; Store/Guide subscribe row-locally.
  const programsByChannelId: Record<string, Program[]> = {};
  for (const channelId of playlistIds) {
    const list = programmeWindowCache[channelId];
    programsByChannelId[channelId] = list?.length ? list : EMPTY_PROGRAMS;
  }

  return {
    start: winStart.toISOString(),
    end: winEnd.toISOString(),
    now: now.toISOString(),
    channels: remapped,
    programsByChannelId,
    guideEpoch: parsed.guideEpoch || 0,
  };
}

/**
 * Exact directional runway fetch — patches programme cache only.
 * It reads cache misses only, records negative results, and never emits().
 */
export async function loadGuideProgramsForChannelIds(
  channelIds: string[],
  startISO?: string,
  hours = 6,
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

  // The grid supplies an exact direction-aware eight-page runway in its filtered
  // on-screen order. Querying any larger source-order ring wastes SQLite/bridge
  // work and can warm channels that are not even visible in the selected group.
  await loadProgrammeCacheMisses(remapped, unique, startMs, endMs);
  // A background EPG refresh can replace the cache while SQLite is reading.
  // Returning explicit empty rows here would erase the last-good Guide even
  // though the old query correctly refused to merge into the new epoch.
  if (programmeWindowCacheKey !== cacheKey) return {};
  const delta: Record<string, Program[]> = {};
  for (const id of unique) {
    const cached = programmeWindowCache[id];
    delta[id] = cached?.length ? cached : EMPTY_PROGRAMS;
  }
  // Soft-cap only here. The guide conveyor calls retainProgrammeWindowCache with
  // the hysteresis keep set so previously warmed pages are not dropped early.
  trimProgrammeWindowCache([...(viewportGuideChannelIds || []), ...unique]);
  return delta;
}

export async function refreshSource(force = false): Promise<SourceStatus> {
  await refreshInternal(force);
  return sourceStatus();
}

/**
 * Refresh expiring provider stream URLs without downloading or rebuilding XMLTV.
 * Existing logical EPG matches are retained for stable playlist channel ids.
 */
export async function refreshPlaylistOnly(): Promise<SourceStatus> {
  if (playlistOnlyRefreshPromise) return playlistOnlyRefreshPromise;
  playlistOnlyRefreshPromise = (async () => {
    if (refreshPromise) await refreshPromise;
    const cached = MEM || (await readChannelCache());
    const fresh = await fetchPlaylist();
    // The native parser already returned a fresh channel array. Reuse those
    // objects while carrying forward logical EPG/logo identity; cloning all
    // 6k+ rows here doubles the transient heap during token-only refreshes.
    const oldById = new Map<string, Channel>();
    for (const channel of cached?.channels || []) oldById.set(channel.id, channel);
    for (const channel of fresh) {
      const previous = oldById.get(channel.id);
      if (!previous) continue;
      channel.tvg_id = previous.tvg_id || channel.tvg_id;
      channel.logo = channel.logo || previous.logo;
    }
    const channels = fresh;
    const playlistEpoch = (cached?.playlistEpoch || 0) + 1;
    MEM = {
      ...(cached || {
        ts: 0,
        epgProgramCount: 0,
        epgChannelCount: 0,
      }),
      channels,
      playlistEpoch,
      playlistRefreshedAt: Date.now(),
      playlistIdentityFingerprint: playlistIdentityFingerprint(channels),
    };
    await persistMeta(MEM);
    await syncPlaylistToNative(channels, playlistEpoch);
    await touchNativePlaylistRefresh(playlistEpoch);
    await syncMatchesToNative(channels, MEM.guideEpoch || 0);
    emit();
    return sourceStatus();
  })();
  try {
    return await playlistOnlyRefreshPromise;
  } finally {
    playlistOnlyRefreshPromise = null;
  }
}

/** Check persisted independent playlist/EPG clocks and refresh only what is due. */
export async function refreshSourcesIfDue(): Promise<SourceStatus> {
  if (refreshPromise) {
    await refreshPromise;
    return sourceStatus();
  }
  const cached = MEM || (await readChannelCache());
  if (!cached?.channels?.length) return sourceStatus();
  MEM = cached;
  const prefs = await getSourceRefreshPreferences();
  const now = Date.now();
  const playlistLast = cached.playlistRefreshedAt != null ? cached.playlistRefreshedAt : cached.ts;
  if (isRefreshDue(playlistLast, prefs.playlistHours, now)) {
    if (!cached.epgError) {
      setProgress({ phase: "update_available", ratio: 0, etaSeconds: null, message: null }, true);
    }
    await refreshInternal(true);
    return sourceStatus();
  }
  const guideLast = cached.guideRefreshedAt != null ? cached.guideRefreshedAt : cached.ts;
  if (isRefreshDue(guideLast, prefs.epgHours, now)) {
    return refreshEpgOnly();
  }
  return sourceStatus();
}

/** Refresh XMLTV only — keep current playlist rows (independent epochs). */
export async function refreshEpgOnly(): Promise<SourceStatus> {
  // TiviMate-style single refresh owner: if a full/EPG refresh is already doing
  // the provider work, join it. Do not queue an immediate duplicate XMLTV pass.
  if (refreshPromise) {
    await refreshPromise;
    return sourceStatus();
  }

  // Resolve cold/empty fallback before claiming refreshPromise. Calling
  // refreshInternal while this function owns that same promise creates a
  // self-referential promise cycle because refreshInternal coalesces on it.
  const cached = MEM || (await readChannelCache());
  if (!cached?.channels?.length) {
    await refreshInternal(true);
    return sourceStatus();
  }

  refreshPromise = (async () => {
    lastSourceError = null;
    try {
      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");
      await syncPlaylistToNative(cached.channels, cached.playlistEpoch || 0);
      const ownership = await applyPersistedGuideOwnership();
      const overrideIds = ownership.userEnabled
        ? new Set(Object.keys(ownership.userOverrides))
        : new Set<string>();
      const refreshPreferences = await getSourceRefreshPreferences();

      // Scheduled/background custom-guide work is only useful when at least one
      // playlist channel is explicitly owned by the custom XMLTV source. Manual
      // refresh in the Custom EPG manager still performs a full source index so
      // users can discover XMLTV channels before creating assignments.
      if (ownership.userEnabled && ownership.userUrl && overrideIds.size > 0) {
        await refreshNativeUserGuide(ownership.userUrl);
      }

      if (!ownership.primaryEnabled) {
        // A disabled primary source is not downloaded, parsed, rematched, or
        // scheduled in disguise. Re-read native ownership so every consumer
        // drops old row caches without manufacturing a successful refresh time.
        const checkedAt = Date.now();
        const effectiveGuide = await readNativeStoredPlaylist();
        clearProgrammeWindowCache();
        MEM = {
          ...cached,
          ...MEM,
          ts: checkedAt,
          epgError: undefined,
          epgProgramCount: effectiveGuide?.epgProgramCount ?? cached.epgProgramCount,
          guideEpoch: effectiveGuide?.guideEpoch ?? cached.guideEpoch,
          guideRefreshedAt: effectiveGuide?.guideRefreshedAt ?? cached.guideRefreshedAt,
        };
        await persistMeta(MEM);
        emit();
        setProgress({ phase: "ready", ratio: 1, etaSeconds: 0, message: null }, true);
        return MEM;
      }

      if (!SOURCE_EPG) throw new Error("EPG is not configured for this build (missing EXPO_PUBLIC_EPG_URL).");
      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null, message: null }, true);
      const activeBindings = activeEpgBindings(cached.channels, overrideIds);
      await configureNativeEpgSource(sourceUrl(SOURCE_EPG), refreshPreferences.epgHours);
      const epg = await refreshNativeEpg(
        sourceUrl(SOURCE_EPG),
        true,
        activeBindings.ids,
        activeBindings.names,
        applyNativeImportProgress,
      );
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
          // A validator hit confirms the provider payload is unchanged, but it
          // does not perform the transactional programme-table swap. Preserve
          // the last successful swap clock; `ts` still records this check.
          guideRefreshedAt: cached.guideRefreshedAt,
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
        channelIds: buildXmltvChannelIdSet(
          epgLogos,
          epgNames,
          epg.channelIdsWithPrograms || [],
        ),
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
          applyLogoOnlyUpdates(cached.channels, epgLogos, indexes.fingerprint, indexes.fingerprint, await getLogoPriority()) ||
          cached.channels;
        quality = cached.matchQuality || emptyMatchQuality();
      } else {
        const applied = await matchChannelsWithPhases(cached.channels, indexes, epgLogos, await getLogoPriority(), async (partial, partialQuality) => {
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
  const refreshPrefs = await getSourceRefreshPreferences();
  const playlistNext = nextRefreshAt(MEM?.playlistRefreshedAt || MEM?.ts, refreshPrefs.playlistHours);
  const epgNext = nextRefreshAt(MEM?.guideRefreshedAt || MEM?.ts, refreshPrefs.epgHours);
  const nextCandidates = [playlistNext, epgNext].filter((value): value is number => typeof value === "number");
  const nextAutoRefreshAt = nextCandidates.length ? Math.min(...nextCandidates) : null;
  return {
    mode: SOURCE_M3U ? "direct" : "unconfigured",
    cacheBytes,
    cacheAgeMinutes: MEM && MEM.ts > 0 ? Math.max(0, Math.round((Date.now() - MEM.ts) / 60000)) : null,
    channels: MEM?.channels.length || 0,
    programs: MEM?.epgProgramCount || 0,
    refreshInFlight: !!refreshPromise,
    epgError: MEM?.epgError || lastSourceError,
    nextAutoRefresh: nextAutoRefreshAt ? new Date(nextAutoRefreshAt).toISOString() : null,
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
export function invalidateGuideOwnershipCaches(): void {
  clearProgrammeWindowCache();
  clearGuidePrograms();
  if (MEM) MEM = { ...MEM, guideEpoch: (MEM.guideEpoch || 0) + 1 };
  emit();
}

export async function clearGuideCache(): Promise<void> {
  MEM = null;
  lastNativeMatchWriteFingerprint = "";
  lastSourceError = null;
  clearProgrammeWindowCache();
  clearGuidePrograms();
  viewportGuideChannelIds = null;
  priorityMatchChannelIds = [];
  channelCacheKnownGood = false;
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
