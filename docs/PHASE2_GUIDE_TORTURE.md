# Purple Next Phase 2 — guide torture testing

Baseline: `da481107148bc7bf10a70882756920a6655de5df` (completed Phase 1).

## Approved channel rail

The cinematic timeline keeps the optional channel number at the left, the logo next, and a two-line channel name to the right of the logo. Rail width, logo size, typography, and row height are calculated together for 720p-class and 1080p-class layouts and for every density setting. Program rows inherit the same height, so channel and program focus targets stay aligned.

## Automated torture gate

`npm run torture:guide` performs deterministic stress simulation with:

- 240 channel rows;
- 25 full held-Down/held-Up passes with rapid direction reversals;
- 1,000 group resets;
- 5,000 channel-rail/timeline left-boundary transitions;
- bounds assertions proving focus never moves above row zero or below the final row;
- layout checks across 720, 1280, and 1920 widths and large, normal, and compact guide densities.

The shared navigation policy is consumed by both cinematic and compact guide implementations, so the tests exercise the same top, bottom, and rail boundary decisions used by the app.

## Physical-device certification

Automation cannot prove Android's native focus engine, decoder behavior, or FlashList frame pacing on real hardware. Before RC1, run the following on at least one weak Fire TV Stick and one newer Fire TV/Android TV device:

- hold Down through 100+ channels, immediately reverse, and repeat five times;
- move channel rail → current program → future programs → channel rail repeatedly;
- switch groups 50 times and confirm the selected group retains focus;
- open and close future-program details 25 times with Back and X;
- repeat guide → preview → player → guide 25 times;
- refresh the guide while browsing and confirm the focused row remains populated;
- verify Back from the guide returns to the expected shell destination;
- record dropped focus, blank rows, duplicate audio, decoder failures, and peak memory.

Attach the device models, OS versions, APK SHA-256, and results to the RC evidence. Any disappearing guide, unrecoverable focus loss, or leaked preview audio remains an RC1 blocker.
