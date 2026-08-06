type CacheMeta = Omit<Parsed, "programs"> & { indexed: true };

let persistQueue: Promise<{ programCount: number; channelCount: number }> = Promise.resolve({
  programCount: 0,
  channelCount: 0,
});

async function persistSnapshot(snapshot: Parsed, onProgress?: (ratio: number) => void) {
  const incomingCount = Object.values(snapshot.programs).reduce((total, list) => total + list.length, 0);
  const stats = incomingCount > 0
    ? await replaceIndexedPrograms(snapshot.programs, onProgress)
    : await getIndexedEpgStats();

  const { programs: _programs, ...rest } = snapshot;
  const meta: CacheMeta = {
    ...rest,
    epgProgramCount: stats.programCount,
    epgChannelCount: stats.channelCount,
    indexed: true,
  };
  const metaPayload = JSON.stringify(meta);
  if (metaPayload.length > MAX_CACHE_BYTES) throw new Error("Guide metadata cache is too large");
  await FileSystem.writeAsStringAsync(CACHE_TMP_FILE, metaPayload);
  await FileSystem.deleteAsync(CACHE_FILE, { idempotent: true });
  await FileSystem.moveAsync({ from: CACHE_TMP_FILE, to: CACHE_FILE });

  // Remove the superseded v5 JSON chunks after the SQLite commit succeeds.
  try {
    const files = await FileSystem.readDirectoryAsync(CACHE_ROOT);
    await Promise.all(
      files
        .filter((name) => name === "guide_cache_v5_meta.json" || name.startsWith(CACHE_CHUNK_PREFIX))
        .map((name) => FileSystem.deleteAsync(CACHE_ROOT + name, { idempotent: true })),
    );
  } catch {}
  onProgress?.(1);
  return stats;
}

async function persist(onProgress?: (ratio: number) => void) {
  if (Platform.OS === "web" || !MEM || !CACHE_FILE) {
    return {
      programCount: Object.values(MEM?.programs || {}).reduce((total, list) => total + list.length, 0),
      channelCount: Object.values(MEM?.programs || {}).filter((list) => list.length > 0).length,
    };
  }
  const snapshot = MEM;
  persistQueue = persistQueue
    .catch(() => ({ programCount: snapshot.epgProgramCount || 0, channelCount: snapshot.epgChannelCount || 0 }))
    .then(() => persistSnapshot(snapshot, onProgress));
  return persistQueue;
}

async function readCache(): Promise<Parsed | null> {
  if (Platform.OS === "web" || !CACHE_FILE) return null;
  try {
    const info = await FileSystem.getInfoAsync(CACHE_FILE);
    if (!info.exists) return null;
    const txt = await FileSystem.readAsStringAsync(CACHE_FILE);
    const meta = JSON.parse(txt) as CacheMeta;
    if (
      !meta ||
      meta.indexed !== true ||
      !Number.isFinite(meta.ts) ||
      !Array.isArray(meta.channels) ||
      !meta.channels.length
    ) {
      await FileSystem.deleteAsync(CACHE_FILE, { idempotent: true });
      return null;
    }
    const stats = await getIndexedEpgStats();
    return {
      ...meta,
      epgProgramCount: stats.programCount,
      epgChannelCount: stats.channelCount,
      programs: {},
    };
  } catch {
    await clearCacheFiles();
    return null;
  }
}

type RemoteChannel = {
  id: string;
  tvgId?: string;
  name: string;
  logo?: string;
  category?: string;
  url: string;
};
type RemoteProgram = { t: string; s: number; e: number; d?: string; c?: string };
type RemoteGuide = { updatedAt?: number; channels: { id: string; p?: RemoteProgram[] }[] };

async function fetchRemoteText(path: string): Promise<string> {
  const url = `${API_BASE}${path}`;
  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
  };

  if (Platform.OS !== "web") {
    const tmp = (FileSystem.cacheDirectory || FileSystem.documentDirectory || "") + `remote_${path.replace(/[^a-z0-9]+/gi, "_")}.json`;
    const dl = FileSystem.createDownloadResumable(url, tmp, { headers });
    const res = await dl.downloadAsync();
    if (!res) throw new Error(`${path} download failed`);
    const text = await FileSystem.readAsStringAsync(res.uri);
    try {
      await FileSystem.deleteAsync(res.uri, { idempotent: true });
    } catch {}
    if (!text.trim()) {
      throw new Error(`${path} returned empty data`);
    }
    if (text.charCodeAt(0) === 0x1f || text.charCodeAt(1) === 0x8b) {
      throw new Error(`${path} returned compressed data the app could not decode`);
    }
    return text;
  }

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
    },
  });
  if (!res.ok) {
    throw new Error(`${path} unavailable (${res.status})`);
  }
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`${path} returned empty data`);
  }
  if (text.charCodeAt(0) === 0x1f || text.charCodeAt(1) === 0x8b) {
    throw new Error(`${path} returned compressed data the app could not decode`);
  }
  return text;
}

function parseRemoteJson<T>(label: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const sample = text.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`${label} returned invalid JSON: ${sample}`);
  }
}

async function fetchRemoteTextWithBinaryFallback(plainPath: string, gzipPath: string): Promise<string> {
  try {
    return await fetchRemoteText(plainPath);
  } catch (firstError) {
    try {
      return await inflateIfGzip(await fetchBytes(`${API_BASE}${gzipPath}`));
    } catch {
      throw firstError;
    }
  }
}

async function fetchRemoteJson(): Promise<Parsed> {
  if (!API_BASE) throw new Error("Cloudflare API URL is not configured");
  setProgress({ phase: "downloading", ratio: 0.1, etaSeconds: null }, true);
  const channelsText = await fetchRemoteTextWithBinaryFallback("/channels.json", "/channels");
  const rawChannels = parseRemoteJson<RemoteChannel[]>("/channels.json", channelsText);
  if (!Array.isArray(rawChannels)) {
    throw new Error("Guide service returned invalid channel data");
  }

  const channels: Channel[] = rawChannels
    .filter((c) => c?.id && c?.name && c?.url)
    .map((c) => ({
      id: c.id,
      tvg_id: c.id,
      name: c.name,
      logo: c.logo || "",
      group: c.category || "Uncategorized",
      url: c.url,
      stream_type: streamType(c.url),
    }));
  if (!channels.length) throw new Error("Guide service returned no channels");

  const previous = MEM;
  MEM = {
    ts: Date.now(),
    channels: sortChannelsAlphabetically(channels),
    programs: previous?.programs || {},
    epgProgramCount: previous?.epgProgramCount,
    epgChannelCount: previous?.epgChannelCount,
  };
  await persist();
  emit();
  setProgress({ phase: "channels", ratio: 0.25, etaSeconds: null }, true);

  let guideText = "";
  try {
    guideText = await fetchRemoteTextWithBinaryFallback("/guide.json", "/guide");
  } catch (e) {
    setProgress({ phase: "error", ratio: 0, etaSeconds: null }, true);
    throw e;
  }
  const rawGuide = parseRemoteJson<RemoteGuide>("/guide.json", guideText);
  if (!Array.isArray(rawGuide?.channels)) {
    throw new Error("Guide service returned invalid EPG data");
  }

  const programs: Record<string, Program[]> = {};
  for (const entry of rawGuide.channels) {
    if (!entry?.id || !Array.isArray(entry.p)) continue;
    programs[entry.id] = entry.p
      .filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e) && p.e > p.s)
      .map((p) => ({
        title: p.t || "No Title",
        desc: p.d || "",
        category: p.c || "",
        start: new Date(p.s).toISOString(),
        stop: new Date(p.e).toISOString(),
      }));
  }

  const channelsWithPrograms = channels.filter((c) => programs[c.id]?.length).length;
  if (!channelsWithPrograms) {
    throw new Error("Guide service returned no matched EPG programs");
  }
  setProgress({ phase: "ready", ratio: 1, etaSeconds: 0 }, true);
  return { ts: rawGuide.updatedAt || Date.now(), channels: sortChannelsAlphabetically(channels), programs };
}

let epgLoading = false;
let epgPromise: Promise<void> | null = null;
let lastSourceError: string | null = null;

function loadEpg(channels: Channel[], force = false): Promise<void> {
  if (!SOURCE_EPG) return Promise.resolve();
  if (epgPromise) return epgPromise;

  const lastAttempt = MEM?.epgAttemptTs || 0;
  const hasPrograms = !!MEM && (
    Object.keys(MEM.programs).length > 0 ||
    (MEM.epgProgramCount || 0) > 0
  );
  if (!force && !hasPrograms && lastAttempt > 0 && Date.now() - lastAttempt < TTL_MS) {
    if (MEM?.epgError) setProgress({ phase: "error", ratio: 0, etaSeconds: null }, true);
    return Promise.resolve();
  }

  epgPromise = (async () => {
    epgLoading = true;
    const attemptTs = Date.now();
    const dlStart = attemptTs;
    lastSourceError = null;
    if (MEM) {
      // Keep the last good guide instantly available while the replacement is
      // downloading and parsing. Cache work happens after usable data is ready.
      MEM = { ...MEM, epgAttemptTs: attemptTs, epgError: undefined };
    }
    try {
      setProgress({ phase: "downloading", ratio: 0, etaSeconds: null }, true);
      let bytes = await fetchBytes(SOURCE_EPG, (ratio) => {
        if (ratio == null) {
          setProgress({ phase: "downloading", ratio: 0, etaSeconds: null });
          return;
        }
        const elapsed = (Date.now() - dlStart) / 1000;
        const eta = ratio > 0.02 && elapsed > 0.5 ? (elapsed / ratio) * (1 - ratio) : null;
        setProgress({ phase: "downloading", ratio: ratio * 0.2, etaSeconds: eta });
      });
      if (bytes.length < 16) throw new Error("EPG download returned no usable data");
      setProgress({ phase: "decompressing", ratio: 0.2, etaSeconds: null }, true);
      const epgChunks = await inflateToTextChunks(bytes, (ratio) => {
        setProgress({ phase: "decompressing", ratio: 0.2 + ratio * 0.1, etaSeconds: null });
      });
      bytes = new Uint8Array(0);
      setProgress({ phase: "parsing", ratio: 0.3, etaSeconds: null }, true);
      let header = "";
      let tagTail = "";
      let hasProgramme = false;
      for (const chunk of epgChunks) {
        if (header.length < 8192) header += chunk;
        const scan = tagTail + chunk;
        if (scan.includes("<programme")) hasProgramme = true;
        tagTail = scan.slice(-16);
      }
      header = header.slice(0, 8192).toLowerCase();
      if (!header.includes("<tv") || !hasProgramme) {
        throw new Error("EPG URL did not return XMLTV data");
      }

      const icons: Record<string, string> = {};
      const channelNames: Record<string, string> = {};
      const programs: Record<string, Program[]> = {};
      const parseStart = Date.now();
      const epgSink: Sink = {
        icons,
        channelNames,
        programs,
        onProgress: (ratio) => {
          const elapsed = (Date.now() - parseStart) / 1000;
          const eta = ratio > 0.02 && elapsed > 0.3 ? (elapsed / ratio) * (1 - ratio) : null;
          setProgress({ phase: "parsing", ratio: 0.3 + ratio * 0.6, etaSeconds: eta });
        },
      };
      if (Platform.OS === "web") {
        await parseXMLTV(epgChunks.join(""), epgSink);
      } else {
        await parseXMLTVChunks(epgChunks, epgSink);
      }

      setProgress({ phase: "indexing", ratio: 0.9, etaSeconds: null }, true);
      await nextTick();
      const programIdByKey = new Map<string, string>();
      for (const id of Object.keys(programs)) {
        const key = normalizeGuideKey(id);
        if (key && !programIdByKey.has(key)) programIdByKey.set(key, id);
      }
      const programIdByName = new Map<string, string>();
      for (const [id, name] of Object.entries(channelNames)) {
        const key = normalizeGuideKey(name);
        if (key && programs[id]?.length && !programIdByName.has(key)) programIdByName.set(key, id);
      }

      let matchedChannels = 0;
      for (const channel of channels) {
        const sourceId =
          (channel.tvg_id && programs[channel.tvg_id]?.length ? channel.tvg_id : "") ||
          programIdByKey.get(normalizeGuideKey(channel.tvg_id)) ||
          programIdByName.get(normalizeGuideKey(channel.name)) ||
          "";
        if (!sourceId || !programs[sourceId]?.length) continue;
        channel.tvg_id = sourceId;
        matchedChannels++;
        if (!channel.logo && icons[sourceId]) channel.logo = icons[sourceId];
      }
      if (!matchedChannels) throw new Error("EPG loaded, but its channel IDs did not match the playlist");

      epgChunks.length = 0;
      MEM = {
        ts: attemptTs,
        epgAttemptTs: attemptTs,
        channels: sortChannelsAlphabetically(channels),
        programs,
        epgProgramCount: Object.values(programs).reduce((total, list) => total + list.length, 0),
        epgChannelCount: matchedChannels,
      };
      lastSourceError = null;
      setProgress({ phase: "caching", ratio: 0.92, etaSeconds: null }, true);
      const indexed = await persist((ratio) => {
        setProgress({ phase: "caching", ratio: 0.92 + ratio * 0.08, etaSeconds: null });
      });
      // SQLite is now the source of truth. Drop the full in-memory programme
      // map and repaint from the indexed visible-window query.
      MEM = {
        ...MEM,
        programs: {},
        epgProgramCount: indexed.programCount,
        epgChannelCount: indexed.channelCount,
      };
      emit();
      setProgress({ phase: "ready", ratio: 1, etaSeconds: 0 }, true);
    } catch (error) {
      lastSourceError = error instanceof Error ? error.message : "EPG refresh failed";
      if (MEM) {
        MEM = { ...MEM, epgAttemptTs: attemptTs, epgError: lastSourceError };
        await persist().catch(() => undefined);
      }
      setProgress({ phase: "error", ratio: 0, etaSeconds: null }, true);
      emit();
    } finally {
      epgLoading = false;
      epgPromise = null;
    }
  })();
  return epgPromise;
}

function maybeLoadEpg() {
  if (MEM && MEM.channels.length && Object.keys(MEM.programs).length === 0 && !(MEM.epgProgramCount || 0)) {
    loadEpg(MEM.channels);
  } else if (MEM && (Object.keys(MEM.programs).length > 0 || (MEM.epgProgramCount || 0) > 0)) {
    setProgress({ phase: "ready", ratio: 1, etaSeconds: 0 }, true);
  }
}
