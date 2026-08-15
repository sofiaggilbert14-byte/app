import React from "react";
import { getDeviceMemoryProfile, type DeviceMemoryProfile } from "@/src/utils/tvRemote";

let cached: DeviceMemoryProfile | null | undefined;
let pending: Promise<DeviceMemoryProfile | null> | null = null;

export async function readDeviceMemoryProfile(): Promise<DeviceMemoryProfile | null> {
  if (cached !== undefined) return cached;
  if (!pending) pending = getDeviceMemoryProfile().then((value) => (cached = value));
  return pending;
}

export function useDeviceMemoryProfile(): DeviceMemoryProfile | null {
  const [profile, setProfile] = React.useState<DeviceMemoryProfile | null>(() => cached ?? null);
  React.useEffect(() => {
    let active = true;
    void readDeviceMemoryProfile().then((value) => { if (active) setProfile(value); });
    return () => { active = false; };
  }, []);
  return profile;
}

export function shouldUseLowRamTuning(profile: DeviceMemoryProfile | null): boolean {
  if (!profile) return false;
  return profile.lowRamDevice || (profile.memoryClassMb > 0 && profile.memoryClassMb < 192);
}
