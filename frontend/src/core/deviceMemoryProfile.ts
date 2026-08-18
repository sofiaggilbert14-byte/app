import React from "react";
import { getDeviceMemoryProfile, type DeviceMemoryProfile } from "@/src/utils/tvRemote";
import { setDeviceLowRamCacheCap } from "@/src/core/devicePowerProfile";

let cached: DeviceMemoryProfile | null | undefined;
let pending: Promise<DeviceMemoryProfile | null> | null = null;
let capPromise: Promise<void> | null = null;

export function shouldUseLowRamTuning(profile: DeviceMemoryProfile | null): boolean {
  if (!profile) return false;
  return profile.lowRamDevice || (profile.memoryClassMb > 0 && profile.memoryClassMb < 192);
}

/**
 * Device memory is a hard safety boundary, separate from the user's preview/
 * responsiveness preference. Store may request Normal/Max Preview timings, but
 * a low-RAM stick must never regain the larger programme caches afterward.
 *
 * Lazy imports avoid introducing a startup cycle between Store → memory profile
 * → source. On Android these resolve the existing platform modules and only
 * adjust their row-count caps; SQLite remains authoritative and untouched.
 */
function enforceLowRamCacheCaps(profile: DeviceMemoryProfile | null): void {
  const lowRam = shouldUseLowRamTuning(profile);
  setDeviceLowRamCacheCap(lowRam);
  if (!lowRam || capPromise) return;
  capPromise = Promise.all([
    import("@/src/core/guideProgramsStore"),
    import("@/src/source"),
  ])
    .then(([guidePrograms, source]) => {
      guidePrograms.setGuideProgramRowLimit(320);
      source.setProgrammeWindowCacheLimit(320);
    })
    .catch(() => undefined)
    .finally(() => {
      capPromise = null;
    });
}

export async function readDeviceMemoryProfile(): Promise<DeviceMemoryProfile | null> {
  if (cached !== undefined) {
    enforceLowRamCacheCaps(cached);
    return cached;
  }
  if (!pending) {
    pending = getDeviceMemoryProfile().then((value) => {
      cached = value;
      enforceLowRamCacheCaps(value);
      return value;
    });
  }
  const value = await pending;
  enforceLowRamCacheCaps(value);
  return value;
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
