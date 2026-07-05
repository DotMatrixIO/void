// SPDX-License-Identifier: AGPL-3.0-or-later
// ExpiryStateMachine — pure derivation of the host-facing room-expiry
// warning state, extracted from RoomPage (Task #467). RoomPage owns the
// React state (`expiryWarningPhase`, snooze flag, urgent-fired flag,
// `snoozedAtRemainingMs`) and the side effects (audible bleep, button
// disable). This module owns only the decision: given the current
// inputs, what should the next phase be, and did we just hit the
// guaranteed urgent re-fire?
//
// Behavior contract (mirrors the prior inline RoomPage effect):
//   1. If the urgent threshold (tier-scaled) is now reached and we have
//      not already fired the urgent re-fire on this window, emit one
//      forced `showing` transition and mark snooze as used. This is the
//      "guaranteed last-chance" warning from Task #121.
//   2. Otherwise, do not change phase if currently `showing` or
//      `dismissed`.
//   3. From `idle`, surface the lead-time warning when remaining time
//      drops at/under the tier's lead.
//   4. From `snoozed`, re-surface when either the snooze interval has
//      elapsed or the urgent threshold has been reached.
//
// Guests never invoke this machine — `isHost: false` short-circuits.

import {
  shouldFireExpiryWarning,
  shouldRefireSnoozedWarning,
  shouldFireUrgentWarning,
  type RoomTier,
} from "./expiryWarning";

export type ExpiryWarningPhase = "idle" | "showing" | "snoozed" | "dismissed";

export interface ExpiryStateMachineInput {
  isHost: boolean;
  remainingMs: number | null;
  tier: RoomTier;
  phase: ExpiryWarningPhase;
  snoozedAtRemainingMs: number | null;
  urgentAlreadyFired: boolean;
}

export interface ExpiryStateMachineOutput {
  /** The phase the room should adopt next. Same value as input.phase when no transition fires. */
  nextPhase: ExpiryWarningPhase;
  /**
   * True when this tick is the urgent re-fire — RoomPage uses this to
   * mark the snooze button used and trigger the audible cue exactly
   * once per window.
   */
  fireUrgent: boolean;
}

export function deriveExpiryState({
  isHost,
  remainingMs,
  tier,
  phase,
  snoozedAtRemainingMs,
  urgentAlreadyFired,
}: ExpiryStateMachineInput): ExpiryStateMachineOutput {
  if (!isHost) return { nextPhase: phase, fireUrgent: false };

  if (
    shouldFireUrgentWarning({
      remainingMs,
      tier,
      alreadyFired: urgentAlreadyFired,
    })
  ) {
    return { nextPhase: "showing", fireUrgent: true };
  }

  if (phase === "showing" || phase === "dismissed") {
    return { nextPhase: phase, fireUrgent: false };
  }

  if (phase === "idle") {
    if (
      shouldFireExpiryWarning({
        remainingMs,
        tier,
        alreadyFired: false,
      })
    ) {
      return { nextPhase: "showing", fireUrgent: false };
    }
    return { nextPhase: "idle", fireUrgent: false };
  }

  // phase === "snoozed"
  if (
    shouldRefireSnoozedWarning({
      remainingMs,
      tier,
      snoozedAtRemainingMs,
    })
  ) {
    return { nextPhase: "showing", fireUrgent: false };
  }
  return { nextPhase: "snoozed", fireUrgent: false };
}
