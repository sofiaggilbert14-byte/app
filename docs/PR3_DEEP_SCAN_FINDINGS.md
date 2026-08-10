# PR #3 Deep Scan Findings

## Outcome

The source-level Guide, focus, EPG, cache, reminder, drawer, player, settings,
backend, and CI scan is complete. Frontend type checking and lint pass, native
configuration generation passes, all 103 frontend tests pass, all 15 Cloudflare
tests pass, and backend Python source compiles. No APK was generated.

## Important defects found and fixed during the scan

1. **Native Left self-lock could defeat the preview handoff.** Channel rows still
   pointed Left back to themselves while JavaScript requested the Play button.
   Rows now use an explicit native `nextFocusLeft` link to Play, with the existing
   retry as a fallback.
2. **Runway delivery was only two-tiered.** It is now applied as focused row,
   next two directional rows, current visible page, then the remaining bounded
   five-ahead/two-behind runway. Newer runways supersede obsolete tails.
3. **Failed native EPG staging could retain partial temporary rows.** Any
   network, parse, storage, or finalization failure now clears staging while the
   live table stays transactionally unchanged.
4. **Unknown-length feeds had only a preflight storage estimate.** Storage is
   now rechecked every 32 streamed batches so chunked/gzipped feeds fail safely
   before exhausting the device.
5. **The non-Android metadata cache still used delete-then-move.** It now verifies
   the temporary file, rotates a valid backup, promotes, verifies again, and
   restores the backup on failure.
6. **Memory pressure could leave Guide logos hidden for the whole session when
   preview was disabled.** Logo suppression now has a pressure-sensitive quiet
   period and safely resumes from disk cache.
7. **A startup health-check timer had no unmount cleanup.** It is now canceled
   when the store provider is disposed.
8. **Some vendor codec ranges can report unrealistic maximum dimensions.** The
   diagnostic now rejects nonsensical values above 16,384 pixels.
9. **Playback buffer preference could reread storage on each preview remount.**
   Loading is now process-cached and coalesced.

## Remaining release blockers and choices

### 1. Android native compilation has not run on this laptop — blocker

No JDK or Android SDK is installed in the available local paths.

- **Option A — recommended:** restore GitHub CLI access, push the branch, and let
  the compile-only Android workflow validate Kotlin/Gradle before any APK job.
  Example result to require: native compile, Expo doctor, tests, and config-drift
  verification all green.
- **Option B:** install Android Studio with its bundled JDK and Android SDK, then
  run the repository's native compile gate locally.
- **Option C:** use another controlled build runner with JDK 17 and the pinned
  Android SDK. Do not accept an APK from a runner that skipped the compile gate.

### 2. GitHub publishing is blocked by expired CLI credentials — blocker

The browser session is signed in, but both locally stored `gh` tokens are
invalid. Local commits are safe; PR #3 cannot be updated or checked from this
machine until authentication is restored.

- **Option A — recommended:** run `gh auth login -h github.com`, choose HTTPS and
  browser authentication, then verify `gh auth status` names the repository
  owner.
- **Option B:** repair Windows Git Credential Manager and use Git HTTPS for the
  push, then inspect PR #3 checks in the browser.
- **Option C:** manually upload patches in GitHub. This is slower and makes it
  easier to omit generated-native parity, so it is the least desirable option.

### 3. Physical Android TV focus/performance validation remains — blocker before release

Static tests cannot prove OEM FocusFinder, decoder, GPU, and low-memory behavior.

- **Option A — recommended:** test one low-end Fire TV profile and one modern
  Android TV. Hold Up/Down for 60 seconds, reverse direction, perform page jumps,
  enter/leave preview actions, switch groups, and repeat for ten minutes.
- **Option B:** use an emulator capped to two CPU cores and low RAM for an early
  signal, then still run a shorter real-device acceptance pass.
- **Option C:** ship only to a small internal tester group with rollback to the
  prior APK. Example stop condition: any blank row, channel-one jump, focus loss,
  sustained memory growth above 25%, or decoder overlap.

### 4. Backend pytest cannot run in the bundled Python environment — validation gap

Python source compilation passes, but the local runtime does not include
`pytest` or the backend dependency set.

- **Option A — recommended:** use the pinned CI backend test job after GitHub
  authentication is restored.
- **Option B:** create an isolated local virtual environment and install
  `backend/requirements.txt`, then run `pytest backend/tests/test_iptv_api.py`.
- **Option C:** accept compile-only validation for this Guide-focused change,
  because the backend code was not changed in the final local patch, while still
  requiring CI before release.

## Remaining non-blocking risks and recommendations

### 5. Non-Android XMLTV parsing still uses JavaScript memory

The Android APK uses streamed Kotlin parsing and SQLite, so this does not affect
the target Fire TV build. Web/iOS fallback can still experience a large memory
peak on very large feeds.

- **Option A — recommended for future web work:** parse in a Web Worker and
  commit chunks to IndexedDB.
- **Option B:** preprocess XMLTV in the Cloudflare/backend builder and deliver
  bounded Guide windows.
- **Option C:** retain the current incremental-yield fallback but document a
  smaller feed limit for preview platforms.

### 6. Native refresh work is coalesced and stale-guarded, not hard-canceled

Only one EPG refresh can run, and obsolete SQLite window results are ignored,
so repeated requests do not create an unbounded queue. An in-progress provider
download is not explicitly canceled unless the native module is invalidated.

- **Option A — recommended now:** keep coalescing; canceling a nearly complete
  refresh can waste more work and complicate last-good finalization.
- **Option B:** add a native generation token checked between XML batches and a
  method that disconnects the active HTTP connection.
- **Option C:** move scheduled refreshes to WorkManager with unique work and
  cancellation, while keeping foreground Guide reads on the query executor.

### 7. Codec reporting is advertised capability, not guaranteed throughput

A device may advertise HEVC/AV1 but still fail a high-bitrate or unusual stream.

- **Option A — recommended:** keep the report diagnostic-only and rely on the
  remembered successful engine plus one bounded fallback.
- **Option B:** add tester-only sample playback checks for common codecs and
  resolutions.
- **Option C:** maintain a device-model compatibility table, but only after
  collecting evidence; avoid hardcoded assumptions from one TV.

### 8. Subtitle size/background remain stored preferences only

- **Option A — recommended:** keep the honest Settings note until the native
  renderer exposes reliable styling.
- **Option B:** implement Media3 subtitle-view styling first, with VLC documented
  as engine-dependent.
- **Option C:** remove the two appearance choices until both engines support
  them. This is clearer but removes an already retained setting.

### 9. A known Metro build-time image parser advisory remains

- **Option A — recommended:** keep repository-controlled image assets and update
  when Expo's compatible dependency line contains the upstream fix.
- **Option B:** use a package override only after the complete frontend and Expo
  doctor gates pass.
- **Option C:** remove the affected build tooling only if Expo no longer requires
  it; do not replace runtime logo handling, which uses bounded `expo-image` work.

## Recommendation before an APK

Restore GitHub authentication, push this branch, run the native compile and CI
gates, then perform the low-end/high-end Android TV focus checklist. Generate a
tester APK only if those gates pass; do not merge PR #3 until device results are
recorded.
