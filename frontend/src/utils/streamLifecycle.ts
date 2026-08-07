type StopFn = () => void;

const stops = new Set<StopFn>();

/** Register a stream teardown callback; returns an unregister function. */
export function registerStreamStop(stop: StopFn): () => void {
  stops.add(stop);
  return () => {
    stops.delete(stop);
  };
}

/** Force-stop every mounted decoder (VLC / Media3). Safe to call repeatedly. */
export function forceStopAllStreams() {
  for (const stop of Array.from(stops)) {
    try {
      stop();
    } catch {
      /* ignore individual teardown failures */
    }
  }
}
