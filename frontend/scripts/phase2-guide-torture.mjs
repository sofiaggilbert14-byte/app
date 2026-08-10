import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getGuideRailMetrics, getGuideRailNameWidth } from "../src/core/guideLayoutPolicy.ts";
import { runGuideTortureSimulation } from "../src/core/guideTorture.ts";

const started = performance.now();
const simulation = runGuideTortureSimulation({
  channelCount: Number(process.env.CHARM_TORTURE_CHANNELS || 240),
  cycles: Number(process.env.CHARM_TORTURE_CYCLES || 25),
  groupSwitches: 1_000,
  horizontalTransitions: 5_000,
});
const elapsedMs = performance.now() - started;
const layouts = [720, 1280, 1920].flatMap((width) =>
  ["large", "normal", "compact", "extra_compact"].map((density) => {
    const metrics = getGuideRailMetrics(width, density, true, true);
    return {
      width,
      density,
      ...metrics,
      availableNameWidth: getGuideRailNameWidth(metrics, true, true),
    };
  }),
);

const result = {
  schema: "charmiptv-phase2-guide-torture-v1",
  recordedAt: new Date().toISOString(),
  runtime: process.version,
  platform: `${process.platform}-${process.arch}`,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulation,
  layouts,
};

const output = process.env.CHARM_TORTURE_OUTPUT;
if (output) {
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));
