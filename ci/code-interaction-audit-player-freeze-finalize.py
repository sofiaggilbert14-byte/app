from pathlib import Path
import runpy

stream_path = Path("frontend/src/components/StreamPlayer.tsx")
stream = stream_path.read_text(encoding="utf-8")

# Remove the legacy clock-only Media3 recovery gate if it is still present.
# If a prior repair already converted it, leave the source untouched.
stream = stream.replace("const MEDIA3_FROZEN_CLOCK_MS = 9000;\n", "")
clock_gate = '''      const bufferingSince = bufferingSinceRef.current;
      // Media3 may wedge while still reporting readyToPlay. Poll its actual
      // playback clock directly; once this fullscreen decoder has genuinely played,
      // a stale clock is authoritative even if Media3's playing flag also dropped.
      // This keeps recovery independent of sparse JS timeUpdate delivery.
      const frozenReadyClock =
        bufferingSince == null &&
        hasPlayedRef.current &&
        mediaReady &&
        now - lastPlaybackAdvanceAtRef.current >= MEDIA3_FROZEN_CLOCK_MS;
      if (bufferingSince == null && !frozenReadyClock) return;
      const bufferingFor = bufferingSince != null
        ? now - bufferingSince
        : now - lastPlaybackAdvanceAtRef.current;
      if (bufferingFor < (bufferingSince != null ? BUFFERING_RESYNC_MS : MEDIA3_FROZEN_CLOCK_MS)) return;'''
explicit_gate = '''      const bufferingSince = bufferingSinceRef.current;
      // TiViMate-style ownership: only an explicit post-playback Media3
      // loading/buffering state may tear down/reprepare this live decoder.
      // Live IPTV clocks can pause, jump or emit sparse JS time updates while
      // video is healthy; clock silence alone must never reload the source.
      if (bufferingSince == null) return;
      const bufferingFor = now - bufferingSince;
      if (bufferingFor < BUFFERING_RESYNC_MS) return;'''

if clock_gate in stream:
    stream = stream.replace(clock_gate, explicit_gate, 1)
elif explicit_gate not in stream:
    raise SystemExit("Media3 recovery gate is neither legacy nor converged")

stream_path.write_text(stream, encoding="utf-8")

# The convergence repair owns the remaining release-before-error, forced-engine,
# explicit fullscreen, scanner and one-resync changes.
runpy.run_path("ci/code-interaction-audit-player-freeze-converge.py", run_name="__main__")
print("CharmIPTV player freeze finalizer applied")
