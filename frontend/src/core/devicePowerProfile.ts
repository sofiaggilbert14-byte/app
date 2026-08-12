/** Device power / preview profiles — bundle settle times without a pile of toggles. */

export type PowerProfile = "normal" | "weak" | "max_preview";

export type PowerProfileTuning = {
  id: PowerProfile;
  label: string;
  /** Extra ms after rapid surf before preview arms. */
  surfSettleExtraMs: number;
  /** Base preview delay for "on" mode. */
  previewArmOnMs: number;
  /** Base preview delay for "delayed" / "surf" modes. */
  previewArmDelayedMs: number;
  /** Rapid-surf soft-clear hold. */
  rapidSurfHoldMs: number;
  /** Prefer skipping logos during rapid surf. */
  logosOffWhileSurfingDefault: boolean;
  /** Bounded JS row pointers; SQLite remains authoritative at every profile. */
  programmeRowCacheLimit: number;
  /** Fastest held-D-pad cadence; focus-paint acknowledgement may slow it further. */
  guideRepeatIntervalMs: number;
};

const PROFILES: Record<PowerProfile, PowerProfileTuning> = {
  normal: {
    id: "normal",
    label: "Normal",
    surfSettleExtraMs: 300,
    previewArmOnMs: 1200,
    previewArmDelayedMs: 1700,
    rapidSurfHoldMs: 600,
    logosOffWhileSurfingDefault: false,
    programmeRowCacheLimit: 720,
    guideRepeatIntervalMs: 72,
  },
  weak: {
    id: "weak",
    label: "Compatibility",
    surfSettleExtraMs: 650,
    previewArmOnMs: 2000,
    previewArmDelayedMs: 2600,
    rapidSurfHoldMs: 900,
    logosOffWhileSurfingDefault: true,
    programmeRowCacheLimit: 320,
    guideRepeatIntervalMs: 92,
  },
  max_preview: {
    id: "max_preview",
    label: "Max preview",
    surfSettleExtraMs: 160,
    previewArmOnMs: 850,
    previewArmDelayedMs: 1250,
    rapidSurfHoldMs: 400,
    logosOffWhileSurfingDefault: false,
    programmeRowCacheLimit: 960,
    guideRepeatIntervalMs: 64,
  },
};

export function resolvePowerProfile(value: string | null | undefined): PowerProfile {
  if (value === "weak" || value === "max_preview" || value === "normal") return value;
  return "normal";
}

export function getPowerProfileTuning(profile: PowerProfile): PowerProfileTuning {
  return PROFILES[profile] || PROFILES.normal;
}

export const POWER_PROFILE_OPTIONS: { label: string; value: PowerProfile }[] = [
  { label: "Normal", value: "normal" },
  { label: "Compatibility", value: "weak" },
  { label: "Max preview", value: "max_preview" },
];
