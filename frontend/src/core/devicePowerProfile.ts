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
  /** Metadata focus debounce while not rapid-surfing. */
  focusMetadataMs: number;
  /** Rapid-surf soft-clear hold. */
  rapidSurfHoldMs: number;
  /** Prefer skipping logos during rapid surf. */
  logosOffWhileSurfingDefault: boolean;
};

const PROFILES: Record<PowerProfile, PowerProfileTuning> = {
  normal: {
    id: "normal",
    label: "Normal",
    surfSettleExtraMs: 350,
    previewArmOnMs: 1600,
    previewArmDelayedMs: 2200,
    focusMetadataMs: 180,
    rapidSurfHoldMs: 700,
    logosOffWhileSurfingDefault: false,
  },
  weak: {
    id: "weak",
    label: "Weak stick",
    surfSettleExtraMs: 650,
    previewArmOnMs: 2000,
    previewArmDelayedMs: 2600,
    focusMetadataMs: 220,
    rapidSurfHoldMs: 900,
    logosOffWhileSurfingDefault: true,
  },
  max_preview: {
    id: "max_preview",
    label: "Max preview",
    surfSettleExtraMs: 200,
    previewArmOnMs: 1100,
    previewArmDelayedMs: 1600,
    focusMetadataMs: 120,
    rapidSurfHoldMs: 500,
    logosOffWhileSurfingDefault: false,
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
  { label: "Weak stick", value: "weak" },
  { label: "Max preview", value: "max_preview" },
];
