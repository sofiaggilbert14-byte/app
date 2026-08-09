/**
 * Pure parental PIN helpers (no React / storage). Used by parentalPin.ts and node tests.
 */

export function normalizeParentalPin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pin = value.replace(/\D/g, "").slice(0, 8);
  return pin.length >= 4 ? pin : null;
}

/** In-memory PIN mirror — storage layer keeps this in sync. */
let memoryPin: string | null = null;

export function getParentalPinMemory(): string | null {
  return memoryPin;
}

export function setParentalPinMemory(pin: string | null): string | null {
  memoryPin = normalizeParentalPin(pin);
  return memoryPin;
}

export function verifyParentalPin(candidate: string): boolean {
  const pin = normalizeParentalPin(candidate);
  return !!pin && pin === memoryPin;
}
