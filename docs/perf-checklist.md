# Performance checklist for Fire TV 4K

This checklist contains the prioritized tasks and validation steps to improve startup, memory usage, and frame smoothness on low-end Android devices (e.g. Fire TV 4K).

1) Build & packaging
- Enable R8 (minify) and resource shrinking for release builds.
- Build as AAB and enable ABI splits (armeabi-v7a, arm64-v8a) to avoid shipping unused native code.
- Strip native debug symbols from release artifacts.

2) JS runtime & bundle
- Enable Hermes for Android builds (verify compatibility).
- Enable inline-requires and RAM bundles in Metro for production.
- Produce a minified production bundle and verify with sourcemaps if needed.

3) Images & video
- Always decode images to the target view size; avoid loading full-resolution bitmaps.
- Limit memory cache sizes and concurrent decodes.
- Use conservative ExoPlayer buffer sizes and adaptive bitrate defaults for low-tier devices.

4) UI & lists
- Replace large ScrollViews with FlatList/VirtualizedList and use getItemLayout.
- Memoize row components and avoid inline style objects and handlers.
- Throttle/debounce heavy scroll-linked work; avoid doing heavy computation in onScroll.

5) State & renders
- Reduce global store churn; move ephemeral UI state local.
- Batch high-frequency updates and use selectors to limit re-renders.

6) Diagnostics
- Add LeakCanary and StrictMode in debug builds only.
- Add Crashlytics or Sentry scaffolding (no API keys in repo).
- Collect Perfetto traces and memory dumps for verification.

Validation steps (on-device)
- Cold start (time to first frame), memory usage (Android Profiler), and max RSS during a 60s heavy interaction.
- Record a Perfetto trace during worst-case interactions (open timeline, scroll fast, open program modal, start playback).
- Verify no new crashes or ANRs appear after enabling Hermes and R8.

Notes
- Apply changes incrementally and validate after each step. Some changes (Hermes, minify) may expose latent bugs that need small code fixes.
