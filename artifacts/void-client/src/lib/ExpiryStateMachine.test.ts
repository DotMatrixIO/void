// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  deriveExpiryState,
  type ExpiryStateMachineInput,
} from "./ExpiryStateMachine";
import {
  STANDARD_WARN_LEAD_MS,
  STANDARD_URGENT_THRESHOLD_MS,
  DAY_WARN_LEAD_MS,
  DAY_URGENT_THRESHOLD_MS,
  SNOOZE_INTERVAL_MS,
} from "./expiryWarning";

function input(overrides: Partial<ExpiryStateMachineInput> = {}): ExpiryStateMachineInput {
  return {
    isHost: true,
    remainingMs: STANDARD_WARN_LEAD_MS + 60_000,
    tier: "standard",
    phase: "idle",
    snoozedAtRemainingMs: null,
    urgentAlreadyFired: false,
    ...overrides,
  };
}

describe("deriveExpiryState", () => {
  it("guests are short-circuited — phase stays put, urgent never fires", () => {
    const out = deriveExpiryState(
      input({ isHost: false, phase: "idle", remainingMs: 1000 }),
    );
    expect(out).toEqual({ nextPhase: "idle", fireUrgent: false });
  });

  it("stays idle when remaining time exceeds the tier's lead", () => {
    const out = deriveExpiryState(
      input({ remainingMs: STANDARD_WARN_LEAD_MS + 1000 }),
    );
    expect(out).toEqual({ nextPhase: "idle", fireUrgent: false });
  });

  it("transitions idle → showing when remaining time hits the standard lead", () => {
    const out = deriveExpiryState(
      input({ remainingMs: STANDARD_WARN_LEAD_MS }),
    );
    expect(out).toEqual({ nextPhase: "showing", fireUrgent: false });
  });

  it("transitions idle → showing when remaining time hits the day lead", () => {
    const out = deriveExpiryState(
      input({
        tier: "day",
        remainingMs: DAY_WARN_LEAD_MS,
      }),
    );
    expect(out).toEqual({ nextPhase: "showing", fireUrgent: false });
  });

  it("does nothing while already showing (idempotent re-render)", () => {
    // Pick a remainingMs above the standard urgent threshold so the
    // urgent re-fire path doesn't trip; this exercises the pure
    // idempotency clause.
    const out = deriveExpiryState(
      input({
        phase: "showing",
        remainingMs: STANDARD_URGENT_THRESHOLD_MS + 60_000,
      }),
    );
    expect(out).toEqual({ nextPhase: "showing", fireUrgent: false });
  });

  it("does nothing while dismissed unless urgent re-fires", () => {
    const out = deriveExpiryState(
      input({
        phase: "dismissed",
        remainingMs: STANDARD_URGENT_THRESHOLD_MS + 5000,
      }),
    );
    expect(out).toEqual({ nextPhase: "dismissed", fireUrgent: false });
  });

  describe("urgent re-fire (Task #121)", () => {
    it("fires once when entering the standard urgent threshold", () => {
      const out = deriveExpiryState(
        input({
          phase: "dismissed",
          remainingMs: STANDARD_URGENT_THRESHOLD_MS,
          urgentAlreadyFired: false,
        }),
      );
      expect(out).toEqual({ nextPhase: "showing", fireUrgent: true });
    });

    it("fires once when entering the day urgent threshold", () => {
      const out = deriveExpiryState(
        input({
          tier: "day",
          phase: "snoozed",
          remainingMs: DAY_URGENT_THRESHOLD_MS,
          snoozedAtRemainingMs: DAY_WARN_LEAD_MS,
          urgentAlreadyFired: false,
        }),
      );
      expect(out).toEqual({ nextPhase: "showing", fireUrgent: true });
    });

    it("does not re-fire urgent after it has fired once on this window", () => {
      const out = deriveExpiryState(
        input({
          phase: "showing",
          remainingMs: 10_000,
          urgentAlreadyFired: true,
        }),
      );
      expect(out).toEqual({ nextPhase: "showing", fireUrgent: false });
    });

    it("urgent fires even from idle (a host who never saw the lead-time)", () => {
      // Tier whose lead is 10m and urgent is 1m — input below skips lead.
      const out = deriveExpiryState(
        input({
          phase: "idle",
          remainingMs: STANDARD_URGENT_THRESHOLD_MS - 1,
        }),
      );
      expect(out).toEqual({ nextPhase: "showing", fireUrgent: true });
    });
  });

  describe("snoozed re-fire", () => {
    it("re-surfaces after the snooze interval elapses", () => {
      const snoozedAt = STANDARD_WARN_LEAD_MS;
      const out = deriveExpiryState(
        input({
          phase: "snoozed",
          remainingMs: snoozedAt - SNOOZE_INTERVAL_MS,
          snoozedAtRemainingMs: snoozedAt,
        }),
      );
      expect(out).toEqual({ nextPhase: "showing", fireUrgent: false });
    });

    it("stays snoozed when the interval has not yet elapsed", () => {
      const snoozedAt = STANDARD_WARN_LEAD_MS;
      const out = deriveExpiryState(
        input({
          phase: "snoozed",
          remainingMs: snoozedAt - 60_000,
          snoozedAtRemainingMs: snoozedAt,
        }),
      );
      expect(out).toEqual({ nextPhase: "snoozed", fireUrgent: false });
    });
  });

  it("expired clock (remainingMs<=0) never fires either path", () => {
    const out = deriveExpiryState(
      input({
        phase: "idle",
        remainingMs: 0,
      }),
    );
    expect(out).toEqual({ nextPhase: "idle", fireUrgent: false });
  });
});
