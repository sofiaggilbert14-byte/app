/** Common ISO 639-2/B codes users can prefer for audio track auto-pick. */
export const PREFERRED_AUDIO_LANGUAGE_OPTIONS: { label: string; value: string }[] = [
  { label: "Auto / first track", value: "" },
  { label: "English (eng)", value: "eng" },
  { label: "Spanish (spa)", value: "spa" },
  { label: "French (fra)", value: "fra" },
  { label: "German (deu)", value: "deu" },
  { label: "Italian (ita)", value: "ita" },
  { label: "Portuguese (por)", value: "por" },
  { label: "Russian (rus)", value: "rus" },
  { label: "Japanese (jpn)", value: "jpn" },
  { label: "Korean (kor)", value: "kor" },
  { label: "Chinese (zho)", value: "zho" },
  { label: "Arabic (ara)", value: "ara" },
  { label: "Hindi (hin)", value: "hin" },
  { label: "Dutch (nld)", value: "nld" },
  { label: "Turkish (tur)", value: "tur" },
  { label: "Polish (pol)", value: "pol" },
];

export function normalizePreferredAudioLanguage(raw: string | null | undefined): string {
  const value = String(raw || "").trim().toLowerCase().slice(0, 16);
  if (!value) return "";
  if (PREFERRED_AUDIO_LANGUAGE_OPTIONS.some((option) => option.value === value)) return value;
  // Allow custom short codes from older installs / advanced users.
  return /^[a-z]{2,3}(-[a-z0-9]+)?$/.test(value) ? value : "";
}
