import type { Program } from "@/src/api";

/** Build small ordered native-query batches: focused/visible rows first. */
export function buildGuidePatchTiers(
  channelIds: readonly string[],
  priorityIds: readonly string[],
  leadingLimit = 12,
  tailChunkSize = 24,
): string[][] {
  const ids = Array.from(new Set(channelIds.filter(Boolean)));
  if (!ids.length) return [];
  const idSet = new Set(ids);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of [...priorityIds, ...ids]) {
    if (!idSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  const headSize = Math.max(1, Math.floor(leadingLimit));
  const chunkSize = Math.max(1, Math.floor(tailChunkSize));
  const tiers = [ordered.slice(0, headSize)];
  for (let offset = headSize; offset < ordered.length; offset += chunkSize) {
    tiers.push(ordered.slice(offset, offset + chunkSize));
  }
  return tiers.filter((tier) => tier.length > 0);
}

/** Keep completed SQLite rows that still belong to the latest cache runway. */
export function keepUsefulGuidePatch(
  delta: Readonly<Record<string, Program[]>>,
  keepIds: Iterable<string>,
): Record<string, Program[]> {
  const keep = new Set(Array.from(keepIds).filter(Boolean));
  const useful: Record<string, Program[]> = {};
  for (const [channelId, programs] of Object.entries(delta || {})) {
    if (keep.has(channelId) && Array.isArray(programs)) useful[channelId] = programs;
  }
  return useful;
}
