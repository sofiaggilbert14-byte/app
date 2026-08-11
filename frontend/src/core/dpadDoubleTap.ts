export type VerticalDpadKey = "UP" | "DOWN";

/**
 * Max gap between two completed short taps that still counts as a page jump.
 * Keep this tight so only rapid succession doubles jump; slower pairs remain
 * two normal single-row moves. Reliability comes from not dropping the second
 * tap during FlashList focus flicker — not from widening this window.
 */
export const DPAD_DOUBLE_TAP_WINDOW_MS = 300;

export type DpadDoubleTapDetector = {
  push: (key: VerticalDpadKey, at?: number) => VerticalDpadKey | null;
  reset: () => void;
};

/**
 * Consumes completed short taps emitted by Android. Held-key repeats never reach
 * this detector, so a long press cannot accidentally become a page jump.
 */
export function createDpadDoubleTapDetector(
  windowMs = DPAD_DOUBLE_TAP_WINDOW_MS,
): DpadDoubleTapDetector {
  let lastKey: VerticalDpadKey | null = null;
  let lastAt = 0;
  return {
    push(key, at = Date.now()) {
      // Allow same-millisecond completions — ultra-fast doubles can share Date.now().
      const matched = key === lastKey && lastAt > 0 && at - lastAt >= 0 && at - lastAt <= windowMs;
      if (matched) {
        lastKey = null;
        lastAt = 0;
        return key;
      }
      lastKey = key;
      lastAt = at;
      return null;
    },
    reset() {
      lastKey = null;
      lastAt = 0;
    },
  };
}
