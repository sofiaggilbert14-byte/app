import dayjs from "dayjs";
import * as FileSystem from "expo-file-system/legacy";
import type { Channel, GuideResponse, SourceStatus } from "@/src/api";
import {
  clearNativeEpg,
  loadNativeEpgWindow,
  nativeEpgAvailable,
  refreshNativeEpg,
} from "@/src/nativeEpg";

export const API_BASE = "";
export const SOURCE_M3U =
  process.env.EXPO_PUBLIC_M3U_URL || "http://m3u4u.com/m3u/jwmzn1grpmu99585n721";
export const SOURCE_EPG =
  process.env.EXPO_PUBLIC_EPG_URL || "http://m3u4u.com/epg/jwmzn1grpmu99585n721";

const TTL_MS = 24 * 60 * 60 * 1000;
const PROGRESS_THROTTLE_MS = 150;
const CACHE_ROOT = FileSystem.documentDirectory || "";
const CHANNEL_CACHE = CACHE_ROOT ? `${CACHE_ROOT}charm_native_channels_v2.json` : "";
const LEGACY_CHANNEL_CACHE = CACHE_ROOT ? `${CACHE_ROOT}charm_native_channels_v1.json` : "";
const CHANNEL_CACHE_TMP = CHANNEL_CACHE ? `${CHANNEL_CACHE}.tmp` : "";
const EXTINF_ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;

type NativeMeta = {
  ts: number;
  channels: Channel[];
  epgProgramCount: number;
  epgChannelCount: number;
  epgError?: string;
};

let MEM: NativeMeta | null = null;
let refreshPromise: Promise<NativeMeta> | null = null;
let lastSourceError: string | null = null;
const listeners = new Set<() => void>();
let sourceEmitScheduled = false;

export type LoadPhase = "idle" | "channels" | "downloading" | "decompressing" | "parsing" | "indexing" | "caching" | "ready" | "error";
export type EpgProgress = {
  phase: LoadPhase;
  ratio: number;
  etaSeconds: number | null;
};

let progress: EpgProgress = { phase: "idle", ratio: 0, etaSeconds: null };
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
  progress = { ...progress, ...next };
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

function streamType(url: string): string {
  const clean = url.toLowerCase().split("?")[0];
  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".ts")) return "ts";
  return "unknown";
}

function normalizeGuideKey(value: string | undefined): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sortChannels(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }),
  );
}

function parseM3U(text: string): Channel[] {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  const used = new Set<string>();
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF")) continue;

    const attrs: Record<string, string> = {};
    EXTINF_ATTR.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EXTINF_ATTR.exec(line))) attrs[match[1]] = match[2];

    const name = line.includes(",")
      ? line.slice(line.lastIndexOf(",") + 1).trim()
      : attrs["tvg-name"] || "Channel";

    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next && !next.startsWith("#")) {
        url = next;
        break;
      }
    }
    if (!url) continue;

    const tvgId = (attrs["tvg-id"] || "").trim();
    const base = tvgId || name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    let id = base || `channel-${index}`;
    if (used.has(id)) id = `${id}#${index}`;
    used.add(id);

    channels.push({
      id,
      tvg_id: tvgId,
      name,
      logo: (attrs["tvg-logo"] || "").trim(),
      group: (attrs["group-title"] || "").trim(),
      url,
      stream_type: streamType(url),
    });
    index++;
  }

  return sortChannels(channels);
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
  const response = await fetch(https(SOURCE_M3U), {
    headers: { "User-Agent": "CharmIPTV/Experimental-v3" },
  });
  if (!response.ok) throw new Error(`M3U HTTP ${response.status}`);
  const text = await response.text();
  const channels = parseM3U(text);
  if (!channels.length) throw new Error("Playlist contained no channels");
  return channels;
}

async function ensureLoaded(): Promise<NativeMeta> {
  if (MEM) return MEM;
  const cached = await readChannelCache();
  if (cached) {
    MEM = cached;
    if (cached.ts <= 0) void refreshInternal(false);
    return cached;
  }

  const legacy = await readMetaFile(LEGACY_CHANNEL_CACHE);
  if (legacy) {
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
      MEM = {
        ts: cached?.ts || 0,
        channels,
        epgProgramCount: cached?.epgProgramCount || 0,
        epgChannelCount: cached?.epgChannelCount || 0,
      };
      await persistMeta(MEM);
      emit();

      if (!nativeEpgAvailable) throw new Error("Native EPG engine is unavailable in this Android build");
      setProgress({ phase: "downloading", ratio: 0.2, etaSeconds: null }, true);
      const epg = await refreshNativeEpg(https(SOURCE_EPG));
      setProgress({ phase: "caching", ratio: 0.9, etaSeconds: null }, true);

      const epgLogos = epg.channelLogos || {};
      const epgNames = epg.channelNames || {};
      const idsWithPrograms = new Set(epg.channelIdsWithPrograms || []);
      const xmltvIdByNormalizedId = new Map<string, string>();
      const xmltvIdByNormalizedName = new Map<string, string>();

      for (const id of new Set([...Object.keys(epgLogos), ...Object.keys(epgNames), ...idsWithPrograms])) {
        const key = normalizeGuideKey(id);
        if (key && !xmltvIdByNormalizedId.has(key)) xmltvIdByNormalizedId.set(key, id);
      }
      for (const [id, name] of Object.entries(epgNames)) {
        const key = normalizeGuideKey(name);
        if (key && !xmltvIdByNormalizedName.has(key)) xmltvIdByNormalizedName.set(key, id);
      }

      let matchedChannels = 0;
      const matchedChannelsWithLogos = MEM.channels.map((channel) => {
        const tvgId = channel.tvg_id || "";
        const exactProgramId = idsWithPrograms.has(tvgId)
          ? tvgId
          : idsWithPrograms.has(channel.id)
            ? channel.id
            : "";
        const normalizedIdMatch =
          xmltvIdByNormalizedId.get(normalizeGuideKey(tvgId)) ||
          xmltvIdByNormalizedId.get(normalizeGuideKey(channel.id)) ||
          "";
        const nameMatch = xmltvIdByNormalizedName.get(normalizeGuideKey(channel.name)) || "";

        const sourceId =
          exactProgramId ||
          (normalizedIdMatch && idsWithPrograms.has(normalizedIdMatch) ? normalizedIdMatch : "") ||
          (nameMatch && idsWithPrograms.has(nameMatch) ? nameMatch : "");
        const logoId =
          (epgLogos[tvgId] ? tvgId : "") ||
          (epgLogos[channel.id] ? channel.id : "") ||
          (normalizedIdMatch && epgLogos[normalizedIdMatch] ? normalizedIdMatch : "") ||
          (nameMatch && epgLogos[nameMatch] ? nameMatch : "");

        if (sourceId) matchedChannels++;
        const xmltvLogo = logoId ? (epgLogos[logoId] || "").trim() : "";
        const nextLogo = xmltvLogo || channel.logo || "";
        const nextGuideId = sourceId || channel.tvg_id;

        if (nextLogo === channel.logo && nextGuideId === channel.tvg_id) return channel;
        return { ...channel, tvg_id: nextGuideId, logo: nextLogo };
      });

      MEM = {
        ...MEM,
        ts: Date.now(),
        channels: matchedChannelsWithLogos,
        epgProgramCount: Math.max(0, Math.round(epg.count || 0)),
        epgChannelCount: matchedChannels,
        epgError: undefined,
      };
      await persistMeta(MEM);
      if (LEGACY_CHANNEL_CACHE) {
        void FileSystem.deleteAsync(LEGACY_CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
      }
      emit();
      setProgress({ phase: "ready", ratio: 1, etaSeconds: 0 }, true);
      return MEM;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source refresh failed";
      lastSourceError = message;
      setProgress({ phase: "error", ratio: 0, etaSeconds: null }, true);
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
      throw error;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function loadGuide(startISO?: string, hours = 4, force = false): Promise<GuideResponse> {
  const parsed = force ? await refreshInternal(true) : await ensureLoaded();
  const now = dayjs();
  const winStart = startISO ? dayjs(startISO) : now.subtract(1, "hour");
  const winEnd = winStart.add(hours, "hour");
  const startMs = winStart.valueOf();
  const endMs = winEnd.valueOf();

  const guideIds = parsed.channels
    .map((channel) => channel.tvg_id || channel.id)
    .filter(Boolean);
  const programmes = nativeEpgAvailable
    ? await loadNativeEpgWindow(guideIds, startMs, endMs)
    : {};

  let channelsWithEpg = 0;
  const channels = parsed.channels.map((channel) => {
    const key = channel.tvg_id || channel.id;
    const list = programmes[key] || [];
    if (list.length) channelsWithEpg++;
    return { ...channel, programs: list };
  });

  if (channelsWithEpg !== parsed.epgChannelCount && MEM) {
    MEM = { ...MEM, epgChannelCount: channelsWithEpg };
    void persistMeta(MEM);
  }

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
  };
}

export async function clearGuideCache(): Promise<void> {
  MEM = null;
  lastSourceError = null;
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  await clearNativeEpg();
  if (CHANNEL_CACHE) await FileSystem.deleteAsync(CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  if (CHANNEL_CACHE_TMP) await FileSystem.deleteAsync(CHANNEL_CACHE_TMP, { idempotent: true }).catch(() => undefined);
  if (LEGACY_CHANNEL_CACHE) await FileSystem.deleteAsync(LEGACY_CHANNEL_CACHE, { idempotent: true }).catch(() => undefined);
  emit();
}
