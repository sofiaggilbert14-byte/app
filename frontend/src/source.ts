let fetchPromise: Promise<Parsed> | null = null;
async function fetchParseOnce(): Promise<Parsed> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = doFetchParse();
  try {
    return await fetchPromise;
  } finally {
    fetchPromise = null;
  }
}

async function doFetchParse(): Promise<Parsed> {
  if (API_BASE) {
    const remote = await fetchRemoteJson();
    MEM = remote;
    await persist();
    emit();
    return remote;
  }
  if (!SOURCE_M3U) {
    throw new Error("Local M3U URL is not configured");
  }
  // Stage 1 (fast): parse the small M3U so the guide paints immediately, even
  // on low-power Android TV / Firestick boxes.
  const m3uText = await fetchTextMaybeGzip(SOURCE_M3U);
  const channels = parseM3U(m3uText);
  const previous = MEM;
  MEM = {
    ts: Date.now(),
    channels: sortChannelsAlphabetically(channels),
    programs: previous?.programs || {},
    epgProgramCount: previous?.epgProgramCount,
    epgChannelCount: previous?.epgChannelCount,
  };
  // Do not rewrite a large existing EPG before starting a refresh.
  if (Object.keys(MEM.programs).length === 0 && !(MEM.epgProgramCount || 0)) await persist();
  emit();
  setProgress({ phase: "channels", ratio: 0, etaSeconds: null }, true);
  // Stage 2 (slower): parse the large EPG in the background, then notify.
  loadEpg(channels);
  return MEM;
}

async function ensureParsed(force: boolean): Promise<Parsed> {
  if (!force && MEM && Date.now() - MEM.ts < TTL_MS) {
    maybeLoadEpg();
    return MEM;
  }
  if (!force && !MEM) {
    const cached = await readCache();
    if (cached) {
      MEM = cached;
      maybeLoadEpg();
      if (Date.now() - cached.ts < TTL_MS) return cached;
    }
  }
  try {
    return await fetchParseOnce();
  } catch (e) {
    if (MEM) return MEM; // fall back to whatever we have
    throw e;
  }
}

function windowPrograms(list: Program[] | undefined, startMs: number, endMs: number): Program[] {
  if (!list) return [];
  const out: Program[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const ps = Date.parse(p.start);
    const pe = p.stop ? Date.parse(p.stop) : ps + 30 * 60 * 1000;
    if (pe > startMs && ps < endMs) out.push(p);
  }
  return out;
}

export async function loadGuide(startISO?: string, hours = 12, force = false): Promise<GuideResponse> {
  const parsed = await ensureParsed(force);
  const now = dayjs();
  const winStart = startISO ? dayjs(startISO) : now.subtract(1, "hour");
  const winEnd = winStart.add(hours, "hour");
  const winStartMs = winStart.valueOf();
  const winEndMs = winEnd.valueOf();
  const indexedPrograms = (parsed.epgProgramCount || 0) > 0
    ? await loadIndexedPrograms(
        parsed.channels.map((channel) => channel.tvg_id).filter(Boolean),
        winStartMs,
        winEndMs,
      )
    : null;
  const channels = parsed.channels.map((c) => ({
    ...c,
    programs: indexedPrograms
      ? indexedPrograms[c.tvg_id] || []
      : windowPrograms(parsed.programs[c.tvg_id], winStartMs, winEndMs),
  }));
  return {
    start: winStart.toISOString(),
    end: winEnd.toISOString(),
    now: now.toISOString(),
    channels,
  };
}

export async function refreshSource(force = false): Promise<SourceStatus> {
  const parsed = await ensureParsed(force);
  if (force && !API_BASE && SOURCE_EPG) await loadEpg(parsed.channels, true);
  return sourceStatus();
}

export function sourceStatus(): SourceStatus {
  const channels = MEM?.channels || [];
  const withEpg = MEM?.epgChannelCount ||
    channels.filter((c) => c.tvg_id && MEM?.programs[c.tvg_id]?.length).length;
  return {
    m3u_url: API_BASE ? `${API_BASE}/channels.json` : SOURCE_M3U ? "configured" : "not configured",
    epg_url: API_BASE ? `${API_BASE}/guide.json` : SOURCE_EPG ? "configured" : "not configured",
    channel_count: channels.length,
    channels_with_epg: withEpg,
    last_refresh: MEM ? new Date(MEM.ts).toISOString() : null,
    refreshing: false,
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
  if (Platform.OS !== "web" && CACHE_FILE) {
    try {
      const files = await FileSystem.readDirectoryAsync(CACHE_ROOT);
      for (const name of files) {
        if (name === "guide_cache_v6_meta.json" || name === "guide_cache_v5_meta.json" || name.startsWith(CACHE_CHUNK_PREFIX)) {
          const info = await FileSystem.getInfoAsync(CACHE_ROOT + name);
          if (info.exists && typeof info.size === "number") cacheBytes += info.size;
        }
      }
    } catch {}
  }
  cacheBytes += await getIndexedEpgStorageBytes().catch(() => 0);
  const indexedStats = await getIndexedEpgStats();
  const programCount = MEM?.epgProgramCount ||
    indexedStats.programCount ||
    (MEM ? Object.values(MEM.programs).reduce((total, list) => total + list.length, 0) : 0);
  return {
    mode: API_BASE ? "cloudflare" : SOURCE_M3U ? "direct" : "unconfigured",
    cacheBytes,
    cacheAgeMinutes: MEM ? Math.max(0, Math.round((Date.now() - MEM.ts) / 60000)) : null,
    channels: MEM?.channels.length || 0,
    programs: programCount,
    refreshInFlight: !!fetchPromise || epgLoading,
    epgError: MEM?.epgError || lastSourceError,
    nextAutoRefresh: MEM ? new Date(MEM.ts + TTL_MS).toISOString() : null,
  };
}

async function clearCacheFiles(): Promise<void> {
  if (Platform.OS === "web" || !CACHE_ROOT) return;
  try {
    const files = await FileSystem.readDirectoryAsync(CACHE_ROOT);
    await Promise.all(
      files
        .filter((name) =>
          name === "guide_cache_v6_meta.json" ||
          name === "guide_cache_v5_meta.json" ||
          name.startsWith(CACHE_CHUNK_PREFIX)
        )
        .map((name) => FileSystem.deleteAsync(CACHE_ROOT + name, { idempotent: true })),
    );
  } catch {}
  await FileSystem.deleteAsync(CACHE_TMP_FILE, { idempotent: true });
}

export async function clearGuideCache(): Promise<void> {
  MEM = null;
  lastSourceError = null;
  await clearIndexedEpg();
  await clearCacheFiles();
  setProgress({ phase: "idle", ratio: 0, etaSeconds: null }, true);
  emit();
}
