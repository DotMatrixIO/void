// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoom, destroyRoom, getRoomState, ROOM_TTLS } from "../rooms";

function freshCode(): string {
  return Array.from({ length: 32 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
}

// Regression check for task #159 (timing leak on the proof endpoint).
//
// `getRoomState` collapses three "no live room" branches (never-existed,
// expired, destroyed) into the same `null`. We also want them to take
// roughly the same time to compute, so the wall-clock latency of the
// route can't be used to tell them apart. We measure each path many
// times and assert their per-call medians stay within an order of
// magnitude of each other. The threshold is deliberately loose — this
// is a sanity check against accidental regressions (e.g. a future
// change that adds a slow lookup to one branch only), not a microbench.
describe("getRoomState — null-path timing parity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never-existed, expired, and destroyed cases run in similar time per call", () => {
    const N = 5000;

    const destroyedCode = freshCode();
    createRoom(destroyedCode, false, "h-d", "human", ROOM_TTLS.standard, "standard");
    destroyRoom(destroyedCode, "h-d");

    const expiredCode = freshCode();
    createRoom(expiredCode, false, "h-e", "human", ROOM_TTLS.standard, "standard");

    // Fake only Date so getRoomState's expiry check trips for `expiredCode`,
    // without freezing setTimeout/setInterval (the per-room expiry timer
    // and the GC sweep still tick on real timers, so they won't fire and
    // delete the room out from under the benchmark).
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + ROOM_TTLS.standard + 60_000);

    const neverCodes = Array.from({ length: N }, freshCode);

    const batchAvg = (codeAt: (i: number) => string): number => {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < N; i++) getRoomState(codeAt(i));
      const t1 = process.hrtime.bigint();
      return Number(t1 - t0) / N;
    };

    // Take the median of several batches per path and interleave the
    // paths across rounds so cache/JIT state is shared. Single-shot
    // batches at sub-microsecond per-call times are very noisy.
    const ROUNDS = 9;
    const samples: Record<"never" | "destroyed" | "expired", number[]> = {
      never: [],
      destroyed: [],
      expired: [],
    };

    // Warm-up the JIT for all three paths.
    for (let i = 0; i < 1000; i++) {
      getRoomState(neverCodes[i % N]);
      getRoomState(destroyedCode);
      getRoomState(expiredCode);
    }

    for (let r = 0; r < ROUNDS; r++) {
      samples.never.push(batchAvg((i) => neverCodes[i]));
      samples.destroyed.push(batchAvg(() => destroyedCode));
      samples.expired.push(batchAvg(() => expiredCode));
    }

    const median = (xs: number[]): number => {
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };

    // Sanity-check: each path really does return null.
    expect(getRoomState(neverCodes[0])).toBeNull();
    expect(getRoomState(destroyedCode)).toBeNull();
    expect(getRoomState(expiredCode)).toBeNull();

    const tNever = median(samples.never);
    const tDestroyed = median(samples.destroyed);
    const tExpired = median(samples.expired);

    const maxT = Math.max(tNever, tDestroyed, tExpired);
    const minT = Math.min(tNever, tDestroyed, tExpired);

    // Loose 10x tolerance over batch medians: catches order-of-
    // magnitude regressions (e.g. accidentally adding O(n) work or a
    // sync I/O hop to one branch) without flaking on noisy CI runners.
    // Per-call times here are tens of nanoseconds, so the absolute gap
    // is dominated by clock-resolution noise; we only care about the
    // ratio, not the magnitude.
    expect(maxT / minT).toBeLessThan(10);
  });
});
