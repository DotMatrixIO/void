// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useWaitHint } from "@/hooks/useWaitHint";
import type { PeerConnectionStates } from "@/lib/webrtc";

// Task #597: the wait-hint now reports *why* it fired via `waitHintCause`
// so RoomPage can pick copy per cause. Priority is:
//   signaling (socket down) > failed (peer flipped failed) > timeout.
describe("useWaitHint cause precedence (Task #597)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it("fires with cause 'timeout' once the delay elapses with an empty room", () => {
    const { result } = renderHook(() =>
      useWaitHint({ peerConnectionStates: {}, delayMs: 1000 }),
    );
    act(() => result.current.startWaitHintCycle());
    expect(result.current.showWaitHint).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.showWaitHint).toBe(true);
    expect(result.current.waitHintCause).toBe("timeout");
  });

  it("fires immediately with cause 'failed' when a peer connection flips to failed (before the timeout)", () => {
    const states: PeerConnectionStates = {};
    const { result, rerender } = renderHook(
      (props: { peerConnectionStates: PeerConnectionStates }) =>
        useWaitHint({ peerConnectionStates: props.peerConnectionStates, delayMs: 1000 }),
      { initialProps: { peerConnectionStates: states } },
    );
    act(() => result.current.startWaitHintCycle());
    act(() => {
      rerender({ peerConnectionStates: { p1: "failed" } });
    });
    expect(result.current.showWaitHint).toBe(true);
    expect(result.current.waitHintCause).toBe("failed");
  });

  it("signaling loss takes priority and overrides an already-failed cause", () => {
    const { result, rerender } = renderHook(
      (props: {
        peerConnectionStates: PeerConnectionStates;
        signalingConnected?: boolean;
      }) =>
        useWaitHint({
          peerConnectionStates: props.peerConnectionStates,
          signalingConnected: props.signalingConnected,
          delayMs: 1000,
        }),
      {
        initialProps: {
          peerConnectionStates: {} as PeerConnectionStates,
          signalingConnected: true,
        },
      },
    );
    act(() => result.current.startWaitHintCycle());
    // A peer fails first -> cause "failed".
    act(() => {
      rerender({ peerConnectionStates: { p1: "failed" }, signalingConnected: true });
    });
    expect(result.current.waitHintCause).toBe("failed");
    // The signaling socket then drops -> the more-important cause wins.
    act(() => {
      rerender({ peerConnectionStates: { p1: "failed" }, signalingConnected: false });
    });
    expect(result.current.showWaitHint).toBe(true);
    expect(result.current.waitHintCause).toBe("signaling");
  });

  it("does not fire while signaling is connected and the room is briefly empty", () => {
    const { result } = renderHook(() =>
      useWaitHint({
        peerConnectionStates: {},
        signalingConnected: true,
        delayMs: 1000,
      }),
    );
    act(() => result.current.startWaitHintCycle());
    expect(result.current.showWaitHint).toBe(false);
    expect(result.current.waitHintCause).toBeNull();
  });
});
