import type { Program } from "@/src/api";

export type GuideLogicalKey = "UP" | "DOWN" | "LEFT" | "RIGHT";
export type GuideLogicalRegion = "channel" | "program";

export type GuideLogicalCursor = {
  rowIndex: number;
  region: GuideLogicalRegion;
  /** Absolute epoch time retained while moving vertically between channels. */
  timeAnchorMs: number;
};

export type GuideLogicalMove = {
  cursor: GuideLogicalCursor;
  boundary: "top" | "bottom" | "left" | null;
};

type TimedProgram = {
  program: Program;
  startMs: number;
  endMs: number;
};

function timedPrograms(programs: readonly Program[]): TimedProgram[] {
  const out: TimedProgram[] = [];
  for (const program of programs) {
    const startMs = Date.parse(program.start);
    const stopMs = program.stop ? Date.parse(program.stop) : Number.NaN;
    const endMs = Number.isFinite(stopMs) && stopMs > startMs
      ? stopMs
      : startMs + 30 * 60_000;
    if (!Number.isFinite(startMs) || endMs <= startMs) continue;
    out.push({ program, startMs, endMs });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export function clampGuideTimeAnchor(anchorMs: number, windowStartMs: number, windowEndMs: number): number {
  const start = Number.isFinite(windowStartMs) ? windowStartMs : 0;
  const end = Number.isFinite(windowEndMs) && windowEndMs > start ? windowEndMs : start + 1;
  const anchor = Number.isFinite(anchorMs) ? anchorMs : start;
  return Math.max(start, Math.min(end - 1, anchor));
}

/** Resolve the programme that owns the time column, falling back to the nearest interval. */
export function resolveGuideProgramAtTime(
  programs: readonly Program[],
  timeAnchorMs: number,
): Program | null {
  const timed = timedPrograms(programs);
  if (!timed.length) return null;
  const containing = timed.find(({ startMs, endMs }) => timeAnchorMs >= startMs && timeAnchorMs < endMs);
  if (containing) return containing.program;
  let best = timed[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of timed) {
    const distance = timeAnchorMs < candidate.startMs
      ? candidate.startMs - timeAnchorMs
      : timeAnchorMs - candidate.endMs;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.program;
}

export function guideProgramCenterMs(program: Program, fallbackMs: number): number {
  const startMs = Date.parse(program.start);
  const stopMs = program.stop ? Date.parse(program.stop) : Number.NaN;
  if (!Number.isFinite(startMs)) return fallbackMs;
  const endMs = Number.isFinite(stopMs) && stopMs > startMs ? stopMs : startMs + 30 * 60_000;
  return startMs + Math.max(1, endMs - startMs) / 2;
}

/**
 * Pure channel/time navigation policy. It never consults native view geometry,
 * so fast repeats and direction reversals cannot choose a different column.
 */
export function moveGuideLogicalCursor(input: {
  cursor: GuideLogicalCursor;
  key: GuideLogicalKey;
  lastRowIndex: number;
  programs: readonly Program[];
  windowStartMs: number;
  windowEndMs: number;
}): GuideLogicalMove {
  const { key } = input;
  const lastRow = Math.max(0, Math.floor(input.lastRowIndex || 0));
  const current: GuideLogicalCursor = {
    ...input.cursor,
    rowIndex: Math.max(0, Math.min(lastRow, Math.floor(input.cursor.rowIndex || 0))),
    timeAnchorMs: clampGuideTimeAnchor(input.cursor.timeAnchorMs, input.windowStartMs, input.windowEndMs),
  };

  if (key === "UP") {
    if (current.rowIndex === 0) return { cursor: current, boundary: "top" };
    return { cursor: { ...current, rowIndex: current.rowIndex - 1 }, boundary: null };
  }
  if (key === "DOWN") {
    if (current.rowIndex >= lastRow) return { cursor: current, boundary: "bottom" };
    return { cursor: { ...current, rowIndex: current.rowIndex + 1 }, boundary: null };
  }
  if (key === "LEFT" && current.region === "channel") {
    return { cursor: current, boundary: "left" };
  }

  const programs = timedPrograms(input.programs);
  if (!programs.length) {
    if (key === "RIGHT" && current.region === "channel") {
      return { cursor: { ...current, region: "program" }, boundary: null };
    }
    const step = key === "RIGHT" ? 30 * 60_000 : key === "LEFT" ? -30 * 60_000 : 0;
    return {
      cursor: {
        ...current,
        region: "program",
        timeAnchorMs: clampGuideTimeAnchor(current.timeAnchorMs + step, input.windowStartMs, input.windowEndMs),
      },
      boundary: null,
    };
  }

  const selected = resolveGuideProgramAtTime(programs.map(({ program }) => program), current.timeAnchorMs);
  const selectedIndex = Math.max(0, programs.findIndex(({ program }) => program === selected));
  if (key === "RIGHT") {
    const targetIndex = current.region === "channel" ? selectedIndex : Math.min(programs.length - 1, selectedIndex + 1);
    const target = programs[targetIndex].program;
    return {
      cursor: { ...current, region: "program", timeAnchorMs: guideProgramCenterMs(target, current.timeAnchorMs) },
      boundary: null,
    };
  }
  if (key === "LEFT") {
    if (selectedIndex <= 0) {
      return { cursor: { ...current, region: "channel" }, boundary: null };
    }
    const target = programs[selectedIndex - 1].program;
    return {
      cursor: { ...current, region: "program", timeAnchorMs: guideProgramCenterMs(target, current.timeAnchorMs) },
      boundary: null,
    };
  }
  return { cursor: current, boundary: null };
}
