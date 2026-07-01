// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  getExpiryUrgentThresholdMs,
  getExpiryWarnLeadMs,
  shouldFireExpiryWarning,
  shouldFireUrgentWarning,
  shouldRefireSnoozedWarning,
  DAY_URGENT_THRESHOLD_MS,
  DAY_WARN_LEAD_MS,
  SNOOZE_INTERVAL_MS,
  STANDARD_URGENT_THRESHOLD_MS,
  STANDARD_WARN_LEAD_MS,
} from "./expiryWarning";

describe("getExpiryWarnLeadMs", () => {
  it("returns 10 minutes for standard tier", () => {
    expect(getExpiryWarnLeadMs("standard")).toBe(STANDARD_WARN_LEAD_MS);
    expect(STANDARD_WARN_LEAD_MS).toBe(10 * 60_000);
  });

  it("returns 30 minutes for day tier", () => {
    expect(getExpiryWarnLeadMs("day")).toBe(DAY_WARN_LEAD_MS);
    expect(DAY_WARN_LEAD_MS).toBe(30 * 60_000);
  });

  it("returns null when tier is unknown", () => {
    expect(getExpiryWarnLeadMs(null)).toBeNull();
  });
});

describe("shouldFireExpiryWarning", () => {
  it("does not fire when remainingMs is null", () => {
    expect(
      shouldFireExpiryWarning({ remainingMs: null, tier: "standard", alreadyFired: false }),
    ).toBe(false);
  });

  it("does not fire when tier is unknown", () => {
    expect(
      shouldFireExpiryWarning({ remainingMs: 5 * 60_000, tier: null, alreadyFired: false }),
    ).toBe(false);
  });

  it("does not fire when already fired", () => {
    expect(
      shouldFireExpiryWarning({ remainingMs: 1 * 60_000, tier: "standard", alreadyFired: true }),
    ).toBe(false);
  });

  it("does not fire when remaining time exceeds the standard lead", () => {
    expect(
      shouldFireExpiryWarning({
        remainingMs: STANDARD_WARN_LEAD_MS + 1_000,
        tier: "standard",
        alreadyFired: false,
      }),
    ).toBe(false);
  });

  it("fires exactly at the standard threshold", () => {
    expect(
      shouldFireExpiryWarning({
        remainingMs: STANDARD_WARN_LEAD_MS,
        tier: "standard",
        alreadyFired: false,
      }),
    ).toBe(true);
  });

  it("fires below the standard threshold", () => {
    expect(
      shouldFireExpiryWarning({
        remainingMs: STANDARD_WARN_LEAD_MS - 1_000,
        tier: "standard",
        alreadyFired: false,
      }),
    ).toBe(true);
  });

  it("does not fire when remaining time exceeds the day lead", () => {
    expect(
      shouldFireExpiryWarning({
        remainingMs: DAY_WARN_LEAD_MS + 1_000,
        tier: "day",
        alreadyFired: false,
      }),
    ).toBe(false);
  });

  it("fires exactly at the day threshold", () => {
    expect(
      shouldFireExpiryWarning({
        remainingMs: DAY_WARN_LEAD_MS,
        tier: "day",
        alreadyFired: false,
      }),
    ).toBe(true);
  });

  it("does not fire after the room has already expired", () => {
    expect(
      shouldFireExpiryWarning({ remainingMs: 0, tier: "standard", alreadyFired: false }),
    ).toBe(false);
    expect(
      shouldFireExpiryWarning({ remainingMs: -1_000, tier: "day", alreadyFired: false }),
    ).toBe(false);
  });

  it("fires only once across a countdown sequence when not snoozed", () => {
    const tier = "day" as const;
    let fired = false;
    let fireCount = 0;
    const samples = [
      DAY_WARN_LEAD_MS + 60_000,
      DAY_WARN_LEAD_MS + 1_000,
      DAY_WARN_LEAD_MS,
      DAY_WARN_LEAD_MS - 1_000,
      DAY_WARN_LEAD_MS - 60_000,
      60_000,
      1_000,
    ];
    for (const remainingMs of samples) {
      if (shouldFireExpiryWarning({ remainingMs, tier, alreadyFired: fired })) {
        fired = true;
        fireCount++;
      }
    }
    expect(fireCount).toBe(1);
  });
});

describe("getExpiryUrgentThresholdMs", () => {
  it("returns 1 minute for standard tier", () => {
    expect(getExpiryUrgentThresholdMs("standard")).toBe(STANDARD_URGENT_THRESHOLD_MS);
    expect(STANDARD_URGENT_THRESHOLD_MS).toBe(60_000);
  });

  it("returns 5 minutes for day tier", () => {
    expect(getExpiryUrgentThresholdMs("day")).toBe(DAY_URGENT_THRESHOLD_MS);
    expect(DAY_URGENT_THRESHOLD_MS).toBe(5 * 60_000);
  });

  it("returns null when tier is unknown", () => {
    expect(getExpiryUrgentThresholdMs(null)).toBeNull();
  });
});

describe("shouldRefireSnoozedWarning", () => {
  it("does not refire when remainingMs is null", () => {
    expect(
      shouldRefireSnoozedWarning({
        remainingMs: null,
        tier: "standard",
        snoozedAtRemainingMs: STANDARD_WARN_LEAD_MS,
      }),
    ).toBe(false);
  });

  it("does not refire after the room has already expired", () => {
    expect(
      shouldRefireSnoozedWarning({
        remainingMs: 0,
        tier: "standard",
        snoozedAtRemainingMs: STANDARD_WARN_LEAD_MS,
      }),
    ).toBe(false);
    expect(
      shouldRefireSnoozedWarning({
        remainingMs: -500,
        tier: "day",
        snoozedAtRemainingMs: DAY_WARN_LEAD_MS,
      }),
    ).toBe(false);
  });

  it("does not refire when no snooze timestamp is recorded", () => {
    expect(
      shouldRefireSnoozedWarning({
        remainingMs: 60_000,
        tier: "standard",
        snoozedAtRemainingMs: null,
      }),
    ).toBe(false);
  });

  it("does not refire when less than the snooze interval has elapsed and not yet urgent", () => {
    const snoozedAt = STANDARD_WARN_LEAD_MS;
    expect(
      shouldRefireSnoozedWarning({
        remainingMs: snoozedAt - (SNOOZE_INTERVAL_MS - 1_000),
        tier: "standard",
        snoozedAtRemainingMs: snoozedAt,
      }),
    ).toBe(false);
  });

  it("refires once the snooze interval has elapsed", () => {
    const snoozedAt = DAY_WARN_LEAD_MS;
    expect(
      shouldRefireSnoozedWarning({
        remainingMs: snoozedAt - SNOOZE_INTERVAL_MS,
        tier: "day",
        snoozedAtRemainingMs: snoozedAt,
      }),
    ).toBe(true);
  });

  it("refires immediately when remaining drops to the urgent threshold even before the snooze interval", () => {
    expect(
      shouldRefireSnoozedWarning({
        remainingMs: STANDARD_URGENT_THRESHOLD_MS,
        tier: "standard",
        snoozedAtRemainingMs: STANDARD_URGENT_THRESHOLD_MS + 30_000,
      }),
    ).toBe(true);
    expect(
      shouldRefireSnoozedWarning({
        remainingMs: DAY_URGENT_THRESHOLD_MS - 1_000,
        tier: "day",
        snoozedAtRemainingMs: DAY_URGENT_THRESHOLD_MS + 30_000,
      }),
    ).toBe(true);
  });

  it("refires at most once across a countdown sequence after a single snooze", () => {
    const tier = "standard" as const;
    const snoozedAt = STANDARD_WARN_LEAD_MS;
    let snoozedAtRemainingMs: number | null = snoozedAt;
    let refireCount = 0;
    const samples = [
      snoozedAt - 30_000,
      snoozedAt - 60_000,
      snoozedAt - SNOOZE_INTERVAL_MS,
      snoozedAt - SNOOZE_INTERVAL_MS - 10_000,
      STANDARD_URGENT_THRESHOLD_MS,
      30_000,
      1_000,
    ];
    for (const remainingMs of samples) {
      if (
        shouldRefireSnoozedWarning({
          remainingMs,
          tier,
          snoozedAtRemainingMs,
        })
      ) {
        refireCount++;
        // Caller is responsible for clearing the snooze timestamp once the
        // toast comes back, mirroring the React state machine in RoomPage.
        snoozedAtRemainingMs = null;
      }
    }
    expect(refireCount).toBe(1);
  });

  it("snooze interval (5 minutes) is shorter than the standard lead but longer than the standard urgent threshold", () => {
    expect(SNOOZE_INTERVAL_MS).toBe(5 * 60_000);
    expect(SNOOZE_INTERVAL_MS).toBeLessThan(STANDARD_WARN_LEAD_MS);
    expect(SNOOZE_INTERVAL_MS).toBeGreaterThan(STANDARD_URGENT_THRESHOLD_MS);
  });
});

describe("shouldFireUrgentWarning", () => {
  // The urgent re-fire is the host's last-chance signal before the JWT
  // exp passes and the room is silently torn down. It is independent of
  // dismiss/snooze: a host who clicked DISMISS on the lead-time toast
  // must still get this warning. These tests pin that contract so a
  // future refactor of the state machine can't accidentally regress it.
  it("does not fire when remainingMs is null", () => {
    expect(
      shouldFireUrgentWarning({ remainingMs: null, tier: "standard", alreadyFired: false }),
    ).toBe(false);
  });

  it("does not fire when tier is unknown", () => {
    expect(
      shouldFireUrgentWarning({ remainingMs: 30_000, tier: null, alreadyFired: false }),
    ).toBe(false);
  });

  it("does not fire when already fired this window", () => {
    expect(
      shouldFireUrgentWarning({
        remainingMs: STANDARD_URGENT_THRESHOLD_MS - 1_000,
        tier: "standard",
        alreadyFired: true,
      }),
    ).toBe(false);
  });

  it("does not fire when remaining time exceeds the standard urgent threshold", () => {
    expect(
      shouldFireUrgentWarning({
        remainingMs: STANDARD_URGENT_THRESHOLD_MS + 1_000,
        tier: "standard",
        alreadyFired: false,
      }),
    ).toBe(false);
  });

  it("fires exactly at the standard urgent threshold (T-1m)", () => {
    expect(
      shouldFireUrgentWarning({
        remainingMs: STANDARD_URGENT_THRESHOLD_MS,
        tier: "standard",
        alreadyFired: false,
      }),
    ).toBe(true);
  });

  it("fires below the standard urgent threshold", () => {
    expect(
      shouldFireUrgentWarning({
        remainingMs: STANDARD_URGENT_THRESHOLD_MS - 1_000,
        tier: "standard",
        alreadyFired: false,
      }),
    ).toBe(true);
  });

  it("does not fire when remaining time exceeds the day urgent threshold", () => {
    expect(
      shouldFireUrgentWarning({
        remainingMs: DAY_URGENT_THRESHOLD_MS + 1_000,
        tier: "day",
        alreadyFired: false,
      }),
    ).toBe(false);
  });

  it("fires exactly at the day urgent threshold (T-5m)", () => {
    expect(
      shouldFireUrgentWarning({
        remainingMs: DAY_URGENT_THRESHOLD_MS,
        tier: "day",
        alreadyFired: false,
      }),
    ).toBe(true);
  });

  it("does not fire after the room has already expired", () => {
    expect(
      shouldFireUrgentWarning({ remainingMs: 0, tier: "standard", alreadyFired: false }),
    ).toBe(false);
    expect(
      shouldFireUrgentWarning({ remainingMs: -1_000, tier: "day", alreadyFired: false }),
    ).toBe(false);
  });

  it("fires only once across a countdown sequence on the same window", () => {
    // The caller (RoomPage) flips `alreadyFired` to true the first time
    // this returns true. From there, every subsequent tick must be a
    // no-op even as remainingMs keeps decreasing toward zero. Otherwise
    // the toast would re-pop every second in the final minute.
    const tier = "standard" as const;
    let fired = false;
    let fireCount = 0;
    const samples = [
      STANDARD_URGENT_THRESHOLD_MS + 30_000,
      STANDARD_URGENT_THRESHOLD_MS + 1_000,
      STANDARD_URGENT_THRESHOLD_MS,
      STANDARD_URGENT_THRESHOLD_MS - 1_000,
      30_000,
      5_000,
      1_000,
    ];
    for (const remainingMs of samples) {
      if (shouldFireUrgentWarning({ remainingMs, tier, alreadyFired: fired })) {
        fired = true;
        fireCount++;
      }
    }
    expect(fireCount).toBe(1);
  });
});
