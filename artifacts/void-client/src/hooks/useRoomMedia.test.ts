// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRoomMedia } from "./useRoomMedia";
import { setAllowUnmaskedVideo } from "@/lib/maskingPrefs";

describe("useRoomMedia", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Task #572: these cycle tests pre-date the ALLOW UNMASKED VIDEO
    // toggle and assume index 0 (NONE) is reachable. Opt-in so the
    // legacy invariant still holds; dedicated coverage for the
    // skip-NONE-when-off behaviour lives at the bottom of this file.
    try { localStorage.clear(); } catch {}
    setAllowUnmaskedVideo(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    try { localStorage.clear(); } catch {}
  });

  it("seeds defaults from the options", () => {
    const { result } = renderHook(() =>
      useRoomMedia({ initialVideoStyle: 2, initialVoiceMode: 3 }),
    );
    expect(result.current.micMuted).toBe(false);
    expect(result.current.camOff).toBe(false);
    expect(result.current.videoStyle).toBe(2);
    expect(result.current.voiceMode).toBe(3);
    expect(result.current.localStream).toBeNull();
    expect(result.current.isScreenSharing).toBe(false);
    expect(result.current.screenSharePeerId).toBeNull();
    expect(result.current.pendingShare).toBeNull();
    expect(result.current.shareNotice).toBeNull();
  });

  it("keeps mic/cam refs in sync with their state across rerenders", () => {
    const { result } = renderHook(() => useRoomMedia());
    act(() => result.current.setMicMuted(true));
    expect(result.current.micMutedRef.current).toBe(true);
    act(() => result.current.setCamOff(true));
    expect(result.current.camOffRef.current).toBe(true);
    act(() => {
      result.current.setMicMuted(false);
      result.current.setCamOff(false);
    });
    expect(result.current.micMutedRef.current).toBe(false);
    expect(result.current.camOffRef.current).toBe(false);
  });

  it("keeps pendingShareRef synced with pendingShare so async grant handlers see the latest value", () => {
    const { result } = renderHook(() => useRoomMedia());
    expect(result.current.pendingShareRef.current).toBeNull();
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    const fakeTrack = { kind: "video" } as MediaStreamTrack;
    act(() =>
      result.current.setPendingShare({
        stream: fakeStream,
        track: fakeTrack,
        surface: "monitor",
      }),
    );
    expect(result.current.pendingShareRef.current?.surface).toBe("monitor");
  });

  it("showShareNotice writes the toast and auto-clears it", () => {
    const { result } = renderHook(() => useRoomMedia());
    act(() => result.current.showShareNotice("STARTED"));
    expect(result.current.shareNotice).toBe("STARTED");
    act(() => vi.advanceTimersByTime(4001));
    expect(result.current.shareNotice).toBeNull();
  });

  it("showShareNotice replaces an in-flight toast without leaking the prior timer", () => {
    const { result } = renderHook(() => useRoomMedia());
    act(() => result.current.showShareNotice("FIRST"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.showShareNotice("SECOND"));
    // The original 4s timer must not race the new one — only the
    // second message stays visible for its full window.
    act(() => vi.advanceTimersByTime(2001));
    expect(result.current.shareNotice).toBe("SECOND");
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.shareNotice).toBeNull();
  });

  // Task #526: GOLD disable + cycle-skip.
  it("markVideoStyleDisabled flips the flag into disabledVideoStyles (idempotent)", () => {
    const { result } = renderHook(() => useRoomMedia());
    expect(result.current.disabledVideoStyles.size).toBe(0);
    act(() => result.current.markVideoStyleDisabled(1));
    expect(result.current.disabledVideoStyles.has(1)).toBe(true);
    expect(result.current.disabledVideoStyles.size).toBe(1);
    // Calling again with the same mode must not churn the set
    // identity (the early-return inside the setter handles this).
    const setBefore = result.current.disabledVideoStyles;
    act(() => result.current.markVideoStyleDisabled(1));
    expect(result.current.disabledVideoStyles).toBe(setBefore);
  });

  it("cycleVideoStyle skips a disabled mode (GOLD) and lands on the slot after it", () => {
    const { result } = renderHook(() =>
      useRoomMedia({ initialVideoStyle: 0 }),
    );
    const pipelineSetStyle = vi.fn();
    result.current.setVideoStyleRef.current = pipelineSetStyle;
    // Disable GOLD before the user presses cycle.
    act(() => result.current.markVideoStyleDisabled(1));
    act(() => result.current.cycleVideoStyle());
    // From 0 we'd normally land on 1 (GOLD); with GOLD disabled we
    // must land on 2 (PIXEL) and the pipeline must be told so.
    expect(result.current.videoStyle).toBe(2);
    expect(result.current.videoStyleRef.current).toBe(2);
    expect(pipelineSetStyle).toHaveBeenLastCalledWith(2);
  });

  it("cycleVideoStyle walks past GOLD if the user was sitting on the slot before it", () => {
    const { result } = renderHook(() =>
      useRoomMedia({ initialVideoStyle: 0 }),
    );
    result.current.setVideoStyleRef.current = vi.fn();
    act(() => result.current.markVideoStyleDisabled(1));
    // 0 → (skip 1) → 2 → 3 → 4 → 5 → 0 → (skip 1) → 2 ...
    act(() => result.current.cycleVideoStyle());
    expect(result.current.videoStyle).toBe(2);
    act(() => result.current.cycleVideoStyle());
    expect(result.current.videoStyle).toBe(3);
    act(() => result.current.cycleVideoStyle());
    expect(result.current.videoStyle).toBe(4);
    act(() => result.current.cycleVideoStyle());
    expect(result.current.videoStyle).toBe(5);
    act(() => result.current.cycleVideoStyle());
    expect(result.current.videoStyle).toBe(0);
    act(() => result.current.cycleVideoStyle());
    expect(result.current.videoStyle).toBe(2);
  });

  it("cycleVideoStyle is byte-equivalent to (prev+1)%6 when no style is disabled", () => {
    const { result } = renderHook(() =>
      useRoomMedia({ initialVideoStyle: 0 }),
    );
    result.current.setVideoStyleRef.current = vi.fn();
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      act(() => result.current.cycleVideoStyle());
      seen.push(result.current.videoStyle);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 0, 1]);
  });

  it("resetScreenShareState clears every screen-share state field", () => {
    const { result } = renderHook(() => useRoomMedia());
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    const fakeTrack = { kind: "video" } as MediaStreamTrack;
    act(() => {
      result.current.setIsScreenSharing(true);
      result.current.setScreenSharePeerId("peer-abc");
      result.current.setScreenShareRequesting(true);
      result.current.setLocalPreviewStream(fakeStream);
      result.current.setPendingShare({
        stream: fakeStream,
        track: fakeTrack,
        surface: "window",
      });
      result.current.displayTrackRef.current = fakeTrack;
    });
    let stopCalled = false;
    result.current.screenShareWatermarkRef.current = {
      stop: () => {
        stopCalled = true;
      },
    } as unknown as NonNullable<
      typeof result.current.screenShareWatermarkRef.current
    >;
    act(() => result.current.resetScreenShareState());
    expect(result.current.isScreenSharing).toBe(false);
    expect(result.current.screenSharePeerId).toBeNull();
    expect(result.current.screenShareRequesting).toBe(false);
    expect(result.current.localPreviewStream).toBeNull();
    expect(result.current.pendingShare).toBeNull();
    expect(result.current.pendingShareRef.current).toBeNull();
    expect(result.current.displayTrackRef.current).toBeNull();
    expect(result.current.screenShareWatermarkRef.current).toBeNull();
    expect(stopCalled).toBe(true);
  });
});
