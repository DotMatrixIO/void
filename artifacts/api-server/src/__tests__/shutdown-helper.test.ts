// SPDX-License-Identifier: AGPL-3.0-or-later
// performShutdown helper unit tests.
//
// These complement shutdown.test.ts (which exercises the wire-level
// broadcast against a live socket.io server) by pinning the
// orchestration contract of performShutdown directly:
//
//   1. Broadcast happens BEFORE the drain timer.
//   2. After drainMs the helper closes socket.io, THEN closes the HTTP
//      server, then calls exit(0). Closing in that order is required
//      so httpServer.close()'s callback actually fires.
//   3. parseDrainMs honours the env override and falls back safely.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { performShutdown, parseDrainMs } from "../shutdown";

// Mock the two timer-cleanup collaborators so the test can observe
// WHEN they run relative to the on-disk flush hook. These are the only
// symbols performShutdown pulls from each module.
const timerCleanup = vi.hoisted(() => ({
  clearAllExpiryTimers: vi.fn(),
  stopConsumedTokenSweep: vi.fn(),
}));
vi.mock("../rooms", () => ({
  clearAllExpiryTimers: timerCleanup.clearAllExpiryTimers,
}));
vi.mock("../socketHandlers", () => ({
  stopConsumedTokenSweep: timerCleanup.stopConsumedTokenSweep,
}));

describe("parseDrainMs", () => {
  it("returns the default when env is unset", () => {
    expect(parseDrainMs(undefined)).toBe(5000);
  });
  it("parses a valid numeric env override", () => {
    expect(parseDrainMs("250")).toBe(250);
  });
  it("falls back when the env value is non-numeric", () => {
    expect(parseDrainMs("not-a-number")).toBe(5000);
  });
  it("falls back when the env value is negative", () => {
    expect(parseDrainMs("-1")).toBe(5000);
  });
  it("accepts 0 as a valid override (instant drain)", () => {
    expect(parseDrainMs("0")).toBe(0);
  });
});

describe("performShutdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timerCleanup.clearAllExpiryTimers.mockReset();
    timerCleanup.stopConsumedTokenSweep.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts server-shutdown synchronously, before any drain elapses", async () => {
    const order: string[] = [];
    const io = {
      emit: vi.fn(() => {
        order.push("emit");
      }),
      close: vi.fn(() => {
        order.push("io.close");
      }),
    };
    const httpServer = {
      close: vi.fn((cb?: () => void) => {
        order.push("http.close");
        cb?.();
      }),
    };
    const exit = vi.fn();

    const done = performShutdown({
      io,
      httpServer,
      drainMs: 100,
      signal: "SIGTERM",
      exit,
    });

    // The broadcast MUST land before any timer runs, so a client that
    // disconnects mid-drain still saw the notice.
    expect(io.emit).toHaveBeenCalledWith("server-shutdown", {
      reason: "SIGTERM",
      drainMs: 100,
    });
    expect(io.close).not.toHaveBeenCalled();
    expect(httpServer.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    await done;

    expect(order).toEqual(["emit", "io.close", "http.close"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces a hard exit if httpServer.close() never invokes its callback", async () => {
    const io = { emit: vi.fn(), close: vi.fn() };
    // Simulate a hung close — the production failure mode is a lingering
    // websocket holding the keep-alive count > 0.
    const httpServer = { close: vi.fn(() => {}) };
    const exit = vi.fn();

    const done = performShutdown({
      io,
      httpServer,
      drainMs: 100,
      signal: "SIGTERM",
      exit,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(httpServer.close).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    // Hard-exit safety net at 2 × drainMs.
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("flushes the on-disk snapshot via onBeforeClearTimers exactly once, after the broadcast and before timers are cleared", async () => {
    // Task #310 wired a final room-state flush into performShutdown via
    // the onBeforeClearTimers hook. The flush MUST run after the
    // server-shutdown broadcast (so nothing changes the map afterwards)
    // and BEFORE clearAllExpiryTimers (so the in-memory room map is
    // still intact when the snapshot is captured). This pins that
    // ordering so a future refactor can't silently drop or misplace the
    // hook.
    const order: string[] = [];
    timerCleanup.clearAllExpiryTimers.mockImplementation(() => {
      order.push("clearAllExpiryTimers");
    });
    timerCleanup.stopConsumedTokenSweep.mockImplementation(() => {
      order.push("stopConsumedTokenSweep");
    });
    const io = {
      emit: vi.fn(() => {
        order.push("emit");
      }),
      close: vi.fn(),
    };
    const httpServer = { close: vi.fn((cb?: () => void) => cb?.()) };
    const exit = vi.fn();
    const onBeforeClearTimers = vi.fn(() => {
      order.push("onBeforeClearTimers");
    });

    const done = performShutdown({
      io,
      httpServer,
      drainMs: 50,
      signal: "SIGTERM",
      exit,
      onBeforeClearTimers,
    });

    // All of this happens synchronously, before any drain timer elapses.
    // Asserting times === 1 catches a dropped hook; asserting the full
    // order catches a hook that fires too late (after the timers are
    // cleared and the room map may have been mutated).
    expect(onBeforeClearTimers).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "emit",
      "onBeforeClearTimers",
      "stopConsumedTokenSweep",
      "clearAllExpiryTimers",
    ]);

    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("survives io.emit throwing (broadcast best-effort, drain still runs)", async () => {
    const io = {
      emit: vi.fn(() => {
        throw new Error("socket.io exploded");
      }),
      close: vi.fn(),
    };
    const httpServer = { close: vi.fn((cb?: () => void) => cb?.()) };
    const exit = vi.fn();
    const log = { warn: vi.fn() };

    const done = performShutdown({
      io,
      httpServer,
      drainMs: 50,
      signal: "SIGINT",
      exit,
      log: log as unknown as Parameters<typeof performShutdown>[0]["log"],
    });

    await vi.advanceTimersByTimeAsync(50);
    await done;

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to broadcast server-shutdown",
    );
    expect(io.close).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
