from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# StreamPlayer: restore the TiViMate-style explicit-buffering recovery contract.
# A live HLS/TS playback clock can be sparse/discontinuous while frames continue
# rendering. Clock silence alone must never call replaceAsync(), because that
# creates the exact periodic pause -> reload -> fallback -> retry cascade this
# audit is intended to prevent. Only a real post-playback Media3 loading state
# owns silent resync; direct clock polling is retained only to CANCEL a stale
# buffering state when playback is actually advancing.
# ---------------------------------------------------------------------------
stream_path = Path("frontend/src/components/StreamPlayer.tsx")
stream = stream_path.read_text(encoding="utf-8")
stream = stream.replace("const MEDIA3_FROZEN_CLOCK_MS = 9000;\n", "")

clock_gate = '''      const bufferingSince = bufferingSinceRef.current;\n      // Media3 may wedge while still reporting readyToPlay. Poll its actual\n      // playback clock directly; once this fullscreen decoder has genuinely played,\n      // a stale clock is authoritative even if Media3's playing flag also dropped.\n      // This keeps recovery independent of sparse JS timeUpdate delivery.\n      const frozenReadyClock =\n        bufferingSince == null &&\n        hasPlayedRef.current &&\n        mediaReady &&\n        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;\n      if (bufferingSince == null && !frozenReadyClock) return;\n      const bufferingFor = bufferingSince != null\n        ? now - bufferingSince\n        : now - lastPlaybackAdvanceAtRef.current;\n      if (bufferingFor < (bufferingSince != null ? BUFFERING_RESYNC_MS : MEDIA3_FROZEN_CLOCK_MS)) return;'''
explicit_gate = '''      const bufferingSince = bufferingSinceRef.current;\n      // TiViMate-style ownership: only an explicit post-playback Media3\n      // loading/buffering state may tear down/reprepare this live decoder.\n      // Live IPTV clocks can pause, jump or emit sparse JS time updates while\n      // video is healthy; clock silence alone must never reload the source.\n      if (bufferingSince == null) return;\n      const bufferingFor = now - bufferingSince;\n      if (bufferingFor < BUFFERING_RESYNC_MS) return;'''
stream = replace_once(stream, clock_gate, explicit_gate, "Media3 explicit-buffering recovery gate")
stream_path.write_text(stream, encoding="utf-8")


# ---------------------------------------------------------------------------
# Test contracts: permanently forbid clock-only Media3 source reloads.
# ---------------------------------------------------------------------------
focus_test_path = Path("frontend/tests/playerAndFocus.test.mjs")
focus_test = focus_test_path.read_text(encoding="utf-8")
old_focus_test = '''test("Media3 recovery follows the real playback clock after a stream has played", async () => {\n  const stream = await source("src/components/StreamPlayer.tsx");\n  assert.match(stream, /const MEDIA3_FROZEN_CLOCK_MS = 9000/);\n  assert.match(stream, /const observedPlaybackTime = Number\\(player\\.currentTime\\)/);\n  assert.match(stream, /const frozenReadyClock =/);\n  assert.match(stream, /hasPlayedRef\\.current &&\\s*mediaReady &&\\s*now - lastPlaybackAdvanceAtRef\\.current >= MEDIA3_FROZEN_CLOCK_MS/);\n  assert.doesNotMatch(stream, /Boolean\\(\\(player as any\\)\\.playing\\)/);\n  assert.match(stream, /if \\(bufferingSince == null && !frozenReadyClock\\) return/);\n  assert.doesNotMatch(stream, /const stalledReady =/);\n  assert.match(stream, /const BUFFERING_RESYNC_MS = 5000/);\n  assert.match(stream, /const BUFFERING_FAIL_MS = 22000/);\n});'''
new_focus_test = '''test("Media3 recovery only reparses a real post-playback buffering state", async () => {\n  const stream = await source("src/components/StreamPlayer.tsx");\n  assert.match(stream, /const observedPlaybackTime = Number\\(player\\.currentTime\\)/);\n  assert.match(stream, /if \\(bufferingSince == null\\) return/);\n  assert.match(stream, /const bufferingFor = now - bufferingSince/);\n  assert.doesNotMatch(stream, /MEDIA3_FROZEN_CLOCK_MS/);\n  assert.doesNotMatch(stream, /const frozenReadyClock =/);\n  assert.doesNotMatch(stream, /const stalledReady =/);\n  assert.match(stream, /const BUFFERING_RESYNC_MS = 5000/);\n  assert.match(stream, /const BUFFERING_FAIL_MS = 22000/);\n});'''
focus_test = replace_once(focus_test, old_focus_test, new_focus_test, "playerAndFocus Media3 recovery contract")
focus_test_path.write_text(focus_test, encoding="utf-8")

live_test_path = Path("frontend/tests/playerLiveStability.test.mjs")
live_test = live_test_path.read_text(encoding="utf-8")
old_jitter = '''test("Media3 live reads tolerate provider jitter without disabling bounded decoder recovery", async () => {\n  const [patch, player] = await Promise.all([\n    source("patches/expo-video+3.0.16.patch"),\n    source("src/components/StreamPlayer.tsx"),\n  ]);\n  assert.match(patch, /connectTimeout\\(5, TimeUnit\\.SECONDS\\)/);\n  assert.match(patch, /readTimeout\\(30, TimeUnit\\.SECONDS\\)/);\n  assert.doesNotMatch(patch, /readTimeout\\(5, TimeUnit\\.SECONDS\\)/);\n  assert.match(player, /const MEDIA3_FROZEN_CLOCK_MS = 9000/);\n  assert.match(player, /observedPlaybackTime = Number\\(player\\.currentTime\\)/);\n  assert.match(player, /hasPlayedRef\\.current &&\\s*mediaReady &&\\s*now - lastPlaybackAdvanceAtRef\\.current >= MEDIA3_FROZEN_CLOCK_MS/);\n  assert.doesNotMatch(player, /Boolean\\(\\(player as any\\)\\.playing\\)/);\n  assert.match(player, /MAX_SILENT_BUFFERING_RESYNCS = 2/);\n});'''
new_jitter = '''test("Media3 live reads tolerate provider jitter without clock-only decoder reloads", async () => {\n  const [patch, player] = await Promise.all([\n    source("patches/expo-video+3.0.16.patch"),\n    source("src/components/StreamPlayer.tsx"),\n  ]);\n  assert.match(patch, /connectTimeout\\(5, TimeUnit\\.SECONDS\\)/);\n  assert.match(patch, /readTimeout\\(30, TimeUnit\\.SECONDS\\)/);\n  assert.doesNotMatch(patch, /readTimeout\\(5, TimeUnit\\.SECONDS\\)/);\n  assert.match(player, /observedPlaybackTime = Number\\(player\\.currentTime\\)/);\n  assert.match(player, /if \\(bufferingSince == null\\) return/);\n  assert.match(player, /const bufferingFor = now - bufferingSince/);\n  assert.doesNotMatch(player, /MEDIA3_FROZEN_CLOCK_MS/);\n  assert.doesNotMatch(player, /const frozenReadyClock =/);\n  assert.match(player, /MAX_SILENT_BUFFERING_RESYNCS = 2/);\n});'''
live_test = replace_once(live_test, old_jitter, new_jitter, "live jitter recovery contract")
live_test = live_test.replace(
    '  assert.match(player, /const MEDIA3_FROZEN_CLOCK_MS = 9000/);\n',
    '  assert.match(player, /if \\(bufferingSince == null\\) return/);\n  assert.doesNotMatch(player, /MEDIA3_FROZEN_CLOCK_MS/);\n',
    1,
)
live_test_path.write_text(live_test, encoding="utf-8")


# ---------------------------------------------------------------------------
# Repair-of-repair guard: the general player-stability script previously
# reintroduced the unsafe clock-only gate. Make it converge on the same
# explicit-buffering contract so a future audit rerun cannot regress playback.
# ---------------------------------------------------------------------------
stability_path = Path("ci/code-interaction-audit-player-stability.py")
stability = stability_path.read_text(encoding="utf-8")
old_stability = '''old_frozen = ''' + "'''" + '''      const frozenReadyClock =\\n        bufferingSince == null &&\\n        hasPlayedRef.current &&\\n        Boolean((player as any).playing) &&\\n        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;''' + "'''" + '''\nnew_frozen = ''' + "'''" + '''      const frozenReadyClock =\\n        bufferingSince == null &&\\n        hasPlayedRef.current &&\\n        mediaReady &&\\n        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;''' + "'''" + '''\nstream = replace_once(stream, old_frozen, new_frozen, "Media3 frozen-clock gate")'''
new_stability = '''# Keep the TiViMate-style rebuffer contract: sparse/discontinuous live clocks\n# are not permission to reload a healthy decoder. Only explicit Media3 loading\n# after real playback may arm replaceAsync recovery.\nstream = stream.replace("const MEDIA3_FROZEN_CLOCK_MS = 9000;\\n", "")\nclock_gate = ''' + "'''" + '''      const bufferingSince = bufferingSinceRef.current;\\n      // Media3 may wedge while still reporting readyToPlay. Poll its actual\\n      // playback clock directly; once this fullscreen decoder has genuinely played,\\n      // a stale clock is authoritative even if Media3's playing flag also dropped.\\n      // This keeps recovery independent of sparse JS timeUpdate delivery.\\n      const frozenReadyClock =\\n        bufferingSince == null &&\\n        hasPlayedRef.current &&\\n        mediaReady &&\\n        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;\\n      if (bufferingSince == null && !frozenReadyClock) return;\\n      const bufferingFor = bufferingSince != null\\n        ? now - bufferingSince\\n        : now - lastPlaybackAdvanceAtRef.current;\\n      if (bufferingFor < (bufferingSince != null ? BUFFERING_RESYNC_MS : MEDIA3_FROZEN_CLOCK_MS)) return;''' + "'''" + '''\nexplicit_gate = ''' + "'''" + '''      const bufferingSince = bufferingSinceRef.current;\\n      // TiViMate-style ownership: only an explicit post-playback Media3\\n      // loading/buffering state may tear down/reprepare this live decoder.\\n      // Live IPTV clocks can pause, jump or emit sparse JS time updates while\\n      // video is healthy; clock silence alone must never reload the source.\\n      if (bufferingSince == null) return;\\n      const bufferingFor = now - bufferingSince;\\n      if (bufferingFor < BUFFERING_RESYNC_MS) return;''' + "'''" + '''\nif clock_gate in stream:\n    stream = stream.replace(clock_gate, explicit_gate, 1)\nelif explicit_gate not in stream:\n    raise SystemExit("Media3 explicit-buffering recovery gate not found")'''
stability = replace_once(stability, old_stability, new_stability, "player-stability repair-of-repair")
stability = stability.replace(
    '''      // Media3 may wedge while still reporting readyToPlay. Poll its actual\\n      // playback clock directly; once this fullscreen decoder has genuinely played,\\n      // a stale clock is authoritative even if Media3's playing flag also dropped.\\n      // This keeps recovery independent of sparse JS timeUpdate delivery.''',
    '''      // Media3 recovery is armed only by an explicit post-playback loading state.\\n      // Sparse live clocks are not sufficient evidence to reload a decoder.''',
    1,
)
stability_path.write_text(stability, encoding="utf-8")

preview_repair_path = Path("ci/code-interaction-audit-preview-isolation.py")
preview_repair = preview_repair_path.read_text(encoding="utf-8")
preview_repair = preview_repair.replace(
    '  assert.match(player, /const MEDIA3_FROZEN_CLOCK_MS = 9000/);\\n',
    '  assert.match(player, /if \\\\(bufferingSince == null\\\\) return/);\\n  assert.doesNotMatch(player, /MEDIA3_FROZEN_CLOCK_MS/);\\n',
)
preview_repair_path.write_text(preview_repair, encoding="utf-8")

print("player freeze-bleed repair applied")
