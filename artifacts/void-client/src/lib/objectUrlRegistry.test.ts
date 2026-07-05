// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerObjectUrl,
  unregisterObjectUrl,
  drainObjectUrlRegistry,
  __testing,
} from "./objectUrlRegistry";

// Task #398: BURN drains every blob URL registered into this module.
// Without this guarantee, a blob created mid-room (audio test, future
// snapshot/recording features, etc.) could survive BURN as a live
// blob: URL accessible from the same-origin page until garbage
// collection runs.
describe("objectUrlRegistry", () => {
  let revokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __testing.clear();
    revokeSpy = vi.fn();
    vi.stubGlobal("URL", {
      ...(globalThis.URL as unknown as object),
      revokeObjectURL: revokeSpy,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __testing.clear();
  });

  it("revokes every registered URL on drain and empties the registry", () => {
    registerObjectUrl("blob:a");
    registerObjectUrl("blob:b");
    registerObjectUrl("blob:c");
    expect(__testing.size()).toBe(3);

    const drained = drainObjectUrlRegistry();

    expect(drained).toBe(3);
    expect(revokeSpy).toHaveBeenCalledWith("blob:a");
    expect(revokeSpy).toHaveBeenCalledWith("blob:b");
    expect(revokeSpy).toHaveBeenCalledWith("blob:c");
    expect(__testing.size()).toBe(0);
  });

  it("does not revoke URLs that were explicitly unregistered first", () => {
    registerObjectUrl("blob:keep");
    registerObjectUrl("blob:drop");
    unregisterObjectUrl("blob:drop");

    drainObjectUrlRegistry();

    expect(revokeSpy).toHaveBeenCalledWith("blob:keep");
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:drop");
  });

  it("is idempotent — a second drain is a no-op", () => {
    registerObjectUrl("blob:x");
    drainObjectUrlRegistry();
    revokeSpy.mockClear();
    const second = drainObjectUrlRegistry();
    expect(second).toBe(0);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("swallows revoke errors so a single bad URL does not abort the drain", () => {
    revokeSpy.mockImplementation((u: string) => {
      if (u === "blob:bad") throw new Error("already revoked");
    });
    registerObjectUrl("blob:good-a");
    registerObjectUrl("blob:bad");
    registerObjectUrl("blob:good-b");

    expect(() => drainObjectUrlRegistry()).not.toThrow();
    expect(revokeSpy).toHaveBeenCalledWith("blob:good-a");
    expect(revokeSpy).toHaveBeenCalledWith("blob:bad");
    expect(revokeSpy).toHaveBeenCalledWith("blob:good-b");
  });
});
