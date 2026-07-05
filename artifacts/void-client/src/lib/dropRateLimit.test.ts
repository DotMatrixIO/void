// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { createDropThrottle, type ThrottleClock } from "./dropRateLimit";

/**
 * A deterministic fake clock. Time only advances when the test calls
 * `advance(ms)`, which also fires any timers whose deadline has passed.
 */
function makeFakeClock() {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: ThrottleClock = {
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      timers.delete(handle as unknown as number);
    },
  };
  const advance = (ms: number) => {
    const target = t + ms;
    // Fire due timers in deadline order until we reach `target`.
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of timers) {
        if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) {
          due = entry;
        }
      }
      if (!due) break;
      t = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    t = target;
  };
  return { clock, advance, pending: () => timers.size };
}

describe("createDropThrottle (DROP rate cap)", () => {
  it("emits the first value immediately (leading edge)", () => {
    const { clock } = makeFakeClock();
    const seen: string[] = [];
    const th = createDropThrottle((v) => seen.push(v), 150, clock);
    th.push("a");
    expect(seen).toEqual(["a"]);
  });

  it("a burst leaves the receiver showing the LAST value, not a dropped-final stale one", () => {
    const { clock, advance } = makeFakeClock();
    const seen: string[] = [];
    const th = createDropThrottle((v) => seen.push(v), 150, clock);

    // Flood at channel speed within a single rate window.
    th.push("v1"); // leading — renders at once
    th.push("v2");
    th.push("v3");
    th.push("v4"); // last value of the burst

    // Only the leading value has rendered so far — the middle churn is
    // coalesced, never thrashing the UI.
    expect(seen).toEqual(["v1"]);

    // When the window closes, the FINAL value of the burst lands.
    advance(150);
    expect(seen).toEqual(["v1", "v4"]);
  });

  it("a single trailing update still lands even when nothing follows it", () => {
    const { clock, advance } = makeFakeClock();
    const seen: string[] = [];
    const th = createDropThrottle((v) => seen.push(v), 150, clock);

    th.push("a"); // leading
    advance(10);
    th.push("b"); // inside window — scheduled as trailing
    expect(seen).toEqual(["a"]);
    advance(200);
    expect(seen).toEqual(["a", "b"]);
  });

  it("updates spaced beyond the interval each render immediately", () => {
    const { clock, advance } = makeFakeClock();
    const seen: string[] = [];
    const th = createDropThrottle((v) => seen.push(v), 150, clock);

    th.push("a");
    advance(200);
    th.push("b");
    advance(200);
    th.push("c");
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("cancel() drops a pending trailing emit and leaves no timers", () => {
    const { clock, advance, pending } = makeFakeClock();
    const seen: string[] = [];
    const th = createDropThrottle((v) => seen.push(v), 150, clock);

    th.push("a"); // leading
    th.push("b"); // pending trailing
    expect(pending()).toBe(1);
    th.cancel();
    expect(pending()).toBe(0);
    advance(500);
    expect(seen).toEqual(["a"]);
  });
});
