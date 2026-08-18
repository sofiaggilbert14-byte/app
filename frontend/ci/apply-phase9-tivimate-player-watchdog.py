from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/components/StreamPlayer.tsx"
text = p.read_text(encoding="utf-8")

def rep(old: str, new: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"watchdog anchor mismatch {count}: {old[:120]!r}")
    text = text.replace(old, new, 1)

rep('const FROZEN_VIDEO_WATCHDOG_MS = 15_000;\n', 'const BUFFERING_RESYNC_WATCHDOG_MS = 5_000;\n')
rep(
'''  const lastPlaybackTimeRef = useRef(-1);
  const lastPlaybackAdvanceAtRef = useRef(Date.now());
  const playbackTransportStateRef = useRef<"idle" | "loading" | "ready">("idle");
''',
'''  const bufferingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resyncInFlightRef = useRef(false);
''')
rep(
'''  const emit = useCallback(
    (status: StreamStatus, reason?: SessionFailReason | null) => {
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      setStatus(status, reason);
    },
    [sessionGeneration, sessionRole, setStatus],
  );

  const playerCompat = usePlayerCompatibilityPreferences();
''',
'''  const emit = useCallback(
    (status: StreamStatus, reason?: SessionFailReason | null) => {
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      setStatus(status, reason);
    },
    [sessionGeneration, sessionRole, setStatus],
  );

  const clearBufferingWatchdog = useCallback(() => {
    if (!bufferingWatchdogRef.current) return;
    clearTimeout(bufferingWatchdogRef.current);
    bufferingWatchdogRef.current = null;
  }, []);

  const silentResync = useCallback(() => {
    if (mode === "preview" || paused || blocked || resyncInFlightRef.current) return;
    if (!mountedRef.current || tearingDownRef.current) return;
    if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
    resyncInFlightRef.current = true;
    const contentType = media3ContentType(kind);
    replaceQueueRef.current = replaceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!mountedRef.current || tearingDownRef.current) return;
        if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
        await player.replaceAsync({ uri, headers, contentType });
        if (!paused) player.play();
      })
      .catch(() => {
        if (!mountedRef.current || tearingDownRef.current) return;
        recordFailure(sessionRole, engine, uri, "stream-error");
        emit("error", "stream-error");
      })
      .finally(() => {
        resyncInFlightRef.current = false;
      });
  }, [blocked, emit, engine, headers, kind, mode, paused, player, sessionGeneration, sessionRole, uri]);

  const armBufferingWatchdog = useCallback(() => {
    clearBufferingWatchdog();
    if (mode === "preview" || paused || blocked) return;
    bufferingWatchdogRef.current = setTimeout(() => {
      bufferingWatchdogRef.current = null;
      silentResync();
    }, BUFFERING_RESYNC_WATCHDOG_MS);
  }, [blocked, clearBufferingWatchdog, mode, paused, silentResync]);

  const playerCompat = usePlayerCompatibilityPreferences();
''')
rep(
'''    return () => {
      unregister();
      hardStop();
    };
  }, [hardStop, sessionGeneration, sessionRole]);
''',
'''    return () => {
      unregister();
      clearBufferingWatchdog();
      hardStop();
    };
  }, [clearBufferingWatchdog, hardStop, sessionGeneration, sessionRole]);
''')
rep(
'''      if (status === "readyToPlay") {
        playbackTransportStateRef.current = "ready";
        lastPlaybackTimeRef.current = player.currentTime;
        lastPlaybackAdvanceAtRef.current = Date.now();
        setMediaReady(true);
''',
'''      if (status === "readyToPlay") {
        clearBufferingWatchdog();
        setMediaReady(true);
''')
rep(
'''      } else if (status === "loading") {
        // A provider/HLS rebuffer is not a frozen decoder. Reset the watchdog
        // clock and let Media3 refill rather than tearing down a healthy session.
        playbackTransportStateRef.current = "loading";
        lastPlaybackAdvanceAtRef.current = Date.now();
        emit("loading");
      } else if (error || status === "error") {
        playbackTransportStateRef.current = "idle";
        recordFailure(sessionRole, engine, uri, "stream-error");
''',
'''      } else if (status === "loading") {
        // TiViMate-style recovery model: only sustained BUFFERING arms a silent
        // socket/media re-prepare. READY/currentTime quirks are not stream errors.
        armBufferingWatchdog();
        emit("loading");
      } else if (error || status === "error") {
        clearBufferingWatchdog();
        recordFailure(sessionRole, engine, uri, "stream-error");
''')
rep(
'''    return () => sub.remove();
  }, [blocked, emit, engine, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, setBlocked, uri]);

  useEffect(() => {
    const progressSub = player.addListener("timeUpdate", ({ currentTime }) => {
      if (currentTime > lastPlaybackTimeRef.current + 0.05) {
        lastPlaybackTimeRef.current = currentTime;
        lastPlaybackAdvanceAtRef.current = Date.now();
      }
    });
    if (mode === "preview" || paused || blocked || !mediaReady) {
      return () => progressSub.remove();
    }
    lastPlaybackTimeRef.current = player.currentTime;
    lastPlaybackAdvanceAtRef.current = Date.now();
    const watchdog = setInterval(() => {
      if (!mountedRef.current || tearingDownRef.current || paused || blocked) return;
      if (!isSessionCurrent(sessionRole, sessionGeneration)) return;
      if (playbackTransportStateRef.current !== "ready") return;
      if (Date.now() - lastPlaybackAdvanceAtRef.current < FROZEN_VIDEO_WATCHDOG_MS) return;
      lastPlaybackAdvanceAtRef.current = Date.now();
      recordFailure(sessionRole, engine, uri, "stream-error");
      emit("error", "stream-error");
    }, 1000);
    return () => {
      progressSub.remove();
      clearInterval(watchdog);
    };
  }, [blocked, emit, engine, mediaReady, mode, paused, player, sessionGeneration, sessionRole, uri]);
''',
'''    return () => {
      clearBufferingWatchdog();
      sub.remove();
    };
  }, [armBufferingWatchdog, blocked, clearBufferingWatchdog, emit, engine, player, reportAndSelectMedia3Tracks, sessionGeneration, sessionRole, setBlocked, uri]);
''')

p.write_text(text, encoding="utf-8")
print("Phase 9 TiViMate-style buffering watchdog applied")
