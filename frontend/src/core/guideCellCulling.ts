export type PositionedGuideCell = {
  key: string;
  left: number;
  width: number;
};

export type IndexedGuideCell<T extends PositionedGuideCell> = {
  item: T;
  sourceIndex: number;
};

/**
 * Return only cells intersecting the viewport runway. One real neighbor on
 * either side remains mounted for immediate horizontal focus, and the focused
 * native cell is pinned even when a pan moves it outside the normal slice.
 */
export function buildVisibleGuideCellSlice<T extends PositionedGuideCell>(
  items: T[],
  viewportLeft: number,
  viewportWidth: number,
  overscan: number,
  focusedKey?: string | null,
): IndexedGuideCell<T>[] {
  if (!items.length) return [];
  const width = Math.max(1, viewportWidth);
  const left = Math.max(0, viewportLeft - Math.max(0, overscan));
  const right = viewportLeft + width + Math.max(0, overscan);

  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const cell = items[mid];
    if (cell.left + cell.width <= left) lo = mid + 1;
    else hi = mid;
  }
  const firstIntersecting = Math.min(items.length - 1, lo);
  let endExclusive = firstIntersecting;
  while (endExclusive < items.length && items[endExclusive].left < right) endExclusive += 1;

  const selected = new Set<number>();
  const start = Math.max(0, firstIntersecting - 1);
  const end = Math.min(items.length, Math.max(endExclusive + 1, start + 1));
  for (let index = start; index < end; index++) selected.add(index);

  if (focusedKey) {
    const focusedIndex = items.findIndex((item) => item.key === focusedKey);
    if (focusedIndex >= 0) {
      selected.add(focusedIndex);
      if (focusedIndex > 0) selected.add(focusedIndex - 1);
      if (focusedIndex + 1 < items.length) selected.add(focusedIndex + 1);
    }
  }

  return Array.from(selected)
    .sort((a, b) => a - b)
    .map((sourceIndex) => ({ item: items[sourceIndex], sourceIndex }));
}
