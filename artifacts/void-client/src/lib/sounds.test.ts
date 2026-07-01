// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi } from "vitest";

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: "running" | "closed" = "running";
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
  vi.resetModules();
});

describe("closeAudioContext", () => {
  it("closes the live context and recreates a fresh one on next access", async () => {
    const sounds = await import("./sounds");
    const first = sounds.getAudioContext();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(first.state).toBe("running");

    await sounds.closeAudioContext();
    expect((first as unknown as FakeAudioContext).close).toHaveBeenCalledTimes(1);
    expect(first.state).toBe("closed");

    const second = sounds.getAudioContext();
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(second.state).toBe("running");
  });

  it("runs registered before-close hooks before closing", async () => {
    const sounds = await import("./sounds");
    sounds.getAudioContext();

    const order: string[] = [];
    sounds.registerBeforeAudioClose(() => order.push("hook"));
    const live = FakeAudioContext.instances[0];
    live.close = vi.fn(async () => {
      order.push("close");
      live.state = "closed";
    });

    await sounds.closeAudioContext();
    expect(order).toEqual(["hook", "close"]);
  });

  it("is a no-op when no context has been created", async () => {
    const sounds = await import("./sounds");
    await sounds.closeAudioContext();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("does not throw if a hook throws", async () => {
    const sounds = await import("./sounds");
    sounds.getAudioContext();
    sounds.registerBeforeAudioClose(() => {
      throw new Error("boom");
    });
    await expect(sounds.closeAudioContext()).resolves.toBeUndefined();
    expect(FakeAudioContext.instances[0].state).toBe("closed");
  });
});
