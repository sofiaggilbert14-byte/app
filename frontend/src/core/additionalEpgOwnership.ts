let ownedChannelIds = new Set<string>();
let revision = 0;

export function replaceAdditionalEpgOwners(ids: Iterable<string>): number {
  const next = new Set(Array.from(ids).map((id) => String(id || "").trim()).filter(Boolean));
  let changed = next.size !== ownedChannelIds.size;
  if (!changed) {
    for (const id of next) {
      if (!ownedChannelIds.has(id)) { changed = true; break; }
    }
  }
  if (changed) {
    ownedChannelIds = next;
    revision += 1;
  }
  return revision;
}

export function additionalEpgOwnsChannel(channelId: string): boolean {
  return ownedChannelIds.has(String(channelId || "").trim());
}

export function additionalEpgOwnershipRevision(): number {
  return revision;
}
