// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Mock the socket module before importing the hook.
const emit = vi.fn();
vi.mock("@/lib/socket", () => ({
  getSocket: () => ({ emit }),
}));
vi.mock("@/lib/uiSounds", () => ({
  uiClick: vi.fn(),
}));

import { useRoomSignaling } from "./useRoomSignaling";

describe("useRoomSignaling", () => {
  beforeEach(() => {
    emit.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds defaults sensibly", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "AAA-BBB" } }),
    );
    expect(result.current.peers).toEqual([]);
    expect(result.current.joined).toBe(false);
    expect(result.current.isHost).toBe(false);
    // Until the join callback resolves, the safest assumption is
    // that moderation is intact, so hostPresent defaults to true.
    expect(result.current.hostPresent).toBe(true);
    expect(result.current.hostPeerId).toBeNull();
    expect(result.current.roomLocked).toBe(false);
    expect(result.current.maxUsers).toBe(4);
    expect(result.current.knockMode).toBe(false);
    expect(result.current.relayOnly).toBe(false);
    expect(result.current.peerMediaState).toEqual({});
  });

  it("keeps isHostRef synced with isHost", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "AAA-BBB" } }),
    );
    act(() => result.current.setIsHost(true));
    expect(result.current.isHostRef.current).toBe(true);
    act(() => result.current.setIsHost(false));
    expect(result.current.isHostRef.current).toBe(false);
  });

  it("handleToggleLock emits unlock when currently locked, lock otherwise", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "AAA-BBB" } }),
    );
    act(() => result.current.handleToggleLock());
    expect(emit).toHaveBeenLastCalledWith("lock-room", { code: "AAA-BBB" });
    act(() => result.current.setRoomLocked(true));
    act(() => result.current.handleToggleLock());
    expect(emit).toHaveBeenLastCalledWith("unlock-room", { code: "AAA-BBB" });
  });

  it("handleToggleKnock inverts knockMode in the emit payload", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "AAA-BBB" } }),
    );
    act(() => result.current.handleToggleKnock());
    expect(emit).toHaveBeenLastCalledWith("set-knock-mode", {
      code: "AAA-BBB",
      enabled: true,
    });
    act(() => result.current.setKnockMode(true));
    act(() => result.current.handleToggleKnock());
    expect(emit).toHaveBeenLastCalledWith("set-knock-mode", {
      code: "AAA-BBB",
      enabled: false,
    });
  });

  it("approve/deny knock emits and drops the peer from pending list", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "ROOM" } }),
    );
    act(() => result.current.setPendingKnocks(["peer-a", "peer-b"]));
    act(() => result.current.handleApproveKnock("peer-a"));
    expect(emit).toHaveBeenCalledWith("approve-knock", {
      code: "ROOM",
      peerId: "peer-a",
    });
    expect(result.current.pendingKnocks).toEqual(["peer-b"]);
    act(() => result.current.handleDenyKnock("peer-b"));
    expect(emit).toHaveBeenCalledWith("deny-knock", {
      code: "ROOM",
      peerId: "peer-b",
    });
    expect(result.current.pendingKnocks).toEqual([]);
  });

  it("handleRequestRelayOnly flips relayRequestSent and resets on error", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "ROOM" } }),
    );
    let storedCb: ((r: { success: boolean; error?: string }) => void) | null =
      null;
    emit.mockImplementationOnce((_event, _payload, cb) => {
      storedCb = cb;
    });
    act(() => result.current.handleRequestRelayOnly());
    expect(result.current.relayRequestSent).toBe(true);
    act(() => storedCb?.({ success: false, error: "RATE_LIMITED" }));
    expect(result.current.relayRequestSent).toBe(false);
    expect(result.current.relayResponseNotice).toContain("TOO MANY");
  });

  it("handleRequestRelayOnly resets when room is already relay-only", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "ROOM" } }),
    );
    let storedCb: ((r: { success: boolean; alreadyEnabled?: boolean }) => void) | null =
      null;
    emit.mockImplementationOnce((_event, _payload, cb) => {
      storedCb = cb;
    });
    act(() => result.current.handleRequestRelayOnly());
    expect(result.current.relayRequestSent).toBe(true);
    act(() => storedCb?.({ success: true, alreadyEnabled: true }));
    expect(result.current.relayRequestSent).toBe(false);
  });

  it("handleRespondRelayRequest emits with accept and removes from pending", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "ROOM" } }),
    );
    act(() => result.current.setPendingRelayRequests(["peer-x", "peer-y"]));
    act(() => result.current.handleRespondRelayRequest("peer-x", true));
    expect(emit).toHaveBeenLastCalledWith("respond-relay-only-request", {
      code: "ROOM",
      peerId: "peer-x",
      accept: true,
    });
    expect(result.current.pendingRelayRequests).toEqual(["peer-y"]);
  });

  it("flashRelayResponseNotice auto-clears after the toast lifetime", () => {
    const { result } = renderHook(() =>
      useRoomSignaling({ wireCodeRef: { current: "ROOM" } }),
    );
    act(() => result.current.flashRelayResponseNotice("HELLO"));
    expect(result.current.relayResponseNotice).toBe("HELLO");
    act(() => vi.advanceTimersByTime(4001));
    expect(result.current.relayResponseNotice).toBeNull();
  });
});
