/** User EPG overrides — manual remaps + browse filters. */

export type EpgGuideFilter = "all" | "matched" | "unmatched";

export type EpgManualRemap = Record<string, string>;

export function sanitizeEpgManualRemap(raw: unknown): EpgManualRemap {
  if (!raw || typeof raw !== "object") return {};
  const out: EpgManualRemap = {};
  for (const [channelId, sourceId] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(channelId || "").trim();
    const src = String(sourceId || "").trim();
    if (!id || !src || id.length > 160 || src.length > 160) continue;
    if (id.includes("://") || src.includes("://")) continue;
    out[id] = src;
  }
  return out;
}

export function resolveEpgGuideFilter(value: string | null | undefined): EpgGuideFilter {
  if (value === "matched" || value === "unmatched" || value === "all") return value;
  return "all";
}

/** Apply manual remaps after automatic matching (user wins). */
export function applyManualEpgRemaps<T extends { id: string; tvg_id: string }>(
  channels: T[],
  remaps: EpgManualRemap,
): T[] {
  if (!remaps || !Object.keys(remaps).length) return channels;
  let changed = false;
  const next = channels.map((channel) => {
    const mapped = remaps[channel.id];
    if (!mapped || mapped === channel.tvg_id) return channel;
    changed = true;
    return { ...channel, tvg_id: mapped };
  });
  return changed ? next : channels;
}

export function channelHasEpgMatch(channel: { tvg_id?: string; id: string; programs?: unknown[] }): boolean {
  const programs = channel.programs;
  if (Array.isArray(programs) && programs.length > 0) return true;
  const tvg = String(channel.tvg_id || "").trim();
  if (!tvg) return false;
  // Raw stream ids reused as tvg_id usually mean “no real EPG identity”.
  return tvg !== String(channel.id || "").trim();
}
