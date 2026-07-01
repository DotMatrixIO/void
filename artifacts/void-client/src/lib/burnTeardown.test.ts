// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { stopPendingShare, stopAllTracksOf } from "./burnTeardown";

describe("burnTeardown", () => {
  it("stopPendingShare returns false for null and is a no-op", () => {
    expect(stopPendingShare(null)).toBe(false);
    expect(stopPendingShare(undefined)).toBe(false);
  });

  it("stopPendingShare stops the held track and every stream track", () => {
    const trackStop = vi.fn();
    const a = vi.fn();
    const b = vi.fn();
    const pending = {
      track: { stop: trackStop },
      stream: { getTracks: () => [{ stop: a }, { stop: b }] },
    };
    expect(stopPendingShare(pending)).toBe(true);
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stopPendingShare swallows track.stop errors and still drains stream", () => {
    const a = vi.fn();
    const pending = {
      track: { stop: () => { throw new Error("already-ended"); } },
      stream: { getTracks: () => [{ stop: a }] },
    };
    expect(() => stopPendingShare(pending)).not.toThrow();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("stopAllTracksOf stops every track and is null-safe", () => {
    expect(stopAllTracksOf(null)).toBe(false);
    const a = vi.fn();
    const b = vi.fn();
    expect(stopAllTracksOf({ getTracks: () => [{ stop: a }, { stop: b }] })).toBe(true);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});
