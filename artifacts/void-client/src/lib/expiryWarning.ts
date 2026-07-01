// SPDX-License-Identifier: AGPL-3.0-or-later
export type RoomTier = "standard" | "day" | null;

export const STANDARD_WARN_LEAD_MS = 10 * 60_000;
export const DAY_WARN_LEAD_MS = 30 * 60_000;

export const STANDARD_URGENT_THRESHOLD_MS = 60_000;
export const DAY_URGENT_THRESHOLD_MS = 5 * 60_000;

export const SNOOZE_INTERVAL_MS = 5 * 60_000;

export function getExpiryWarnLeadMs(tier: RoomTier): number | null {
  if (tier === "day") return DAY_WARN_LEAD_MS;
  if (tier === "standard") return STANDARD_WARN_LEAD_MS;
  return null;
}

export function getExpiryUrgentThresholdMs(tier: RoomTier): number | null {
  if (tier === "day") return DAY_URGENT_THRESHOLD_MS;
  if (tier === "standard") return STANDARD_URGENT_THRESHOLD_MS;
  return null;
}

export function shouldFireExpiryWarning({
  remainingMs,
  tier,
  alreadyFired,
}: {
  remainingMs: number | null;
  tier: RoomTier;
  alreadyFired: boolean;
}): boolean {
  if (alreadyFired) return false;
  if (remainingMs === null) return false;
  const lead = getExpiryWarnLeadMs(tier);
  if (lead === null) return false;
  if (remainingMs <= 0) return false;
  return remainingMs <= lead;
}

// After the host snoozes the "wrap it up" toast, decide whether enough time
// has passed (or the room is now urgently close to ending) to surface it once
// more. Re-fires at the snooze interval OR when the room enters its tier's
// urgent threshold, whichever happens first.
export function shouldRefireSnoozedWarning({
  remainingMs,
  tier,
  snoozedAtRemainingMs,
}: {
  remainingMs: number | null;
  tier: RoomTier;
  snoozedAtRemainingMs: number | null;
}): boolean {
  if (remainingMs === null) return false;
  if (remainingMs <= 0) return false;
  if (snoozedAtRemainingMs === null) return false;
  const urgent = getExpiryUrgentThresholdMs(tier);
  if (urgent !== null && remainingMs <= urgent) return true;
  const elapsed = snoozedAtRemainingMs - remainingMs;
  return elapsed >= SNOOZE_INTERVAL_MS;
}

// Task #121: even after the host has dismissed (or snoozed-and-already-refired)
// the "wrap it up" toast, force one final loud warning when the room enters
// its tier's urgent threshold (T-1m for STANDARD, T-5m for DAY). The room is
// about to quietly expire and the host has no other way to extend after
// the JWT exp passes — this is a guaranteed last-chance signal, independent
// of whatever the host did with the earlier lead-time toast.
export function shouldFireUrgentWarning({
  remainingMs,
  tier,
  alreadyFired,
}: {
  remainingMs: number | null;
  tier: RoomTier;
  alreadyFired: boolean;
}): boolean {
  if (alreadyFired) return false;
  if (remainingMs === null) return false;
  if (remainingMs <= 0) return false;
  const urgent = getExpiryUrgentThresholdMs(tier);
  if (urgent === null) return false;
  return remainingMs <= urgent;
}
