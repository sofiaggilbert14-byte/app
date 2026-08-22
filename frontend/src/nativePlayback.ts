import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export type NativePlaybackOwner = "none" | "preview" | "fullscreen";
export type NativePlaybackState = "loading" | "playing" | "error";

export type NativePlaybackTrack = {
  groupIndex: number;
  trackIndex: number;
  id: string;
  name: string;
  language?: string | null;
  mimeType?: string | null;
  isSupported?: boolean;
};

type NativePlaybackModuleShape = {
  prepareFullscreen(uri: string, headers: Record<string, string>, contentType?: string | null): void;
  preparePreview(uri: string, headers: Record<string, string>, contentType?: string | null): void;
  setPreviewViewport(x: number, y: number, width: number, height: number): void;
  setFullscreenViewport(): void;
  setResizeMode(mode?: string | null): void;
  pause(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  selectAudio(groupIndex: number, trackIndex: number): void;
  selectAudioLanguage(language?: string | null): void;
  selectSubtitle(groupIndex: number, trackIndex: number): void;
  selectSubtitleLanguage(language?: string | null): void;
  subtitlesOff(): void;
  stopPreview(): Promise<void>;
  stopFullscreen(releasePlayer: boolean): Promise<void>;
  getOwner(): Promise<NativePlaybackOwner>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const native: NativePlaybackModuleShape | null =
  Platform.OS === "android" ? (NativeModules.NativePlayback as NativePlaybackModuleShape | undefined) ?? null : null;
const emitter = native ? new NativeEventEmitter(NativeModules.NativePlayback) : null;

export function nativePlaybackAvailable(): boolean { return !!native; }
export function prepareNativeFullscreen(uri: string, headers: Record<string, string>, contentType?: string | null): void { native?.setFullscreenViewport(); native?.prepareFullscreen(uri, headers, contentType ?? null); }
export function prepareNativePreview(uri: string, headers: Record<string, string>, contentType?: string | null): void { native?.preparePreview(uri, headers, contentType ?? null); }
export function setNativePreviewViewport(x: number, y: number, width: number, height: number): void { native?.setPreviewViewport(x, y, width, height); }
export function setNativePlaybackResizeMode(mode: "fit" | "zoom" | "stretch"): void { native?.setResizeMode(mode); }
export function pauseNativePlayback(): void { native?.pause(); }
export function resumeNativePlayback(): void { native?.resume(); }
export function setNativePlaybackMuted(muted: boolean): void { native?.setMuted(muted); }

export function selectNativeAudio(track?: NativePlaybackTrack | null, language?: string | null): void {
  if (track) native?.selectAudio(track.groupIndex, track.trackIndex); else native?.selectAudioLanguage(language ?? null);
}
export function selectNativeSubtitle(track?: NativePlaybackTrack | null, language?: string | null): void {
  if (track) native?.selectSubtitle(track.groupIndex, track.trackIndex); else if (language) native?.selectSubtitleLanguage(language); else native?.subtitlesOff();
}
export async function stopNativePreview(): Promise<void> { await native?.stopPreview(); }
export async function stopNativeFullscreen(releasePlayer = true): Promise<void> { await native?.stopFullscreen(releasePlayer); }
export async function getNativePlaybackOwner(): Promise<NativePlaybackOwner> { return (await native?.getOwner()) ?? "none"; }
export function addNativePlaybackStateListener(listener: (event: { owner: NativePlaybackOwner; state: NativePlaybackState; reason?: string | null }) => void): () => void { const sub = emitter?.addListener("NativePlaybackState", listener); return () => sub?.remove(); }
export function addNativePlaybackTracksListener(listener: (event: { owner: NativePlaybackOwner; audio: NativePlaybackTrack[]; text: NativePlaybackTrack[] }) => void): () => void { const sub = emitter?.addListener("NativePlaybackTracks", listener); return () => sub?.remove(); }
