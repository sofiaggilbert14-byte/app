let mountedProgramCells = 0;
let lastLogAt = 0;
let largestPreparedRow = 0;
let largestRenderedSlice = 0;

function maybeLog(): void {
  if (!__DEV__ || Date.now() - lastLogAt < 2_000) return;
  lastLogAt = Date.now();
  console.debug("[Guide perf]", {
    mountedProgramCells,
    largestPreparedRow,
    largestRenderedSlice,
  });
  largestPreparedRow = 0;
  largestRenderedSlice = 0;
}

export function noteProgramCellMounted(): () => void {
  if (!__DEV__) return () => undefined;
  mountedProgramCells += 1;
  maybeLog();
  return () => {
    mountedProgramCells = Math.max(0, mountedProgramCells - 1);
    maybeLog();
  };
}

export function noteGuideRowSlice(prepared: number, rendered: number): void {
  if (!__DEV__) return;
  largestPreparedRow = Math.max(largestPreparedRow, prepared);
  largestRenderedSlice = Math.max(largestRenderedSlice, rendered);
  maybeLog();
}
