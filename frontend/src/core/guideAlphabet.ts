export const GUIDE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") as readonly string[];

export type AlphabetChannel = {
  id: string;
  name?: string | null;
};

/** Normalize accents and ignore numeric/punctuation prefixes used by IPTV lists. */
export function guideChannelLetter(name?: string | null): string | null {
  const normalized = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return normalized.match(/[A-Z]/)?.[0] || null;
}

/** Fixed 26-key table keeps alphabet lookup bounded regardless of playlist size. */
export function buildGuideAlphabetTargets<T extends AlphabetChannel>(
  channels: readonly T[],
): Readonly<Record<string, string | null>> {
  const targets: Record<string, string | null> = Object.fromEntries(
    GUIDE_ALPHABET.map((letter) => [letter, null]),
  );
  let unresolved = GUIDE_ALPHABET.length;
  for (const channel of channels) {
    const letter = guideChannelLetter(channel.name);
    if (!letter || targets[letter] != null) continue;
    targets[letter] = channel.id;
    unresolved -= 1;
    if (unresolved === 0) break;
  }
  return targets;
}
