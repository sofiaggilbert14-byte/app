// Rolling XMLTV parser for large native EPG files. It accepts decoder chunks,
// discards each consumed XML block immediately, and yields frequently so held
// remote input and playback stay responsive throughout an update.
async function parseXMLTVChunks(
  chunks: string[],
  sink: Sink = {},
): Promise<{
  icons: Record<string, string>;
  channelNames: Record<string, string>;
  programs: Record<string, Program[]>;
}> {
  const icons = sink.icons ?? {};
  const channelNames = sink.channelNames ?? {};
  const programs = sink.programs ?? {};
  const totalChars = Math.max(1, chunks.reduce((total, chunk) => total + chunk.length, 0));
  const minStop = Date.now() - 6 * 3600 * 1000;
  const maxStart = Date.now() + 2 * 24 * 3600 * 1000;
  let buffer = "";
  let consumedChars = 0;
  let seen = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    buffer += chunks[chunkIndex];
    chunks[chunkIndex] = "";
    if (chunkIndex === 0 && buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);

    while (buffer.length) {
      const channelStart = buffer.indexOf("<channel");
      const programmeStart = buffer.indexOf("<programme");
      const starts = [channelStart, programmeStart].filter((value) => value >= 0);
      if (!starts.length) {
        if (buffer.length > 32) {
          consumedChars += buffer.length - 32;
          buffer = buffer.slice(-32);
        }
        break;
      }

      const start = Math.min(...starts);
      if (start > 0) {
        consumedChars += start;
        buffer = buffer.slice(start);
      }
      const isProgramme = buffer.startsWith("<programme");
      const openLength = isProgramme ? 10 : 8;
      const closeTag = isProgramme ? "</programme>" : "</channel>";
      const gt = buffer.indexOf(">");
      if (gt === -1) break;
      const end = buffer.indexOf(closeTag, gt + 1);
      if (end === -1) break;

      const head = buffer.slice(openLength, gt);
      const body = buffer.slice(gt + 1, end);
      const blockLength = end + closeTag.length;
      if (isProgramme) {
        const channelId = xmlAttr(head, "channel");
        const startIso = parseXmltvTime(xmlAttr(head, "start"));
        if (channelId && startIso && Date.parse(startIso) <= maxStart) {
          const parsedStop = parseXmltvTime(xmlAttr(head, "stop"));
          if (!(parsedStop && Date.parse(parsedStop) < minStop)) {
            const startMs = Date.parse(startIso);
            const parsedStopMs = parsedStop ? Date.parse(parsedStop) : NaN;
            const stop = Number.isFinite(parsedStopMs) && parsedStopMs > startMs && parsedStopMs - startMs <= 24 * 3600 * 1000
              ? parsedStop
              : new Date(startMs + 30 * 60000).toISOString();
            (programs[channelId] ||= []).push({
              title: xmlFirstTag(body, "title") || "No Title",
              desc: xmlFirstTag(body, "desc"),
              category: xmlFirstTag(body, "category"),
              start: startIso,
              stop,
            });
          }
        }
        seen++;
      } else {
        const channelId = xmlAttr(head, "id");
        if (channelId) {
          const displayName = xmlFirstTag(body, "display-name");
          if (displayName) channelNames[channelId] = displayName;
          const iconStart = body.indexOf("<icon");
          if (iconStart !== -1) {
            const iconEnd = body.indexOf(">", iconStart);
            if (iconEnd !== -1) {
              const src = xmlAttr(body.slice(iconStart + 5, iconEnd), "src");
              if (src) icons[channelId] = https(src);
            }
          }
        }
      }

      consumedChars += blockLength;
      buffer = buffer.slice(blockLength);
      if (seen > 0 && seen % 80 === 0) {
        sink.onProgress?.(Math.min(0.995, consumedChars / totalChars));
        await nextTick();
      }
    }
    sink.onProgress?.(Math.min(0.995, consumedChars / totalChars));
    await nextTick();
  }

  const channelIds = Object.keys(programs);
  for (let index = 0; index < channelIds.length; index++) {
    programs[channelIds[index]].sort((a, b) => a.start.localeCompare(b.start));
    if (index > 0 && index % 32 === 0) await nextTick();
  }
  sink.onProgress?.(1);
  return { icons, channelNames, programs };
}

// UI subscribers (the store) get notified when channels first appear and again
// when the background EPG parse finishes.
let listeners: (() => void)[] = [];
export function subscribeSource(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {}
  });
}

// ---- EPG load progress (for the on-screen status bar + ETA) ----------------
export type LoadPhase = "idle" | "channels" | "downloading" | "decompressing" | "parsing" | "indexing" | "caching" | "ready" | "error";
export type EpgProgress = {
  phase: LoadPhase;
  ratio: number; // 0..1 across the whole EPG step (download + parse)
  etaSeconds: number | null;
};
let progress: EpgProgress = { phase: "idle", ratio: 0, etaSeconds: null };
let progressListeners: ((p: EpgProgress) => void)[] = [];
export function subscribeProgress(fn: (p: EpgProgress) => void): () => void {
  progressListeners.push(fn);
  fn(progress);
  return () => {
    progressListeners = progressListeners.filter((l) => l !== fn);
  };
}
let lastProgressEmit = 0;
function setProgress(p: Partial<EpgProgress>, force = false) {
  progress = { ...progress, ...p };
  const now = Date.now();
  if (!force && now - lastProgressEmit < 150) return;
  lastProgressEmit = now;
  const snap = progress;
  progressListeners.forEach((l) => {
    try {
      l(snap);
    } catch {}
  });
}
