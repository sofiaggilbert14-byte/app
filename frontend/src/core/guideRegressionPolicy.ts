export const RAPID_DIRECTIONAL_WINDOW_MS = 220;
/** Faster resume after surf pause — long settles made focus feel stuck behind the remote. */
export const DECODER_RESUME_SETTLE_MS = 480;

export type TvDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";

export function routeAcceptsRapidScanKey(route: string, key: string): key is TvDirection {
  if (route === "/guide") return key === "UP" || key === "DOWN" || key === "LEFT" || key === "RIGHT";
  if (route === "/player") return key === "LEFT" || key === "RIGHT";
  return false;
}

export function isRapidDirectionalScan(lastDirectionalAt: number, now: number): boolean {
  return lastDirectionalAt > 0 && now - lastDirectionalAt <= RAPID_DIRECTIONAL_WINDOW_MS;
}
