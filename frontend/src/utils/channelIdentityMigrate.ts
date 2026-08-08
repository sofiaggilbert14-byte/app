import type { Channel } from "@/src/api";

/**
 * Remap stored channel IDs after Phase 4 identity changes.
 * Prefer exact id, then unique tvg_id, then unique name. Never invent matches.
 */
export function remapStoredChannelIds(
  storedIds: string[],
  channels: Channel[],
): { ids: string[]; remapped: number } {
  if (!storedIds.length || !channels.length) return { ids: storedIds, remapped: 0 };

  const byId = new Map<string, Channel>();
  const byTvg = new Map<string, Channel[]>();
  const byName = new Map<string, Channel[]>();
  for (const channel of channels) {
    byId.set(channel.id, channel);
    const tvg = (channel.tvg_id || "").trim();
    if (tvg) {
      const list = byTvg.get(tvg) || [];
      list.push(channel);
      byTvg.set(tvg, list);
    }
    const name = (channel.name || "").trim().toLowerCase();
    if (name) {
      const list = byName.get(name) || [];
      list.push(channel);
      byName.set(name, list);
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  let remapped = 0;

  for (const raw of storedIds) {
    const id = (raw || "").trim();
    if (!id) continue;
    if (byId.has(id)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
      continue;
    }

    // Legacy collision suffix: base#index → try base as tvg-id / slug.
    const base = id.includes("#") ? id.slice(0, id.indexOf("#")) : id.includes("~") ? id.slice(0, id.indexOf("~")) : id;
    let next: string | null = null;
    const tvgHits = byTvg.get(base) || [];
    if (tvgHits.length === 1) next = tvgHits[0].id;
    if (!next) {
      const nameHits = byName.get(base.replace(/-/g, " ").toLowerCase()) || byName.get(base.toLowerCase()) || [];
      if (nameHits.length === 1) next = nameHits[0].id;
    }
    if (!next) {
      // Keep orphan so we do not wipe favorites on partial playlists.
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
      continue;
    }
    remapped += 1;
    if (!seen.has(next)) {
      seen.add(next);
      out.push(next);
    }
  }

  return { ids: out, remapped };
}
