import { evaluateGuideNavigation, type GuideFocusRegion } from "./guideNavigationPolicy.ts";

export type GuideTortureResult = {
  channelCount: number;
  cycles: number;
  events: number;
  directionReversals: number;
  bottomLocks: number;
  topBoundaries: number;
  groupSwitches: number;
  horizontalTransitions: number;
  finalRow: number;
};

export function runGuideTortureSimulation(options: {
  channelCount?: number;
  cycles?: number;
  groupSwitches?: number;
  horizontalTransitions?: number;
} = {}): GuideTortureResult {
  const channelCount = Math.max(2, Math.floor(options.channelCount || 180));
  const cycles = Math.max(1, Math.floor(options.cycles || 12));
  const groupSwitches = Math.max(1, Math.floor(options.groupSwitches || 250));
  const horizontalTransitions = Math.max(1, Math.floor(options.horizontalTransitions || 1_000));
  const lastRow = channelCount - 1;
  let row = 0;
  let events = 0;
  let bottomLocks = 0;
  let topBoundaries = 0;
  let directionReversals = 0;

  const move = (key: "up" | "down", focusRegion: GuideFocusRegion = "program") => {
    const decision = evaluateGuideNavigation({
      active: true,
      key,
      gridOwnsFocus: true,
      focusRegion,
      focusedRow: row,
      lastRow,
    });
    events += 1;
    if (decision.boundary === "bottom-lock") bottomLocks += 1;
    else if (decision.boundary === "top-boundary") topBoundaries += 1;
    else row += key === "down" ? 1 : -1;
    if (row < 0 || row > lastRow) throw new Error(`Guide focus escaped row bounds: ${row}`);
  };

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (let i = 0; i < channelCount + 25; i += 1) move("down");
    directionReversals += 1;
    for (let i = 0; i < channelCount + 25; i += 1) move("up");
    directionReversals += 1;
  }

  for (let index = 0; index < groupSwitches; index += 1) {
    row = (index * 37) % channelCount;
    row = 0;
    const decision = evaluateGuideNavigation({
      active: true,
      key: "right",
      gridOwnsFocus: true,
      focusRegion: "channel",
      focusedRow: row,
      lastRow,
    });
    events += 1;
    if (decision.boundary !== null) throw new Error("Group reset created an invalid right boundary");
  }

  for (let index = 0; index < horizontalTransitions; index += 1) {
    const focusRegion: GuideFocusRegion = index % 2 === 0 ? "channel" : "program";
    const decision = evaluateGuideNavigation({
      active: true,
      key: "left",
      gridOwnsFocus: true,
      focusRegion,
      focusedRow: row,
      lastRow,
    });
    events += 1;
    if (focusRegion === "channel" && decision.boundary !== "left-boundary") {
      throw new Error("Channel rail did not expose its left boundary");
    }
    if (focusRegion === "program" && decision.boundary !== null) {
      throw new Error("Program timeline escaped left before reaching the channel rail");
    }
  }

  return {
    channelCount,
    cycles,
    events,
    directionReversals,
    bottomLocks,
    topBoundaries,
    groupSwitches,
    horizontalTransitions,
    finalRow: row,
  };
}
