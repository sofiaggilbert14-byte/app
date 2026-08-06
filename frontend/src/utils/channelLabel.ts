/** Shared channel number formatting across guide, favorites, search, and player. */
export function formatChannelLabel(
  name: string,
  options?: { number?: number | null; showNumber?: boolean },
): string {
  const label = name || "Channel";
  if (!options?.showNumber || !options.number) return label;
  return `${options.number} · ${label}`;
}
