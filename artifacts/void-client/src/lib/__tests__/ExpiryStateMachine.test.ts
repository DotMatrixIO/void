// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { deriveExpiryState, type ExpiryStateMachineInput } from "../ExpiryStateMachine";

function base(overrides: Partial<ExpiryStateMachineInput> = {}): ExpiryStateMachineInput {
  return {
    isHost: true,
    remainingMs: 30 * 60_000,
    tier: "standard",
    phase: "idle",
    snoozedAtRemainingMs: null,
    urgentAlreadyFired: false,
    ...overrides,
  };
}

describe("ExpiryStateMachine", () => {
  it("guests never transition", () => {
    expect(deriveExpiryState(base({ isHost: false, remainingMs: 30_000 }))).toEqual({
      nextPhase: "idle",
      fireUrgent: false,
    });
  });

  it("stays idle when far from expiry", () => {
    expect(deriveExpiryState(base({ remainingMs: 30 * 60_000 }))).toEqual({
      nextPhase: "idle",
      fireUrgent: false,
    });
  });

  it("STANDARD: fires lead-time warning at T-10m", () => {
    // STANDARD lead is 10 minutes; remaining ≤ lead should fire.
    expect(deriveExpiryState(base({ remainingMs: 10 * 60_000 }))).toEqual({
      nextPhase: "showing",
      fireUrgent: false,
    });
  });

  it("DAY: lead is 30m; 20m remaining still triggers", () => {
    expect(
      deriveExpiryState(base({ tier: "day", remainingMs: 20 * 60_000 })),
    ).toEqual({ nextPhase: "showing", fireUrgent: false });
  });

  it("does not re-transition when already showing", () => {
    expect(
      deriveExpiryState(base({ phase: "showing", remainingMs: 9 * 60_000 })),
    ).toEqual({ nextPhase: "showing", fireUrgent: false });
  });

  it("does not re-transition when dismissed (unless urgent fires)", () => {
    expect(
      deriveExpiryState(base({ phase: "dismissed", remainingMs: 5 * 60_000 })),
    ).toEqual({ nextPhase: "dismissed", fireUrgent: false });
  });

  it("snoozed re-fires after the 5-minute snooze interval", () => {
    expect(
      deriveExpiryState(
        base({
          phase: "snoozed",
          remainingMs: 4 * 60_000,
          snoozedAtRemainingMs: 9 * 60_000,
        }),
      ),
    ).toEqual({ nextPhase: "showing", fireUrgent: false });
  });

  it("snoozed stays snoozed when interval has not yet elapsed", () => {
    expect(
      deriveExpiryState(
        base({
          phase: "snoozed",
          remainingMs: 8 * 60_000,
          snoozedAtRemainingMs: 9 * 60_000,
        }),
      ),
    ).toEqual({ nextPhase: "snoozed", fireUrgent: false });
  });

  it("STANDARD: urgent re-fire at T-1m, even after dismiss", () => {
    expect(
      deriveExpiryState(
        base({ phase: "dismissed", remainingMs: 45_000, urgentAlreadyFired: false }),
      ),
    ).toEqual({ nextPhase: "showing", fireUrgent: true });
  });

  it("DAY: urgent re-fire at T-5m", () => {
    expect(
      deriveExpiryState(
        base({
          tier: "day",
          phase: "dismissed",
          remainingMs: 4 * 60_000,
          urgentAlreadyFired: false,
        }),
      ),
    ).toEqual({ nextPhase: "showing", fireUrgent: true });
  });

  it("urgent only fires once per window", () => {
    expect(
      deriveExpiryState(
        base({ phase: "showing", remainingMs: 30_000, urgentAlreadyFired: true }),
      ),
    ).toEqual({ nextPhase: "showing", fireUrgent: false });
  });

  it("null remainingMs is a no-op", () => {
    expect(deriveExpiryState(base({ remainingMs: null }))).toEqual({
      nextPhase: "idle",
      fireUrgent: false,
    });
  });

  it("null tier (no room window) is a no-op", () => {
    expect(deriveExpiryState(base({ tier: null, remainingMs: 1000 }))).toEqual({
      nextPhase: "idle",
      fireUrgent: false,
    });
  });

  it("expired (remainingMs <= 0) does not fire — the expiry overlay owns that case", () => {
    expect(deriveExpiryState(base({ remainingMs: 0 }))).toEqual({
      nextPhase: "idle",
      fireUrgent: false,
    });
  });
});
