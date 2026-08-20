/**
 * Per-stream Media3/VLC audio selection diagnostics.
 * Keeps a bounded last-known snapshot for Settings export and logcat QA.
 * Never stores full stream URLs.
 */

export type AudioDiagnosticsSnapshot = {
  engine: "media3" | "vlc" | string;
  role: "preview" | "fullscreen" | string;
  /** Short non-identifying stream fingerprint (kind + length + hash). */
  streamKey: string;
  trackId?: string | number | null;
  mimeType?: string | null;
  language?: string | null;
  label?: string | null;
  isSupported?: boolean | null;
  trackCount: number;
  supportedCount: number;
  selectedBy: "user" | "current" | "auto-supported" | "auto-first" | "none";
  silentAudio?: boolean;
  reason?: string | null;
  at: string;
};

let lastSnapshot: AudioDiagnosticsSnapshot | null = null;

/** Stable short fingerprint without retaining the raw URI. */
export function fingerprintStreamUri(uri: string, kind?: string): string {
  const clean = String(uri || "").split("|")[0];
  let hash = 0;
  for (let i = 0; i < clean.length; i += 1) {
    hash = (hash * 31 + clean.charCodeAt(i)) | 0;
  }
  const leaf = clean.split("/").pop()?.slice(0, 24) || "stream";
  return `${kind || "unknown"}:${clean.length}:${(hash >>> 0).toString(16)}:${leaf}`;
}

/** Match a diagnostic key without needing the player's stream-kind classifier. */
export function matchesStreamFingerprint(uri: string, streamKey: string): boolean {
  const candidate = fingerprintStreamUri(uri);
  const candidateBody = candidate.slice(candidate.indexOf(":") + 1);
  const key = String(streamKey || "");
  const keyBody = key.slice(key.indexOf(":") + 1);
  return !!candidateBody && candidateBody === keyBody;
}

export function recordAudioDiagnostics(
  input: Omit<AudioDiagnosticsSnapshot, "at"> & { at?: string },
): AudioDiagnosticsSnapshot {
  const snapshot: AudioDiagnosticsSnapshot = {
    ...input,
    at: input.at || new Date().toISOString(),
  };
  lastSnapshot = snapshot;
  try {
    console.info(
      "[CharmIPTV audio]",
      [
        `engine=${snapshot.engine}`,
        `role=${snapshot.role}`,
        `stream=${snapshot.streamKey}`,
        `track=${snapshot.trackId ?? "none"}`,
        `mime=${snapshot.mimeType ?? "unknown"}`,
        `lang=${snapshot.language ?? "und"}`,
        `supported=${snapshot.isSupported ?? "n/a"}`,
        `by=${snapshot.selectedBy}`,
        `tracks=${snapshot.trackCount}/${snapshot.supportedCount}`,
        snapshot.silentAudio ? "silent=1" : null,
        snapshot.reason ? `reason=${snapshot.reason}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  } catch {
    /* logging must never break playback */
  }
  return snapshot;
}

export function getLastAudioDiagnostics(): AudioDiagnosticsSnapshot | null {
  if (!lastSnapshot) return null;
  // Public consumers that need current-channel lookup do not know the internal
  // HLS/TS classifier. Normalize only this returned view; retained/logged
  // diagnostics still keep the original kind for debugging.
  const key = lastSnapshot.streamKey;
  const body = key.slice(key.indexOf(":") + 1);
  return { ...lastSnapshot, streamKey: `unknown:${body}` };
}

/** Flatten for diagnostics text export. */
export function audioDiagnosticsExtras(
  snapshot: AudioDiagnosticsSnapshot | null = lastSnapshot,
): Record<string, string | number | boolean | null> {
  if (!snapshot) {
    return {
      audioEngine: null,
      audioMime: null,
      audioSupported: null,
      audioTrackCount: 0,
      audioSilent: false,
    };
  }
  return {
    audioEngine: snapshot.engine,
    audioRole: snapshot.role,
    audioStreamKey: snapshot.streamKey,
    audioTrackId: snapshot.trackId == null ? null : String(snapshot.trackId),
    audioMime: snapshot.mimeType ?? null,
    audioLanguage: snapshot.language ?? null,
    audioSupported: snapshot.isSupported ?? null,
    audioSelectedBy: snapshot.selectedBy,
    audioTrackCount: snapshot.trackCount,
    audioSupportedCount: snapshot.supportedCount,
    audioSilent: !!snapshot.silentAudio,
    audioReason: snapshot.reason ?? null,
    audioAt: snapshot.at,
  };
}