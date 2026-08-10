import { NativeModules, Platform } from "react-native";

export type DeviceCodecCapabilities = {
  h264: boolean;
  hevc: boolean;
  vp9: boolean;
  av1: boolean;
  aac: boolean;
  ac3: boolean;
  eac3: boolean;
  maxWidth: number;
  maxHeight: number;
};

let cached: DeviceCodecCapabilities | null = null;
let pending: Promise<DeviceCodecCapabilities | null> | null = null;

export function getDeviceCodecCapabilities(): Promise<DeviceCodecCapabilities | null> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  if (Platform.OS !== "android" || !NativeModules.TvRemote?.getCodecCapabilities) {
    return Promise.resolve(null);
  }
  const task: Promise<DeviceCodecCapabilities | null> = NativeModules.TvRemote.getCodecCapabilities()
    .then((raw: Partial<DeviceCodecCapabilities>) => {
      cached = {
        h264: !!raw.h264,
        hevc: !!raw.hevc,
        vp9: !!raw.vp9,
        av1: !!raw.av1,
        aac: !!raw.aac,
        ac3: !!raw.ac3,
        eac3: !!raw.eac3,
        maxWidth: Number(raw.maxWidth || 0),
        maxHeight: Number(raw.maxHeight || 0),
      };
      return cached;
    })
    .catch(() => null)
    .finally(() => { pending = null; });
  pending = task;
  return task;
}
