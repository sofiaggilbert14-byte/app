# Purple Next Phase 1 baseline

Baseline commit: `8380c7da39915ed22556a0b2f96f16527ebc189b` (PR #36).

## Automated gates

- `npm test`: dependency-free Node tests for playlist parsing, XMLTV timestamps and stop fallback, favorites migration, backup/restore matching, player engine/header policy, rapid-scan policy, and PR #36 source wiring.
- `npm run benchmark:phase1`: deterministic synthetic workload that records playlist throughput, heap delta, favorite sanitation time, and 100,000 XMLTV timestamp parses.
- `npm run typecheck` and `npm run lint`: existing static validation.
- `purple-next-ci.yml`: runs the gates and produces a side-by-side Android APK for every push to `next/purple-production`.

Benchmark results are descriptive baselines, not universal pass/fail thresholds. Hardware, Node runtime, thermal state, and background load must be recorded with each comparison. A change is a regression candidate when the median of five clean runs worsens by more than 15% on the same machine.

## Required measurements on target TV hardware

Record these for the known-good APK and each RC candidate:

| Measurement | Start | Stop | Sample count |
|---|---|---|---:|
| Cached launch to first guide focus | App process stopped | First D-pad focus visible | 5 |
| Guide vertical surf | First channel | 100th Down event completed | 5 |
| Preview startup | Focus settled | First playing frame/audio | 10 |
| Fullscreen zap | Next/Previous press | First playing frame/audio | 20 |
| Guide→player→guide cycle | Guide focus | Original logical focus restored | 20 |
| Soak memory | Fresh launch | After two hours mixed surfing | 1 |

Capture median, p95, failures, peak Java heap, native heap, graphics memory, decoder count, and any orphaned audio.
