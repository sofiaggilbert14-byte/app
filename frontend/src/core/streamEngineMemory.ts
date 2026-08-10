import type { Engine } from "@/src/core/streamPolicy";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 128;
const engines = new Map<string, { engine: Engine; at: number }>();

export function getRememberedStreamEngine(streamKey: string): Engine | null {
  const key = streamKey.trim();
  const found = engines.get(key);
  if (!found) return null;
  if (Date.now() - found.at > TTL_MS) {
    engines.delete(key);
    return null;
  }
  // Keep reads pure so React may safely call this while selecting the first
  // player engine. Successful playback refreshes the LRU order below.
  return found.engine;
}

export function rememberSuccessfulStreamEngine(streamKey: string, engine: Engine): void {
  const key = streamKey.trim();
  if (!key) return;
  engines.delete(key);
  engines.set(key, { engine, at: Date.now() });
  while (engines.size > MAX_ENTRIES) {
    const oldest = engines.keys().next().value;
    if (!oldest) break;
    engines.delete(oldest);
  }
}
